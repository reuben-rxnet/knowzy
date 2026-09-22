// Taxonomy administration, against a real database.
//
// The unit tests cover normalization. What needs a database is everything that
// depends on state: a unique code, a unique topic slug within a domain, the
// moment a code stops being editable, and the audit row that every change is
// supposed to leave behind.
//
// Same discipline as the rest of the integration suites: each refusal is made
// to FIRE from a passing baseline. A suite where the creates succeed proves
// that creates work and says nothing about the four rules that are supposed to
// stop them.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { systemClock } from '@knowzy/observability';
import {
  createDomain,
  createGenerationJob,
  createTopic,
  readTaxonomy,
  updateDomain,
  updateTopic,
  TaxonomyError,
  type TaxonomyActor,
  type TaxonomyDeps,
} from '../src/index.js';

const DATABASE_URL = process.env['DATABASE_URL'];
const describeDb = DATABASE_URL ? describe : describe.skip;

const prisma = new PrismaClient(
  DATABASE_URL ? { datasources: { db: { url: DATABASE_URL } } } : undefined,
);

/** A prefix nothing else in the database uses, so cleanup is exact. */
const PREFIX = 'ZZTEST';

describeDb('taxonomy administration', () => {
  const deps: TaxonomyDeps = { prisma, clock: systemClock };
  let actor: TaxonomyActor;
  const createdDomainIds: string[] = [];

  beforeAll(async () => {
    const user = await prisma.user.findFirstOrThrow({
      where: { userPrincipalName: 'knowzy-administrator@local.invalid' },
      select: { id: true, displayName: true },
    });
    actor = {
      userId: user.id,
      displayName: user.displayName,
      roles: ['KNOWZY_ADMINISTRATOR'],
      correlationId: 'taxonomy-test',
      requestId: 'taxonomy-request',
    };

    // Left over from an interrupted run: delete by prefix, topics first.
    const stale = await prisma.domain.findMany({
      where: { code: { startsWith: PREFIX } },
      select: { id: true },
    });
    for (const domain of stale) {
      await prisma.topic.deleteMany({ where: { domainId: domain.id } });
      await prisma.domain.delete({ where: { id: domain.id } });
    }
  });

  afterAll(async () => {
    for (const domainId of createdDomainIds) {
      await prisma.topic.deleteMany({ where: { domainId } });
      await prisma.domain.deleteMany({ where: { id: domainId } });
    }
    await prisma.$disconnect();
  });

  const newDomain = async (suffix: string, name?: string) => {
    const domain = await createDomain(deps, actor, {
      code: `${PREFIX}_${suffix}`,
      name: name ?? `Test ${suffix}`,
    });
    createdDomainIds.push(domain.domainId);
    return domain;
  };

  describe('creating a domain', () => {
    it('creates it active, with an upper-cased code and no topics', async () => {
      const domain = await newDomain('VISIONSTAR', 'VisionStar');
      expect(domain.code).toBe(`${PREFIX}_VISIONSTAR`);
      expect(domain.name).toBe('VisionStar');
      expect(domain.isActive).toBe(true);
      expect(domain.topicCount).toBe(0);
      // Nothing references it yet, which is the only window in which the code
      // can be corrected.
      expect(domain.codeLocked).toBe(false);
    });

    it('writes an ADMIN.TAXONOMY.DOMAIN_CREATED row carrying the code', async () => {
      const domain = await newDomain('AUDITED');
      const event = await prisma.auditEvent.findFirst({
        where: { action: 'ADMIN.TAXONOMY.DOMAIN_CREATED', entityId: domain.domainId },
        orderBy: { occurredAt: 'desc' },
      });
      expect(event).not.toBeNull();
      // The code is the field that becomes permanent, so the row that created
      // it has to carry it. A dropped key would arrive as `_droppedKeys`.
      expect((event?.detail as Record<string, unknown>)['code']).toBe(`${PREFIX}_AUDITED`);
      expect((event?.detail as Record<string, unknown>)['_droppedKeys']).toBeUndefined();
      expect(event?.actorUserId).toBe(actor.userId);
    });

    it('REFUSES a duplicate code, and names it', async () => {
      await newDomain('DUPE');
      let thrown: unknown;
      try {
        await createDomain(deps, actor, { code: `${PREFIX}_DUPE`, name: 'Second attempt' });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(TaxonomyError);
      expect((thrown as TaxonomyError).code).toBe('TAXONOMY_DUPLICATE');
      expect((thrown as Error).message).toContain(`${PREFIX}_DUPE`);
    });

    it('refuses a duplicate that differs only in case, because the code is folded', async () => {
      await newDomain('CASEFOLD');
      await expect(
        createDomain(deps, actor, { code: `${PREFIX}_casefold`, name: 'Lower case' }),
      ).rejects.toThrow(/already exists/);
    });
  });

  describe('editing a domain', () => {
    it('renames the display name and records what changed', async () => {
      const domain = await newDomain('RENAME', 'Before');
      const updated = await updateDomain(deps, actor, {
        domainId: domain.domainId,
        name: 'After',
      });
      expect(updated.name).toBe('After');
      // The code is untouched by a rename, which is the whole point of having
      // both fields.
      expect(updated.code).toBe(domain.code);

      const event = await prisma.auditEvent.findFirst({
        where: { action: 'ADMIN.TAXONOMY.DOMAIN_UPDATED', entityId: domain.domainId },
        orderBy: { occurredAt: 'desc' },
      });
      expect((event?.detail as Record<string, unknown>)['changedFields']).toEqual(['name']);
      // H2: DOMAIN_UPDATED is a declared value-diff action, so the before and
      // after are in their own columns rather than only in the detail blob.
      expect((event?.previousValue as Record<string, unknown>)['name']).toBe('Before');
      expect((event?.newValue as Record<string, unknown>)['name']).toBe('After');
    });

    it('allows a code correction while NOTHING references the domain', async () => {
      const domain = await newDomain('TYPO');
      const updated = await updateDomain(deps, actor, {
        domainId: domain.domainId,
        code: `${PREFIX}_FIXED`,
      });
      expect(updated.code).toBe(`${PREFIX}_FIXED`);
    });

    it('REFUSES a code change once a question references the domain', async () => {
      // The rule that matters: the code is inside every published QuestionID,
      // and those identifiers live in the Question Bank outside this platform.
      const domain = await newDomain('LOCKED');
      const topic = await createTopic(deps, actor, {
        domainId: domain.domainId,
        name: 'Locking Topic',
      });

      const source = await prisma.knowledgeSource.findFirstOrThrow({
        where: { sourceType: 'MOCK' },
        select: { id: true },
      });
      const document = await prisma.knowledgeDocument.findFirstOrThrow({
        where: { sourceId: source.id, extractionStatus: 'EXTRACTED' },
        select: {
          id: true,
          sourceDocumentId: true,
          name: true,
          sourceUrl: true,
          contentHash: true,
        },
      });
      const section = await prisma.documentSection.findFirstOrThrow({
        where: { documentId: document.id },
        select: {
          sectionKey: true,
          sectionContentHash: true,
          startOffset: true,
          endOffset: true,
        },
      });

      await prisma.draftQuestion.create({
        data: {
          questionType: 'MULTIPLE_CHOICE_4',
          status: 'DRAFT',
          acquisition: 'IMPORTED',
          domainId: domain.domainId,
          topicId: topic.topicId,
          questionText: 'Which team owns the locked domain fixture?',
          answerPayload: {
            kind: 'MULTIPLE_CHOICE_4',
            options: { A: 'One', B: 'Two', C: 'Three', D: 'Four' },
            correctOption: 'A',
          },
          explanation: 'A fixture question, present only to reference the domain.',
          sourceId: source.id,
          sourceDocumentId: document.sourceDocumentId,
          sourceDocumentName: document.name,
          sourceUrl: document.sourceUrl,
          sourceVersionAtGeneration: '1',
          sourceContentHash: document.contentHash ?? 'x'.repeat(64),
          sectionKey: section.sectionKey,
          sectionContentHash: section.sectionContentHash,
          supportingEvidence: 'A'.repeat(60),
          evidenceStartOffset: section.startOffset,
          evidenceEndOffset: section.startOffset + 60,
          evidenceVerificationMode: 'STRICT',
          confidenceScore: 0.5,
          confidenceComponents: {},
          createdByUserId: actor.userId,
        },
      });

      const read = await readTaxonomy(deps, { query: domain.code });
      expect(read.domains[0]?.codeLocked).toBe(true);

      let thrown: unknown;
      try {
        await updateDomain(deps, actor, {
          domainId: domain.domainId,
          code: `${PREFIX}_TOOLATE`,
        });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(TaxonomyError);
      expect((thrown as TaxonomyError).code).toBe('TAXONOMY_CODE_IMMUTABLE');
      expect((thrown as Error).message).toContain('display name is still');

      // And the display name still changes, which is what the refusal promises.
      const renamed = await updateDomain(deps, actor, {
        domainId: domain.domainId,
        name: 'Renamed While Locked',
      });
      expect(renamed.name).toBe('Renamed While Locked');
      expect(renamed.code).toBe(domain.code);

      await prisma.draftQuestion.deleteMany({ where: { domainId: domain.domainId } });
    });

    it('refuses an update that changes nothing, rather than writing an empty audit row', async () => {
      const domain = await newDomain('NOOP', 'Same Name');
      await expect(
        updateDomain(deps, actor, { domainId: domain.domainId, name: 'Same Name' }),
      ).rejects.toThrow(/Nothing was changed/);
    });
  });

  describe('deactivation', () => {
    it('hides a domain from the SELECTION read while keeping it in the ADMIN read', async () => {
      const domain = await newDomain('DEACTIVATE');
      await updateDomain(deps, actor, { domainId: domain.domainId, isActive: false });

      const adminRead = await readTaxonomy(deps, { query: domain.code });
      expect(adminRead.domains.map((row) => row.domainId)).toContain(domain.domainId);

      const activeOnly = await readTaxonomy(deps, { query: domain.code, active: true });
      expect(activeOnly.domains).toHaveLength(0);
    });

    it('stops GENERATION from using a deactivated domain', async () => {
      // "Respect domain and topic references" in the one place it can be
      // proved: a job cannot be created against taxonomy nobody may select.
      const domain = await newDomain('GENBLOCK');
      const topic = await createTopic(deps, actor, {
        domainId: domain.domainId,
        name: 'Generation Block',
      });
      await updateDomain(deps, actor, { domainId: domain.domainId, isActive: false });

      const source = await prisma.knowledgeSource.findFirstOrThrow({
        where: { sourceType: 'MOCK' },
        select: { id: true },
      });
      const document = await prisma.knowledgeDocument.findFirstOrThrow({
        where: { sourceId: source.id, extractionStatus: 'EXTRACTED' },
        select: { id: true },
      });
      const preflight = await prisma.generationPreflight.create({
        data: {
          sourceId: source.id,
          documentIds: [document.id],
          checkResults: {},
          recommendation: 'GENERATE_NEW',
          chosenAction: 'GENERATE_NEW',
          chosenAt: new Date(),
          chosenByUserId: actor.userId,
          expiresAt: new Date(Date.now() + 600_000),
          correlationId: 'taxonomy-test',
          createdByUserId: actor.userId,
        },
        select: { id: true },
      });

      await expect(
        createGenerationJob({
          prisma,
          clock: systemClock,
          preflightId: preflight.id,
          scope: 'ENTIRE_DOCUMENT',
          domainId: domain.domainId,
          topicId: topic.topicId,
          reasonCode: 'NEW_KNOWLEDGE',
          requestedQuestionCount: 1,
          actor: {
            userId: actor.userId,
            displayName: actor.displayName,
            roles: [...actor.roles],
            permissions: ['question.generate'],
          },
          correlationId: 'taxonomy-test',
          requestId: 'taxonomy-request',
        }),
      ).rejects.toThrow(/active/);
    });
  });

  describe('topics', () => {
    it('creates a topic inside exactly one domain, with a derived slug', async () => {
      const domain = await newDomain('TOPICS');
      const topic = await createTopic(deps, actor, {
        domainId: domain.domainId,
        name: 'SAP Integration',
      });
      expect(topic.domainId).toBe(domain.domainId);
      expect(topic.slug).toBe('sap-integration');
      expect(topic.isActive).toBe(true);
    });

    it('REFUSES a duplicate topic in the same domain, however it is typed', async () => {
      const domain = await newDomain('TOPICDUPE');
      await createTopic(deps, actor, { domainId: domain.domainId, name: 'Order Cancellation' });

      let thrown: unknown;
      try {
        await createTopic(deps, actor, {
          domainId: domain.domainId,
          name: '  order   cancellation ',
        });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(TaxonomyError);
      expect((thrown as TaxonomyError).code).toBe('TAXONOMY_DUPLICATE');
    });

    it('ALLOWS the same topic name in a different domain', async () => {
      // A topic is unique within its domain, not globally: "Patching" means
      // something in Infrastructure and something else in SAP.
      const first = await newDomain('TOPICSCOPE_A');
      const second = await newDomain('TOPICSCOPE_B');
      const a = await createTopic(deps, actor, { domainId: first.domainId, name: 'Patching' });
      const b = await createTopic(deps, actor, { domainId: second.domainId, name: 'Patching' });
      expect(a.slug).toBe(b.slug);
      expect(a.domainId).not.toBe(b.domainId);
    });

    it('refuses a topic in a deactivated domain, because it could never be selected', async () => {
      const domain = await newDomain('TOPICINACTIVE');
      await updateDomain(deps, actor, { domainId: domain.domainId, isActive: false });
      await expect(
        createTopic(deps, actor, { domainId: domain.domainId, name: 'Unreachable' }),
      ).rejects.toThrow(/deactivated/);
    });

    it('records a rename as TOPIC_RENAMED, carrying the previous name', async () => {
      const domain = await newDomain('TOPICRENAME');
      const topic = await createTopic(deps, actor, {
        domainId: domain.domainId,
        name: 'Old Topic Name',
      });
      const renamed = await updateTopic(deps, actor, {
        topicId: topic.topicId,
        name: 'New Topic Name',
      });
      expect(renamed.slug).toBe('new-topic-name');

      const event = await prisma.auditEvent.findFirst({
        where: { action: 'ADMIN.TAXONOMY.TOPIC_RENAMED', entityId: topic.topicId },
        orderBy: { occurredAt: 'desc' },
      });
      // The previous name is the one fact the row cannot recover afterwards:
      // the topic no longer holds it anywhere.
      expect((event?.detail as Record<string, unknown>)['previousName']).toBe('Old Topic Name');
      expect((event?.detail as Record<string, unknown>)['_droppedKeys']).toBeUndefined();
    });

    it('records a deactivation as TOPIC_UPDATED with the field that changed', async () => {
      const domain = await newDomain('TOPICDEACT');
      const topic = await createTopic(deps, actor, {
        domainId: domain.domainId,
        name: 'To Be Deactivated',
      });
      const updated = await updateTopic(deps, actor, { topicId: topic.topicId, isActive: false });
      expect(updated.isActive).toBe(false);

      const event = await prisma.auditEvent.findFirst({
        where: { action: 'ADMIN.TAXONOMY.TOPIC_UPDATED', entityId: topic.topicId },
        orderBy: { occurredAt: 'desc' },
      });
      expect((event?.detail as Record<string, unknown>)['changedFields']).toEqual(['isActive']);
      expect((event?.detail as Record<string, unknown>)['domainCode']).toBe(domain.code);
    });

    it('refuses a rename onto a name another topic in the domain already holds', async () => {
      const domain = await newDomain('TOPICCLASH');
      await createTopic(deps, actor, { domainId: domain.domainId, name: 'First Topic' });
      const second = await createTopic(deps, actor, {
        domainId: domain.domainId,
        name: 'Second Topic',
      });
      await expect(
        updateTopic(deps, actor, { topicId: second.topicId, name: 'first topic' }),
      ).rejects.toThrow(/already occupies/);
    });
  });

  describe('search and filter', () => {
    it('finds a domain by code, by name, and by one of its topic names', async () => {
      const domain = await newDomain('SEARCHABLE', 'Findable Domain');
      await createTopic(deps, actor, {
        domainId: domain.domainId,
        name: 'Distinctive Topic Name',
      });

      for (const term of [`${PREFIX}_SEARCH`, 'findable dom', 'distinctive topic']) {
        const found = await readTaxonomy(deps, { query: term });
        expect(
          found.domains.map((row) => row.domainId),
          term,
        ).toContain(domain.domainId);
      }
    });

    it('scopes the topic list to one domain when asked', async () => {
      const domain = await newDomain('SCOPED');
      await createTopic(deps, actor, { domainId: domain.domainId, name: 'Only This One' });
      const read = await readTaxonomy(deps, { domainId: domain.domainId });
      expect(read.topics).toHaveLength(1);
      expect(read.topics[0]?.name).toBe('Only This One');
    });
  });
});
