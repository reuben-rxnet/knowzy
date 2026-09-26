// Question import routes.
//
//   POST /authoring/question-import/preview   detect and validate, write nothing
//   POST /authoring/question-import            create drafts from what was valid
//
// The import source is a document the platform has ALREADY SYNCHRONIZED, not a
// browser upload, and that is a deliberate boundary rather than an omission.
// The file has to become a knowledge document for an imported question to be
// groundable at all (see @knowzy/question-import), and the platform already
// has one proven, audited way for a file to become a document: drop it in a
// configured source folder and synchronize. Adding a second path — a multipart
// endpoint writing into a mounted volume — means filename traversal, a size
// ceiling, a type allow-list and a writable mount, each of which is a control
// that has to be right rather than present. It is recorded as the next step in
// the user guide rather than half-built here.
//
// PREVIEW WRITES NOTHING. That separation is the point of a two-call shape: an
// importer sees what was found, what was rejected and why, and only then
// decides. A single call that imported on sight would put somebody else's
// question bank into the review queue before anyone had read the summary.

import { z } from 'zod';
import {
  resolveImportTaxonomy,
  runQuestionImport,
  taxonomyResolver,
  type ImportTargetSection,
  type TaxonomyCatalogueDomain,
  type TaxonomyMappingChoice,
} from '@knowzy/domain';
import { detectQuestions, validateDetected, type ImportSection } from '@knowzy/question-import';
import { systemClock } from '@knowzy/observability';
import { defineRoute, type RouteContext, type RouteDeps } from '../http/route.js';
import type { ErrorCode } from '@knowzy/shared-types';
import { toProblem } from '../http/problem.js';
import type { FastifyReply } from 'fastify';

const Body = z
  .object({
    documentId: z.string().uuid(),
    // The FALLBACK domain and topic: used for a question whose file names no
    // taxonomy at all, never as a substitute for a name that was written and
    // not recognised.
    domainId: z.string().uuid(),
    topicId: z.string().uuid(),
    /** The organizational axes for the batch. Both optional. */
    departmentId: z.string().uuid().optional(),
    jobRoleId: z.string().uuid().optional(),
    /**
     * The importer's decisions about the names inside the file.
     *
     * One entry per detected (domain, topic) pair. Anything the file names and
     * this list does not resolve stops the import: a spreadsheet typo must
     * never create a domain code, because a code is permanent once a question
     * publishes under it.
     */
    mappings: z
      .array(
        z
          .object({
            domainName: z.string().max(200).nullable(),
            topicName: z.string().max(200).nullable(),
            domainId: z.string().uuid(),
            topicId: z.string().uuid(),
          })
          .strict(),
      )
      .max(200)
      .optional(),
  })
  .strict();

const problemReply = (
  reply: FastifyReply,
  ctx: RouteContext,
  instance: string,
  code: ErrorCode,
  detail: string,
): FastifyReply => {
  const problem = toProblem({ code, correlationId: ctx.correlationId, instance, detail });
  return reply.status(problem.status).type('application/problem+json').send(problem);
};

interface LoadedDocument {
  readonly sections: readonly ImportSection[];
  readonly targetSections: readonly ImportTargetSection[];
  readonly document: Parameters<typeof runQuestionImport>[0]['document'];
  readonly documentName: string;
}

/**
 * Loads a synchronized document and its sections.
 *
 * Sections are read from the CURRENT version counter only, so an import never
 * grounds a question in a section that a later synchronization replaced — the
 * same freshness rule generation applies at retrieval.
 */
const loadDocument = async (
  deps: RouteDeps,
  documentId: string,
): Promise<LoadedDocument | null> => {
  const row = await deps.prisma.knowledgeDocument.findUnique({
    where: { id: documentId },
    select: {
      id: true,
      sourceId: true,
      sourceDocumentId: true,
      name: true,
      sourceUrl: true,
      containerName: true,
      folderPath: true,
      sourceVersion: true,
      sourceETag: true,
      contentHash: true,
      extractedText: true,
      extractionStatus: true,
      localVersionCounter: true,
    },
  });
  // A document with no extracted text, or no content hash, cannot ground a
  // question: the hash is the revalidation comparator that gate 12 uses to
  // notice the file changed under an approved question.
  if (
    row === null ||
    row.extractionStatus !== 'EXTRACTED' ||
    row.extractedText === null ||
    row.contentHash === null
  ) {
    return null;
  }

  const sectionRows = await deps.prisma.documentSection.findMany({
    where: { documentId: row.id, documentVersionCounter: row.localVersionCounter },
    orderBy: { ordinal: 'asc' },
    select: {
      sectionKey: true,
      heading: true,
      pageNumber: true,
      slideNumber: true,
      sheetName: true,
      startOffset: true,
      endOffset: true,
      sectionContentHash: true,
      assessableCharCount: true,
    },
  });

  // The guard above returned for a null `extractedText`, so this narrowing is
  // safe. Asserted rather than defaulted: an empty string would make every
  // offset slice to '' and every span fail verification with no explanation.
  const text: string = row.extractedText;
  const sections: ImportSection[] = sectionRows.map((section) => ({
    sectionKey: section.sectionKey,
    heading: section.heading,
    pageNumber: section.pageNumber,
    slideNumber: section.slideNumber,
    sheetName: section.sheetName,
    startOffset: section.startOffset,
    // Sliced from the stored text with the stored offsets, which is the same
    // round-trip X2 guarantees and generation relies on. Read this way rather
    // than from a second copy, so a broken offset breaks here rather than
    // producing a span that cannot be re-located later.
    text: text.slice(section.startOffset, section.endOffset),
  }));

  return {
    sections,
    targetSections: sectionRows.map((section) => ({
      sectionKey: section.sectionKey,
      sectionContentHash: section.sectionContentHash,
      startOffset: section.startOffset,
      assessableCharCount: section.assessableCharCount,
      text: text.slice(section.startOffset, section.endOffset),
    })),
    document: {
      documentId: row.id,
      sourceId: row.sourceId,
      sourceDocumentId: row.sourceDocumentId,
      name: row.name,
      sourceUrl: row.sourceUrl,
      containerName: row.containerName,
      folderPath: row.folderPath,
      sourceVersion: row.sourceVersion,
      sourceETag: row.sourceETag,
      contentHash: row.contentHash,
    },
    documentName: row.name,
  };
};

/**
 * The taxonomy an import may map onto: ACTIVE only.
 *
 * A deactivated domain is deliberately not offerable. Importing into one would
 * create drafts that no generation run, assessment or selection screen can
 * ever see, which is worse than the refusal.
 */
const loadCatalogue = async (deps: RouteDeps): Promise<TaxonomyCatalogueDomain[]> => {
  const domains = await deps.prisma.domain.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
    select: {
      id: true,
      code: true,
      name: true,
      topics: {
        where: { isActive: true },
        orderBy: { name: 'asc' },
        select: { id: true, name: true },
      },
    },
  });
  return domains.map((domain) => ({
    domainId: domain.id,
    code: domain.code,
    name: domain.name,
    topics: domain.topics.map((topic) => ({ topicId: topic.id, name: topic.name })),
  }));
};

export const questionImportRoutes = [
  defineRoute({
    method: 'POST',
    url: '/api/v1/authoring/question-import/preview',
    policy: 'question.import',
    portal: 'AUTHORING',
    summary: 'Detects and validates questions in a synchronized document. Writes nothing.',
    handler: async (ctx, request, reply, deps) => {
      const body = Body.safeParse(request.body ?? {});
      if (!body.success) {
        return problemReply(
          reply,
          ctx,
          request.url,
          'VALIDATION_FAILED',
          `The field "${body.error.issues[0]?.path.join('.') ?? 'body'}" is missing or invalid.`,
        );
      }

      const loaded = await loadDocument(deps, body.data.documentId);
      if (loaded === null) {
        return problemReply(
          reply,
          ctx,
          request.url,
          'DOCUMENT_NOT_READY',
          'That document has no extracted text, so nothing can be detected in it. ' +
            'Synchronize the source first.',
        );
      }

      const detection = detectQuestions({
        fileName: loaded.documentName,
        sections: loaded.sections,
      });
      const outcome = validateDetected(detection.detected);

      // What the FILE says about taxonomy, resolved against what the platform
      // holds. Reported by the preview so the mapping choices appear before
      // anything is written -- which is the whole point of a preview.
      const mapping = resolveImportTaxonomy({
        detected: outcome.valid.map((question) => ({
          domainName: question.domainName,
          topicName: question.topicName,
        })),
        catalogue: await loadCatalogue(deps),
        ...(body.data.mappings === undefined
          ? {}
          : { mappings: body.data.mappings as TaxonomyMappingChoice[] }),
        fallback: { domainId: body.data.domainId, topicId: body.data.topicId },
      });

      return {
        documentId: body.data.documentId,
        documentName: loaded.documentName,
        strategy: detection.strategy,
        counts: {
          detected: detection.detected.length,
          valid: outcome.valid.length,
          invalid: outcome.invalid.length,
          unmappedTaxonomy: mapping.unmatched.length,
        },
        taxonomy: {
          resolutions: mapping.resolutions,
          unmatched: mapping.unmatched,
        },
        // A bounded preview. The importer needs to recognise their own bank,
        // not read all of it back.
        valid: outcome.valid.slice(0, 25).map((question) => ({
          ordinal: question.ordinal,
          locator: question.locator,
          questionText: question.questionText,
          options: question.options,
          correctOption: question.correctOption,
          explanation: question.explanation,
          domainName: question.domainName,
          topicName: question.topicName,
        })),
        invalid: outcome.invalid,
        detectionIssues: detection.issues,
      };
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/api/v1/authoring/question-import',
    policy: 'question.import',
    portal: 'AUTHORING',
    summary: 'Creates DRAFT questions from a synchronized document, through the same gates.',
    handler: async (ctx, request, reply, deps) => {
      const body = Body.safeParse(request.body ?? {});
      if (!body.success) {
        return problemReply(
          reply,
          ctx,
          request.url,
          'VALIDATION_FAILED',
          `The field "${body.error.issues[0]?.path.join('.') ?? 'body'}" is missing or invalid.`,
        );
      }

      const loaded = await loadDocument(deps, body.data.documentId);
      if (loaded === null) {
        return problemReply(
          reply,
          ctx,
          request.url,
          'DOCUMENT_NOT_READY',
          'That document has no extracted text, so nothing can be imported from it.',
        );
      }

      const detection = detectQuestions({
        fileName: loaded.documentName,
        sections: loaded.sections,
      });
      const outcome = validateDetected(detection.detected);

      // Taxonomy first, and a refusal for the WHOLE file rather than a partial
      // import: a bank half-filed under the right domains and half under a
      // dropdown's default is harder to correct than one that never landed.
      const mapping = resolveImportTaxonomy({
        detected: outcome.valid.map((question) => ({
          domainName: question.domainName,
          topicName: question.topicName,
        })),
        catalogue: await loadCatalogue(deps),
        ...(body.data.mappings === undefined
          ? {}
          : { mappings: body.data.mappings as TaxonomyMappingChoice[] }),
        fallback: { domainId: body.data.domainId, topicId: body.data.topicId },
      });
      if (mapping.unmatched.length > 0) {
        const named = mapping.unmatched
          .slice(0, 5)
          .map(
            (entry) =>
              `"${entry.domainName ?? ''}" / "${entry.topicName ?? ''}" (${entry.questionCount})`,
          )
          .join(', ');
        return problemReply(
          reply,
          ctx,
          request.url,
          'TAXONOMY_MAPPING_REQUIRED',
          `${mapping.unmatched.length} domain/topic value(s) in this file do not exist here: ` +
            `${named}. Map each one to an existing domain and topic, or create them in ` +
            'Administration first. An import never creates taxonomy, because a spreadsheet typo ' +
            'would become a permanent domain code.',
        );
      }

      // The profile supplies the evidence mode and the duplicate thresholds,
      // so an import is held to the SAME configured standard as a generation
      // run rather than to constants chosen here.
      const profile = await deps.prisma.generationProfile.findFirstOrThrow({
        where: { isActive: true },
        select: {
          evidenceStrictness: true,
          duplicateFlagThreshold: true,
          duplicateBlockThreshold: true,
          coverageSettings: true,
        },
      });
      const coverage = profile.coverageSettings as { minAssessableChars?: number };

      const result = await runQuestionImport({
        prisma: deps.prisma,
        clock: systemClock,
        document: loaded.document,
        sections: loaded.targetSections,
        questions: outcome.valid,
        domainId: body.data.domainId,
        topicId: body.data.topicId,
        // The organizational axes, for the whole batch. A file of questions is
        // typically one team's bank, so the choice is made once per import.
        ...(body.data.departmentId === undefined ? {} : { departmentId: body.data.departmentId }),
        ...(body.data.jobRoleId === undefined ? {} : { jobRoleId: body.data.jobRoleId }),
        resolveTaxonomy: taxonomyResolver(mapping),
        evidenceMode: profile.evidenceStrictness,
        thresholds: {
          flagThreshold: Number(profile.duplicateFlagThreshold),
          blockThreshold: Number(profile.duplicateBlockThreshold),
        },
        minAssessableChars: coverage.minAssessableChars ?? 300,
        actor: {
          userId: ctx.subject.userId,
          displayName: ctx.subject.displayName,
          roles: ctx.subject.roles,
        },
        correlationId: ctx.correlationId,
        requestId: ctx.requestId,
      });

      return {
        documentId: body.data.documentId,
        documentName: loaded.documentName,
        strategy: detection.strategy,
        counts: {
          detected: detection.detected.length,
          valid: outcome.valid.length,
          invalid: outcome.invalid.length,
          created: result.createdQuestionIds.length,
          rejected: result.rejections.length,
        },
        createdQuestionIds: result.createdQuestionIds,
        // Both kinds of refusal, kept apart: `invalid` never reached a gate,
        // `rejected` reached one and failed it. Collapsing them would hide
        // which of the two an importer has to fix.
        invalid: outcome.invalid,
        rejected: result.rejections,
        detectionIssues: detection.issues,
      };
    },
  }),
];
