// Shared helpers for driving the two portals.
//
// The rule these follow: **the assertions are about the product, the helpers
// are about getting there.** A helper may call the API to establish a
// precondition (a synchronized source, a draft that exists), because asserting
// on the state of a screen is the point and re-driving twelve screens to reach
// the thirteenth makes a suite nobody keeps. What a helper must never do is
// assert a product behaviour on the caller's behalf, or reach into the
// database to make something true that the product would have refused.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';

export const API = process.env['E2E_API_URL'] ?? 'http://localhost:8080';

/** The seeded local identities the portals' pickers offer. */
// Two identities since the Authoring Role Simplification (2026-10-07,
// docs/access-control.md §2.0). The author, approver, publisher and second
// administrator are deprovisioned and appear in no picker.
export const IDENTITY = {
  administrator: 'knowzy-administrator@local.invalid',
  learner: 'learner@local.invalid',
} as const;

export type Identity = (typeof IDENTITY)[keyof typeof IDENTITY];

/**
 * Switches identity through the SCREEN, not by setting a cookie.
 *
 * Deliberate: the identity control is a real control, and a test that sets the
 * cookie directly would keep passing after the control broke. Gate 13 is
 * demonstrated by two identities using the product, so the switch is part of
 * what is being tested.
 */
export const actAs = async (page: Page, identity: Identity): Promise<void> => {
  const label = new RegExp(identityLabel(identity), 'i');
  await page.goto('/');

  // STRENGTHENED 2026-09-24. This used to click and then assert the radio was
  // checked -- which the click itself guarantees, so a switch that never
  // reached the server still read as success. It was invisible while every
  // spec switched only to identities whose pages look the same when the switch
  // fails, and it surfaced the moment one asserted a REFUSAL: the page rendered
  // as the administrator, the refusal never appeared, and the test blamed the
  // page.
  //
  // The assertion is still on the SHELL's acting-as label, which is server
  // state, with one retry -- the switch is a server action and a click landing
  // before hydration does nothing and leaves no trace.
  //
  // REWORKED 2026-09-26: the picker moved from a card on the home page to the
  // header's profile menu, which holds one submit button per identity. The menu
  // is opened first, because its contents are not in the DOM until then -- and
  // Playwright reporting a button as "not visible" rather than "not there" is
  // the confusing half of that.
  for (const attempt of [1, 2]) {
    await openIdentityMenu(page);
    await page.locator('header').getByRole('button', { name: label }).first().click();
    try {
      // `.first()` is the acting-as label rather than the menu's own copy of
      // the same name: the label precedes `identityAction` in the header's DOM
      // order, and the menu is closed again after the action re-renders.
      await expect(page.locator('header').getByText(label).first()).toBeVisible({
        timeout: 10_000,
      });
      return;
    } catch (error) {
      if (attempt === 2) throw error;
      await page.goto('/');
    }
  }
};

/**
 * Opens the header's identity menu, and leaves it open if it already was.
 *
 * The trigger TOGGLES, so clicking unconditionally closes a menu that a retry
 * had already opened -- and the failure then reads as a missing button rather
 * than as a closed menu. `aria-expanded` is the state to test: it is the same
 * fact a screen reader is given.
 */
export const openIdentityMenu = async (page: Page): Promise<void> => {
  const trigger = page.locator('header button[aria-haspopup="menu"]');
  // A GENEROUS timeout, because the first navigation into a route in this suite
  // can land while `next dev` is still compiling it -- and then the header has
  // not rendered, the trigger is genuinely absent, and the failure reads as a
  // missing control rather than as a cold compile. 30s is the observed worst
  // case for a cold route on this machine; the production build compiles
  // nothing at request time and never needs it.
  await expect(trigger).toBeVisible({ timeout: 30_000 });
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
};

/** The label the picker shows for a UPN, matched loosely enough to survive a rename. */
const identityLabel = (identity: Identity): string => {
  switch (identity) {
    case IDENTITY.administrator:
      return 'Authoring Administrator';
    case IDENTITY.learner:
      // Anchored: the learner portal also lists the administrator, whose
      // description mentions neither word, but a future "Learner lead" would
      // match an unanchored 'Learner'.
      return '^Learner( |$)';
    default:
      return identity;
  }
};

interface ApiOptions {
  readonly method?: 'GET' | 'POST' | 'PATCH' | 'PUT';
  readonly as?: Identity;
  readonly body?: unknown;
  /** Accept a non-2xx response instead of failing. */
  readonly allowFailure?: boolean;
}

/** A direct API call, for preconditions and for reading state back. */
export const api = async <T>(
  request: APIRequestContext,
  path: string,
  options: ApiOptions = {},
): Promise<T> => {
  const response = await request.fetch(`${API}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'x-knowzy-subject': options.as ?? IDENTITY.administrator,
      ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(options.body === undefined ? {} : { data: JSON.stringify(options.body) }),
  });
  const text = await response.text();
  if (!response.ok() && options.allowFailure !== true) {
    throw new Error(
      `${options.method ?? 'GET'} ${path} -> ${response.status()}: ${text.slice(0, 400)}`,
    );
  }
  return (text.length === 0 ? {} : JSON.parse(text)) as T;
};

interface SourceRow {
  readonly sourceId: string;
  readonly name: string;
  readonly documentCount: number;
}

export const mockSource = async (request: APIRequestContext): Promise<SourceRow> => {
  const sources = await api<{ sources: SourceRow[] }>(request, '/api/v1/authoring/sources');
  const source = sources.sources.find((candidate) => candidate.name === 'Mock Support Operations');
  if (source === undefined) throw new Error('The seeded mock source is missing.');
  return source;
};

/**
 * Guarantees the mock source has an extracted document, synchronizing if not.
 *
 * A freshly seeded database has one source and ZERO documents — the seed
 * leaves the source UNTESTED on purpose — so every flow below needs this
 * first, and it is exactly what step 4 of the acceptance script does.
 */
export const ensureSynchronized = async (request: APIRequestContext): Promise<SourceRow> => {
  const source = await mockSource(request);
  if (source.documentCount > 0) return source;
  await api(request, `/api/v1/authoring/sources/${source.sourceId}/test-connection`, {
    method: 'POST',
    body: {},
  });
  await api(request, `/api/v1/authoring/sources/${source.sourceId}/synchronize`, {
    method: 'POST',
    body: {},
  });
  return mockSource(request);
};

// ---------------------------------------------------------------------------
// The suite's OWN source (2026-10-07).
//
// Every run approves and publishes template-generator drafts, and the small
// seeded Mock Support Operations source ran out: the generator found nothing
// new in it, and no DRAFT was left to fall back on, so eight specs failed in
// this helper before reaching anything they test. So the suite now OWNS a
// source -- "E2E Synthetic Corpus", a FILE_REPOSITORY under the allowed root
// /repo/RealWorldPilot -- and writes a fresh synthetic SOP into it each time it
// needs a draft. The content is invented for the test (no company document),
// every figure in it varies with the run, and the folder is git-ignored.
// Nothing here touches a real or demonstration draft.

const SYNTHETIC_NAME = 'E2E Synthetic Corpus';
const SYNTHETIC_ROOT_IN_CONTAINER = '/repo/RealWorldPilot/E2E-Synthetic';
const SYNTHETIC_ROOT_ON_HOST = fileURLToPath(
  // The documents sit in a CONTAINER folder below the root, as the
  // GenerationReady source's do: a file directly in the root has no container.
  new URL('../../../../RealWorldPilot/E2E-Synthetic/Synthetic/', import.meta.url),
);

/**
 * A synthetic SOP that differs from every other run's in its WORDS, not only
 * its figures. The duplicate gate compares question text: a document that only
 * changed its numbers produced drafts 0.776 similar to the previous run's, over
 * the 0.75 threshold, and submit was refused -- correctly. So the roles, the
 * items, the channels and an invented codename are drawn per run as well.
 */
const PICK = {
  desk: [
    'Orbit',
    'Larch',
    'Quarry',
    'Beacon',
    'Tundra',
    'Saffron',
    'Harbor',
    'Juniper',
    'Cobalt',
    'Mesa',
    'Willow',
    'Falcon',
  ],
  actor: [
    'agent',
    'clerk',
    'technician',
    'coordinator',
    'operator',
    'analyst',
    'dispatcher',
    'adviser',
  ],
  item: [
    'service credit',
    'replacement part',
    'loan device',
    'fee waiver',
    'travel voucher',
    'license extension',
    'shipping refund',
    'repair credit',
  ],
  approver: [
    'team lead',
    'shift supervisor',
    'section head',
    'desk manager',
    'quality lead',
    'operations lead',
  ],
  record: ['ticket', 'case file', 'work order', 'request log', 'job sheet', 'service record'],
  channel: ['phone', 'chat', 'portal', 'email', 'kiosk', 'field visit'],
  syllable: [
    'ka',
    'zu',
    'ri',
    'mo',
    'ven',
    'tal',
    'oro',
    'pex',
    'sil',
    'dra',
    'nu',
    'qui',
    'bel',
    'cor',
    'fa',
    'lyn',
  ],
} as const;

export const syntheticSop = (stamp: string): string => {
  const pick = <T>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)] as T;
  const num = (low: number, high: number): number => low + Math.floor(Math.random() * (high - low));
  const codename = Array.from({ length: 4 }, () => pick(PICK.syllable)).join('');
  const desk = pick(PICK.desk);
  const actor = pick(PICK.actor);
  const item = pick(PICK.item);
  const approver = pick(PICK.approver);
  const record = pick(PICK.record);
  const channel = pick(PICK.channel);
  return [
    `# ${desk} ${codename} Procedure ${stamp}`,
    '',
    `This synthetic procedure exists only for the browser test run ${stamp}. It sets out how a`,
    `${actor} on the fictional ${desk} desk handles a ${item} requested through the ${channel} channel.`,
    '',
    `## ${codename} Authority Limits`,
    '',
    `A ${actor} may grant a ${item} worth up to ${num(2, 90) * 10} ${codename} units without further`,
    `review. A ${item} above that requires the ${approver}'s approval, recorded in the ${record}`,
    `before anything is granted, and the ${approver} may not approve a request they raised.`,
    `Above ${num(10, 99) * 100} units the ${desk} director must also approve in writing, and the`,
    `${actor} attaches that written approval to the ${record} before closing it.`,
    '',
    `## ${codename} Response Windows`,
    '',
    `A ${channel} request marked urgent must receive a first response within ${num(5, 55)} minutes.`,
    `A standard ${channel} request must receive one within ${num(2, 23)} hours, and an unanswered`,
    `${record} is escalated to the ${approver} the moment that window passes. A low-priority`,
    `request must receive a first response within ${num(2, 9)} working days; the clock pauses only`,
    `while the ${record} is waiting for information the requester has to supply.`,
    '',
    `## ${codename} Retention`,
    '',
    `Every closed ${record} is retained for ${num(6, 60)} months. A ${record} that grants a ${item}`,
    `keeps the approval reference beside the amount, and a ${item} with no reference is reversed`,
    `at the ${desk} monthly review. A ${record} that names a person is retained for`,
    `${num(30, 120)} days instead, and the ${actor} marks it so it is removed on time.`,
    '',
  ].join('\n');
};

const ensureSyntheticSource = async (request: APIRequestContext): Promise<SourceRow> => {
  mkdirSync(SYNTHETIC_ROOT_ON_HOST, { recursive: true });
  const sources = await api<{ sources: SourceRow[] }>(request, '/api/v1/authoring/sources');
  const existing = sources.sources.find((candidate) => candidate.name === SYNTHETIC_NAME);
  if (existing !== undefined) return existing;
  const created = await api<{ source: { sourceId: string } }>(
    request,
    '/api/v1/authoring/sources',
    {
      method: 'POST',
      body: {
        name: SYNTHETIC_NAME,
        description:
          'Owned by the browser test suite. Synthetic documents only, written per run; never a company document.',
        sourceType: 'FILE_REPOSITORY',
        localRoot: SYNTHETIC_ROOT_IN_CONTAINER,
        usableForGeneration: true,
      },
    },
  );
  await api(request, `/api/v1/authoring/sources/${created.source.sourceId}/paths`, {
    method: 'POST',
    body: { containerName: 'Synthetic', folderPath: '/', isActive: true },
  });
  await api(request, `/api/v1/authoring/sources/${created.source.sourceId}/activate`, {
    method: 'POST',
    body: {},
  });
  const after = await api<{ sources: SourceRow[] }>(request, '/api/v1/authoring/sources');
  const source = after.sources.find((candidate) => candidate.name === SYNTHETIC_NAME);
  if (source === undefined) throw new Error('The synthetic source was not created.');
  return source;
};

/** Write a fresh synthetic SOP, synchronize, and return its document id. */
const freshSyntheticDocument = async (
  request: APIRequestContext,
): Promise<{ readonly sourceId: string; readonly documentId: string }> => {
  const stamp = `R${Date.now().toString(36).toUpperCase()}`;
  const fileName = `synthetic-${stamp}.md`;
  mkdirSync(SYNTHETIC_ROOT_ON_HOST, { recursive: true });
  writeFileSync(join(SYNTHETIC_ROOT_ON_HOST, fileName), syntheticSop(stamp));
  const source = await ensureSyntheticSource(request);
  await api(request, `/api/v1/authoring/sources/${source.sourceId}/test-connection`, {
    method: 'POST',
    body: {},
  });
  await api(request, `/api/v1/authoring/sources/${source.sourceId}/synchronize`, {
    method: 'POST',
    body: {},
  });
  const containers = await api<{ containers: { containerId: string }[] }>(
    request,
    `/api/v1/authoring/sources/${source.sourceId}/containers`,
  );
  for (const container of containers.containers) {
    // Every page: the synthetic folder grows by a file per draft, and the
    // listing is paged. Looking at the first page only failed once the
    // folder passed one page, with the document extracted all along.
    let cursor: string | null = null;
    for (let page = 0; page < 50; page += 1) {
      const items: {
        items: { name: string; documentId: string | null; isSelectable: boolean }[];
        nextCursor?: string | null;
      } = await api(
        request,
        `/api/v1/authoring/sources/${source.sourceId}/items` +
          `?containerId=${encodeURIComponent(container.containerId)}&recursive=true&pageSize=200` +
          (cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`),
      );
      const item = items.items.find((candidate) => candidate.name === fileName);
      if (item?.documentId != null && item.isSelectable) {
        return { sourceId: source.sourceId, documentId: item.documentId };
      }
      cursor = items.nextCursor ?? null;
      if (cursor === null) break;
    }
  }
  throw new Error(`The synthetic document ${fileName} was not extracted after synchronize.`);
};

interface Taxonomy {
  readonly domains: readonly {
    readonly domainId: string;
    readonly code: string;
    readonly topics: readonly { readonly topicId: string; readonly name: string }[];
  }[];
}

/** The seeded domain by CODE, so added taxonomy cannot change what a test uses. */
export const seededTaxonomy = async (
  request: APIRequestContext,
): Promise<{ domainId: string; topicId: string }> => {
  const taxonomy = await api<Taxonomy>(request, '/api/v1/authoring/taxonomy');
  const domain =
    taxonomy.domains.find((candidate) => candidate.code === 'SUPPORT_OPS') ?? taxonomy.domains[0];
  const topic = domain?.topics[0];
  if (domain === undefined || topic === undefined) throw new Error('No seeded taxonomy.');
  return { domainId: domain.domainId, topicId: topic.topicId };
};

/**
 * A DRAFT question that exists, generated through the real pipeline.
 *
 * Returns its id. Preflight → decide → job, which is steps 7–9 of the
 * acceptance script; the authoring spec drives the same path through the
 * SCREEN and asserts on it. This helper exists for the specs that need a
 * draft in order to test something further down the workflow.
 */
export const generateDraft = async (
  request: APIRequestContext,
  as: Identity = IDENTITY.administrator,
): Promise<string> => {
  // From the suite's own synthetic source, so a draft is always available and
  // no real or demonstration draft is consumed (see freshSyntheticDocument).
  const { sourceId, documentId } = await freshSyntheticDocument(request);
  const documentIds = [documentId];
  const source = { sourceId };

  const preflight = await api<{ preflightId: string }>(
    request,
    '/api/v1/authoring/generation/preflight',
    { method: 'POST', as, body: { sourceId: source.sourceId, documentIds } },
  );
  await api(request, `/api/v1/authoring/generation/preflight/${preflight.preflightId}/decide`, {
    method: 'POST',
    as,
    body: { chosenAction: 'GENERATE_NEW' },
  });

  const taxonomy = await seededTaxonomy(request);
  const job = await api<{ createdQuestionIds?: string[]; questionIds?: string[] }>(
    request,
    '/api/v1/authoring/generation-jobs',
    {
      method: 'POST',
      as,
      body: {
        preflightId: preflight.preflightId,
        scope: 'ENTIRE_DOCUMENT',
        domainId: taxonomy.domainId,
        topicId: taxonomy.topicId,
        reasonCode: 'NEW_KNOWLEDGE',
        requestedQuestionCount: 3,
      },
    },
  );

  const created = job.questionIds ?? job.createdQuestionIds ?? [];
  if (created.length > 0) return created[0] as string;

  // The generator refuses a section it cannot build a question from, and on a
  // corpus it has already exhausted it refuses everything. Fall back to a
  // draft that already exists rather than reporting a product failure.
  // DETERMINISTIC_LOCAL only (EVAL-M1). The queue now also holds real Codex
  // drafts of company SOPs, and this fallback's draft is approved and
  // PUBLISHED by the suite -- a test must never turn a reviewer's real draft
  // into a fixture in the bank.
  const queue = await api<{ items: { questionId: string; status: string }[] }>(
    request,
    '/api/v1/authoring/questions/review?queue=author&generator=DETERMINISTIC_LOCAL&limit=100',
  );
  const draft = queue.items.find((candidate) => candidate.status === 'DRAFT');
  if (draft === undefined) {
    throw new Error('No draft could be generated and none exists — cannot run this flow.');
  }
  return draft.questionId;
};

/**
 * The card for one source, scoped by its own heading.
 *
 * The sources screen is a table of sources PLUS one card per source carrying
 * its actions, so `getByRole('row', { name })` finds the row and none of the
 * buttons -- the first version of this suite timed out on exactly that. A
 * `<section>` filtered by its heading is the narrowest honest scope: the
 * table's own card has a different heading, so this cannot match two things.
 */
export const sourceCard = (page: Page, sourceName: string): Locator =>
  page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: sourceName, exact: true }) });

/**
 * One decision button on the question page, located by the label it starts
 * with.
 *
 * Neither obvious approach works, and both failures are worth recording:
 *
 *   - `getByRole('button', { name: /^Approve/ })` finds nothing, because a
 *     blocked decision renders its reason as an sr-only span INSIDE the
 *     button, so the accessible name is `ApproveNot possible while ...`.
 *   - `getByRole('button', { name: 'Approve' })` matches THREE buttons, because
 *     a string name is a case-insensitive substring and the blocked reasons
 *     contain "Available from here: APPROVED".
 *
 * Anchoring on the element's own text is the narrow version: it matches the
 * label at the start and ignores whatever the reason says.
 */
export const decision = (page: Page, label: string): Locator =>
  page.locator('button').filter({ hasText: new RegExp(`^${label}`) });

interface PublishedQuestion {
  readonly questionId: string;
  readonly topicId?: string;
}

/**
 * Guarantees a PUBLISHED assessment a learner can start, creating one if the
 * database has none.
 *
 * The learner specs used to skip themselves when nothing was published, which
 * is honest and nearly useless: the flow that most needs a browser test would
 * never run. This provisions the precondition the same way a person does --
 * publish questions, then create and publish an assessment over them -- and it
 * refuses to fabricate anything the platform would not allow, so an
 * assessment whose pool is too small still fails here rather than being
 * forced through.
 */
export const ensurePublishedAssessment = async (
  request: APIRequestContext,
): Promise<{ readonly name: string }> => {
  // PUBLISHED is read from `versionStatus`, which is the field the payload
  // actually carries. An earlier version of this helper tested
  // `publishedVersionId !== null` on a field that does not exist -- undefined
  // is not null, so it concluded an assessment was already published, created
  // nothing, and the learner specs failed on an empty list.
  const existing = await api<{
    assessments: { name: string; versionStatus: string; pinnedPoolSize: number | null }[];
  }>(request, '/api/v1/authoring/assessments');
  const published = existing.assessments.find(
    (candidate) => candidate.versionStatus === 'PUBLISHED',
  );
  if (published !== undefined) return { name: published.name };

  // Publish enough questions for a pool. Each goes through the real workflow,
  // including the identity switch gate 13 requires.
  const bank = await api<{ items: { questionId: string; topicId?: string }[] }>(
    request,
    '/api/v1/authoring/questions/review?queue=published',
  );
  let pool: PublishedQuestion[] = bank.items;

  if (pool.length < 2) {
    for (let index = 0; index < 2; index += 1) {
      const questionId = await generateDraft(request);
      await api(request, `/api/v1/authoring/questions/${questionId}/claim`, {
        method: 'POST',
        body: {},
        allowFailure: true,
      });
      await api(request, `/api/v1/authoring/questions/${questionId}/submit`, {
        method: 'POST',
        body: {},
        allowFailure: true,
      });
      await api(request, `/api/v1/authoring/questions/${questionId}/approve`, {
        method: 'POST',
        body: {},
        allowFailure: true,
      });
      await api(request, '/api/v1/authoring/question-bank/publish', {
        method: 'POST',
        body: { questionIds: [questionId] },
        allowFailure: true,
      });
    }
    const refreshed = await api<{ items: { questionId: string; topicId?: string }[] }>(
      request,
      '/api/v1/authoring/questions/review?queue=published',
    );
    pool = refreshed.items;
  }
  if (pool.length === 0) {
    throw new Error('No published question exists, so no assessment can be built.');
  }

  const taxonomy = await seededTaxonomy(request);
  const suffix = Date.now().toString(36);
  const created = await api<{ assessmentVersionId: string }>(
    request,
    '/api/v1/authoring/assessments',
    {
      method: 'POST',
      body: {
        name: `E2E acceptance ${suffix}`,
        slug: `e2e-acceptance-${suffix}`,
        domainId: taxonomy.domainId,
        topicIds: [taxonomy.topicId],
        // One question per attempt: the smallest attempt that still exercises
        // start, answer, resume, finish and score. A bigger pool would make
        // the test slower without testing anything more.
        questionCount: 1,
        selectionStrategy: 'RANDOM_POOL',
        passPercentage: 70,
      },
    },
  );

  await api(request, `/api/v1/authoring/assessments/${created.assessmentVersionId}/publish`, {
    method: 'POST',
    body: {},
  });

  return { name: `E2E acceptance ${suffix}` };
};

/**
 * Guarantees at least one SCORED attempt, taking one as the learner if needed.
 *
 * The suppression test used to say its precondition came from
 * `ensurePublishedAssessment`, which publishes an assessment and takes no
 * attempt. It passed only while an earlier run's result was still in the
 * database; after `npm run verify` emptied it, the learner specs created the
 * first result minutes AFTER the reports spec had refreshed the read models,
 * and the test failed. The precondition is now provisioned, through the same
 * learner API the portal calls, answering every question with option A — the
 * score does not matter, only that a scored result exists.
 */
export const ensureScoredAttempt = async (request: APIRequestContext): Promise<void> => {
  const { name } = await ensurePublishedAssessment(request);
  const list = await api<{
    assessments: readonly {
      assessmentId: string;
      name: string;
      startable: boolean;
      attemptsUsed: number;
    }[];
  }>(request, '/api/v1/learning/assessments', { as: IDENTITY.learner });
  // One is enough, and taking another every run would walk the learner into
  // an attempt limit.
  if (list.assessments.some((candidate) => candidate.attemptsUsed > 0)) return;
  const target =
    list.assessments.find((candidate) => candidate.name === name && candidate.startable) ??
    list.assessments.find((candidate) => candidate.startable);
  if (target === undefined) {
    throw new Error('No assessment is startable by the learner, so no attempt can be scored.');
  }

  const session = await api<{ sessionId: string; totalQuestions: number }>(
    request,
    '/api/v1/learning/sessions',
    { method: 'POST', as: IDENTITY.learner, body: { assessmentId: target.assessmentId } },
  );
  for (let index = 0; index < session.totalQuestions; index += 1) {
    await api(request, `/api/v1/learning/sessions/${session.sessionId}/answers`, {
      method: 'POST',
      as: IDENTITY.learner,
      body: { questionIndex: index, selectedOption: 'A' },
      allowFailure: true,
    });
  }
  await api(request, `/api/v1/learning/sessions/${session.sessionId}/complete`, {
    method: 'POST',
    as: IDENTITY.learner,
    body: {},
  });
};
