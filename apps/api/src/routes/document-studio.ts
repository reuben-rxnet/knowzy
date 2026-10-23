// AI Document Studio routes (docs/competencies/AI_DOCUMENT_STUDIO_ARCHITECTURE.md
// §10 Slice 2, §11 M3).
//
//   GET  /authoring/document-studio/status                          readiness + what can prepare now
//   PUT  /authoring/document-studio/approvals/:providerId           DOCUMENT_RESTRUCTURE approval
//   GET  /authoring/document-studio/mode                            the mode alone, unaudited (the sidebar)
//   PUT  /authoring/document-studio/mode                            Simple or Full Studio (§12)
//   GET  /authoring/document-studio/documents                       My prepared documents
//   POST /authoring/document-studio/documents                       choose an existing document
//   GET  /authoring/document-studio/documents/:id                   original, versions, current
//   POST /authoring/document-studio/documents/:id/preparations      Prepare for question generation
//   GET  /authoring/document-studio/history                         History
//   GET  /authoring/document-studio/candidates                      documents that may be chosen
//   POST /authoring/document-studio/uploads                         Upload (8 MiB, base64); QUIZ in Simple mode
//   PUT  /authoring/document-studio/versions/:id/content            Save changes
//   POST /authoring/document-studio/versions/:id/restore            Restore AI version
//   POST /authoring/document-studio/versions/:id/discard            Discard draft
//   POST /authoring/document-studio/versions/:id/revalidation-draft Review against the updated original
//   POST /authoring/document-studio/versions/:id/repository         Add to Question Generation Repository
//   GET  /authoring/document-studio/versions/:id/download           Download Word / PDF
//
// Reads are `document.browse`; every write and every download is
// `document.prepare`; the approval stays `governance.ai.manage`. There is NO
// delete route: a prepared version is never destructively deleted (§11.6).
//
// THE LIVE PREPARER IS BUILT HERE ONLY WHEN READINESS IS READY -- approval,
// client and configuration -- and the test preparer only where the local-only
// flag allows. The domain receives either, or neither, and refuses with the
// brief's own sentence when it gets neither.

import { z } from 'zod';
import {
  acceptQuizUpload,
  acceptUpload,
  addToRepository,
  DocumentPreparationError,
  DocumentStudioError,
  listPreparedDocuments,
  preparationCandidates,
  prepareDocument,
  preparedDocumentDetail,
  preparedExportFor,
  readDocumentStudioStatus,
  readStudioMode,
  readyRestructureProvider,
  recordDownload,
  recordUploadRefused,
  rejectDraft,
  restoreAiVersion,
  reviewAgainstUpdatedOriginal,
  revalidatePreparedVersions,
  savePreparedContent,
  setPurposeApproval,
  setStudioMode,
  STUDIO_MODES,
  startFromDocument,
  studioHistory,
  inspectUpload,
  UPLOAD_MAX_BYTES,
  type StudioContext,
  type StudioSync,
} from '@knowzy/domain';
import {
  createOpenAIPreparer,
  createTestPreparer,
  OpenAIGenerationError,
  PreparationError,
  type DocumentPreparer,
} from '@knowzy/claude-services';
// B2: the API never parses a document. The writers render one from a value
// object (certificate-generator), and the upload's byte checks are domain
// policy; the extraction itself runs in the synchronization, through MCP.
import { writePreparedDocx, writePreparedPdf } from '@knowzy/certificate-generator';
import { systemClock } from '@knowzy/observability';
import {
  GenerationProviderSchema,
  preparedDownloadName,
  type ErrorCode,
} from '@knowzy/shared-types';
import type { FastifyReply } from 'fastify';
import { defineRoute, type RouteContext, type RouteDeps } from '../http/route.js';
import { toProblem } from '../http/problem.js';
import { loadControlLayer } from '../generation/control-layer.js';
import { resolveOpenAICallConfig } from '../generation/openai-provider.js';
import { createStudioStorage } from '../document-studio/storage.js';
import { replyFromMcpError } from './sources.js';
import { McpCallError } from '../mcp/client.js';

const context = (ctx: RouteContext, deps: RouteDeps): StudioContext => ({
  prisma: deps.prisma,
  clock: systemClock,
  actor: {
    userId: ctx.subject.userId,
    displayName: ctx.subject.displayName,
    roles: ctx.subject.roles,
  },
  correlationId: ctx.correlationId,
  requestId: ctx.requestId,
});

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

const refuse = (reply: FastifyReply, ctx: RouteContext, instance: string, detail: string) =>
  problemReply(reply, ctx, instance, 'VALIDATION_FAILED', detail);

/** Domain refusals become problems; MCP failures map as on the Sources screen. */
const handle = async (
  reply: FastifyReply,
  ctx: RouteContext,
  instance: string,
  work: () => Promise<unknown>,
): Promise<unknown> => {
  try {
    return await work();
  } catch (error) {
    if (error instanceof DocumentPreparationError) {
      return problemReply(reply, ctx, instance, error.code, error.message);
    }
    if (error instanceof McpCallError) return replyFromMcpError(error, ctx, reply, instance);
    throw error;
  }
};

const storageRoot = (deps: RouteDeps): string | null => deps.documentStudio?.storageDir ?? null;

const NO_STORAGE =
  'Uploading and adding to the repository are not available here: no Studio storage directory is configured for this environment.';

/** Test connection and synchronize through MCP, as the caller -- as every sync is. */
const studioSync = (ctx: RouteContext, deps: RouteDeps): StudioSync => {
  const call = async (tool: string, args: Record<string, unknown>): Promise<void> => {
    await deps.mcp.call({
      tool,
      subject: ctx.subject,
      scope: ctx.scope,
      portal: ctx.portal,
      correlationId: ctx.correlationId,
      requestId: ctx.requestId,
      arguments: args,
    });
  };
  return {
    testConnection: (sourceId) => call('test_knowledge_source', { sourceId }),
    synchronize: (sourceId) => call('synchronize_knowledge_source', { sourceId, mode: 'FULL' }),
  };
};

/**
 * The live preparer, only when DOCUMENT_RESTRUCTURE readiness is READY. The
 * key is resolved inside the call, through the audited resolver, for purpose
 * DOCUMENT_RESTRUCTURE.
 */
const livePreparer = async (
  ctx: RouteContext,
  deps: RouteDeps,
): Promise<DocumentPreparer | null> => {
  const ready = await readyRestructureProvider(deps.prisma, systemClock);
  if (ready.providerId !== 'OPENAI') return null;
  const control = await loadControlLayer(deps.prisma);
  const modelId = control.providerSettings.OPENAI?.modelId;
  if (modelId === undefined) return null;
  return createOpenAIPreparer({
    modelId,
    configure: async () => {
      try {
        return await resolveOpenAICallConfig({
          prisma: deps.prisma,
          secrets: deps.secrets,
          caller: {
            userId: ctx.subject.userId,
            displayName: ctx.subject.displayName,
            roles: ctx.subject.roles,
            correlationId: ctx.correlationId,
            requestId: ctx.requestId,
          },
          purpose: 'DOCUMENT_RESTRUCTURE',
        });
      } catch (error) {
        if (error instanceof OpenAIGenerationError) {
          throw new PreparationError(
            error.code === 'CREDENTIAL_UNRESOLVED' ? 'CREDENTIAL_UNRESOLVED' : 'NOT_CONFIGURED',
            error.message,
          );
        }
        throw error;
      }
    },
    ...(deps.secrets?.fetch === undefined ? {} : { fetch: deps.secrets.fetch }),
  });
};

const testPreparer = (deps: RouteDeps): DocumentPreparer | null =>
  deps.documentStudio?.testPreparationEnabled === true ? createTestPreparer() : null;

const Uuid = z.string().uuid();
const IdParams = z.object({ id: Uuid });

const UploadBody = z
  .object({
    fileName: z.string().min(1).max(200),
    // base64 of at most 8 MiB, plus padding.
    contentBase64: z
      .string()
      .min(1)
      .max(Math.ceil((UPLOAD_MAX_BYTES * 4) / 3) + 8),
    // PREPARE: an original for the full Studio. QUIZ: Simple mode (§12), a
    // document to generate from directly, in the Quick quiz uploads source.
    destination: z.enum(['PREPARE', 'QUIZ']).default('PREPARE'),
  })
  .strict();

const decodeBase64 = (value: string): Uint8Array | null => {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value)) return null;
  return new Uint8Array(Buffer.from(value, 'base64'));
};

/** RFC 6266: an ASCII fallback and the UTF-8 name. */
const contentDisposition = (fileName: string): string =>
  `attachment; filename="${fileName.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;

export const documentStudioRoutes = [
  defineRoute({
    method: 'GET',
    url: '/api/v1/authoring/document-studio/status',
    policy: 'governance.ai.read',
    portal: 'AUTHORING',
    summary:
      'AI Document Studio readiness for DOCUMENT_RESTRUCTURE per provider, and what can prepare a document now.',
    handler: async (ctx, _request, _reply, deps) => {
      const status = await readDocumentStudioStatus(context(ctx, deps));
      const ready = status.providers.find((row) => row.state === 'READY')?.providerId ?? null;
      return {
        ...status,
        mode: await readStudioMode(deps.prisma),
        // For the SCREEN only: whether to offer the approval controls.
        canManage: ctx.subject.permissions.includes('platform.configure'),
        canPrepare: ctx.subject.permissions.includes('document.prepare'),
        preparation: {
          liveProviderId: ready,
          testPreparationAvailable: deps.documentStudio?.testPreparationEnabled === true,
          storageConfigured: storageRoot(deps) !== null,
        },
      };
    },
  }),

  defineRoute({
    method: 'PUT',
    url: '/api/v1/authoring/document-studio/approvals/:providerId',
    policy: 'governance.ai.manage',
    portal: 'AUTHORING',
    summary:
      'Records, replaces or removes a provider’s DOCUMENT_RESTRUCTURE approval, with its reference.',
    handler: async (ctx, request, reply, deps) => {
      const params = z.object({ providerId: GenerationProviderSchema }).safeParse(request.params);
      const body = z
        .object({ approved: z.boolean(), approvalReference: z.string().max(500).optional() })
        .strict()
        .safeParse(request.body ?? {});
      if (!params.success || !body.success) {
        return refuse(
          reply,
          ctx,
          request.url,
          'A known provider id and an approved flag are required.',
        );
      }
      try {
        return await setPurposeApproval({
          ...context(ctx, deps),
          providerId: params.data.providerId,
          approved: body.data.approved,
          ...(body.data.approvalReference === undefined
            ? {}
            : { approvalReference: body.data.approvalReference }),
        });
      } catch (error) {
        if (error instanceof DocumentStudioError) {
          return refuse(reply, ctx, request.url, error.message);
        }
        throw error;
      }
    },
  }),

  defineRoute({
    method: 'GET',
    url: '/api/v1/authoring/document-studio/mode',
    policy: 'document.browse',
    portal: 'AUTHORING',
    summary:
      'The Document Studio mode alone. Read by the portal layout on every page, so unlike the status read it writes no audit row.',
    handler: async (_ctx, _request, _reply, deps) => ({ mode: await readStudioMode(deps.prisma) }),
  }),

  defineRoute({
    method: 'PUT',
    url: '/api/v1/authoring/document-studio/mode',
    policy: 'governance.ai.manage',
    portal: 'AUTHORING',
    summary:
      'Sets which Document Studio people see: SIMPLE (upload and generate) or FULL. Hides screens only; nothing is removed.',
    handler: async (ctx, request, reply, deps) => {
      const body = z
        .object({ mode: z.enum(STUDIO_MODES) })
        .strict()
        .safeParse(request.body ?? {});
      if (!body.success)
        return refuse(reply, ctx, request.url, 'A mode of SIMPLE or FULL is required.');
      return setStudioMode({ ...context(ctx, deps), mode: body.data.mode });
    },
  }),

  defineRoute({
    method: 'GET',
    url: '/api/v1/authoring/document-studio/documents',
    policy: 'document.browse',
    portal: 'AUTHORING',
    summary: 'My prepared documents: each original, its newest version and whether one is ready.',
    handler: async (ctx, _request, _reply, deps) => {
      await revalidatePreparedVersions({
        prisma: deps.prisma,
        clock: systemClock,
        correlationId: ctx.correlationId,
      });
      return { documents: await listPreparedDocuments(deps.prisma) };
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/api/v1/authoring/document-studio/documents',
    policy: 'document.prepare',
    portal: 'AUTHORING',
    summary:
      'Chooses an existing synchronized document as an original. Never copies or changes it.',
    handler: async (ctx, request, reply, deps) => {
      const body = z
        .object({ documentId: Uuid })
        .strict()
        .safeParse(request.body ?? {});
      if (!body.success) return refuse(reply, ctx, request.url, 'A document id is required.');
      return handle(reply, ctx, request.url, () =>
        startFromDocument(context(ctx, deps), {
          documentId: body.data.documentId,
          storageRoot: storageRoot(deps),
        }),
      );
    },
  }),

  defineRoute({
    method: 'GET',
    url: '/api/v1/authoring/document-studio/documents/:id',
    policy: 'document.browse',
    portal: 'AUTHORING',
    summary:
      'One prepared document: the original, every version, and the version shown with its changes marked.',
    handler: async (ctx, request, reply, deps) => {
      const params = IdParams.safeParse(request.params);
      const query = z.object({ versionId: Uuid.optional() }).safeParse(request.query ?? {});
      if (!params.success || !query.success)
        return refuse(reply, ctx, request.url, 'A prepared document id is required.');
      return handle(reply, ctx, request.url, async () => {
        await revalidatePreparedVersions({
          prisma: deps.prisma,
          clock: systemClock,
          correlationId: ctx.correlationId,
        });
        return preparedDocumentDetail(deps.prisma, {
          preparedDocumentId: params.data.id,
          storageRoot: storageRoot(deps),
          ...(query.data.versionId === undefined ? {} : { versionId: query.data.versionId }),
        });
      });
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/api/v1/authoring/document-studio/documents/:id/preparations',
    policy: 'document.prepare',
    portal: 'AUTHORING',
    summary:
      'Prepare for question generation: a live provider when DOCUMENT_RESTRUCTURE is approved and ready, else the local-only test preparation (not AI), else refused.',
    handler: async (ctx, request, reply, deps) => {
      const params = IdParams.safeParse(request.params);
      if (!params.success)
        return refuse(reply, ctx, request.url, 'A prepared document id is required.');
      return handle(reply, ctx, request.url, async () => {
        const control = await loadControlLayer(deps.prisma);
        return prepareDocument(context(ctx, deps), {
          preparedDocumentId: params.data.id,
          live: await livePreparer(ctx, deps),
          test: testPreparer(deps),
          controls: control.settings,
        });
      });
    },
  }),

  defineRoute({
    method: 'GET',
    url: '/api/v1/authoring/document-studio/history',
    policy: 'document.browse',
    portal: 'AUTHORING',
    summary: 'Preparation attempts and version changes, newest first.',
    handler: async (_ctx, _request, _reply, deps) => ({ events: await studioHistory(deps.prisma) }),
  }),

  defineRoute({
    method: 'GET',
    url: '/api/v1/authoring/document-studio/candidates',
    policy: 'document.browse',
    portal: 'AUTHORING',
    summary: 'Synchronized, extracted documents that may be chosen as an original.',
    handler: async (ctx, request, reply, deps) => {
      const query = z.object({ q: z.string().max(200).optional() }).safeParse(request.query ?? {});
      if (!query.success) return refuse(reply, ctx, request.url, 'The search text is too long.');
      return {
        documents: await preparationCandidates(deps.prisma, {
          storageRoot: storageRoot(deps),
          ...(query.data.q === undefined ? {} : { query: query.data.q }),
        }),
      };
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/api/v1/authoring/document-studio/uploads',
    policy: 'document.prepare',
    portal: 'AUTHORING',
    // 8 MiB as base64, plus the JSON around it.
    bodyLimit: 12 * 1024 * 1024,
    summary:
      'Uploads an original (DOCX, PDF, PPTX, Markdown, text; 8 MiB). Size, type, signature, active content and duplicate are checked before anything is stored; a file the synchronization cannot extract is removed.',
    handler: async (ctx, request, reply, deps) => {
      const body = UploadBody.safeParse(request.body ?? {});
      if (!body.success)
        return refuse(reply, ctx, request.url, 'A file name and the file content are required.');
      const root = storageRoot(deps);
      if (root === null) return refuse(reply, ctx, request.url, NO_STORAGE);
      const studio = context(ctx, deps);
      const bytes = decodeBase64(body.data.contentBase64);
      if (bytes === null)
        return refuse(reply, ctx, request.url, 'The file content is not valid base64.');

      const inspection = inspectUpload({ fileName: body.data.fileName, bytes });
      if (!inspection.ok) {
        await recordUploadRefused(studio, {
          control: inspection.control,
          reason: inspection.reason,
          extension: body.data.fileName.split('.').pop()?.toLowerCase().slice(0, 10) ?? '',
          sizeBytes: bytes.length,
        });
        return problemReply(reply, ctx, request.url, 'UPLOAD_REFUSED', inspection.reason);
      }
      const upload = {
        storage: createStudioStorage(root),
        sync: studioSync(ctx, deps),
        originalFileName: body.data.fileName,
        extension: inspection.extension,
        bytes,
        sha256: inspection.sha256,
      };
      return handle(reply, ctx, request.url, () =>
        body.data.destination === 'QUIZ'
          ? acceptQuizUpload(studio, upload)
          : acceptUpload(studio, upload),
      );
    },
  }),

  defineRoute({
    method: 'PUT',
    url: '/api/v1/authoring/document-studio/versions/:id/content',
    policy: 'document.prepare',
    portal: 'AUTHORING',
    summary: 'Save changes: updates the open draft, or opens a new draft from a ready version.',
    handler: async (ctx, request, reply, deps) => {
      const params = IdParams.safeParse(request.params);
      const body = z
        .object({ content: z.string().max(1_000_000) })
        .strict()
        .safeParse(request.body ?? {});
      if (!params.success || !body.success)
        return refuse(reply, ctx, request.url, 'A version id and the prepared text are required.');
      return handle(reply, ctx, request.url, () =>
        savePreparedContent(context(ctx, deps), {
          versionId: params.data.id,
          content: body.data.content,
        }),
      );
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/api/v1/authoring/document-studio/versions/:id/restore',
    policy: 'document.prepare',
    portal: 'AUTHORING',
    summary: 'Restore AI version: the draft’s text becomes its preparation’s output again.',
    handler: async (ctx, request, reply, deps) => {
      const params = IdParams.safeParse(request.params);
      if (!params.success) return refuse(reply, ctx, request.url, 'A version id is required.');
      return handle(reply, ctx, request.url, () =>
        restoreAiVersion(context(ctx, deps), params.data.id),
      );
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/api/v1/authoring/document-studio/versions/:id/discard',
    policy: 'document.prepare',
    portal: 'AUTHORING',
    summary: 'Discard draft: the draft is kept as REJECTED. Nothing is deleted.',
    handler: async (ctx, request, reply, deps) => {
      const params = IdParams.safeParse(request.params);
      if (!params.success) return refuse(reply, ctx, request.url, 'A version id is required.');
      return handle(reply, ctx, request.url, async () => {
        await rejectDraft(context(ctx, deps), params.data.id);
        return { versionId: params.data.id, state: 'REJECTED' };
      });
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/api/v1/authoring/document-studio/versions/:id/revalidation-draft',
    policy: 'document.prepare',
    portal: 'AUTHORING',
    summary:
      'Review against the updated original: a flagged version’s text as a new draft pinned to the current original.',
    handler: async (ctx, request, reply, deps) => {
      const params = IdParams.safeParse(request.params);
      if (!params.success) return refuse(reply, ctx, request.url, 'A version id is required.');
      return handle(reply, ctx, request.url, () =>
        reviewAgainstUpdatedOriginal(context(ctx, deps), params.data.id),
      );
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/api/v1/authoring/document-studio/versions/:id/repository',
    policy: 'document.prepare',
    portal: 'AUTHORING',
    summary:
      'Add to Question Generation Repository, on explicit confirmation: the exact version becomes a generation source; the previous ready version is superseded.',
    handler: async (ctx, request, reply, deps) => {
      const params = IdParams.safeParse(request.params);
      const body = z
        .object({ confirmed: z.literal(true) })
        .strict()
        .safeParse(request.body ?? {});
      if (!params.success || !body.success) {
        return refuse(
          reply,
          ctx,
          request.url,
          'Adding a prepared document needs your explicit confirmation.',
        );
      }
      const root = storageRoot(deps);
      if (root === null) return refuse(reply, ctx, request.url, NO_STORAGE);
      return handle(reply, ctx, request.url, () =>
        addToRepository(context(ctx, deps), {
          versionId: params.data.id,
          confirmed: body.data.confirmed,
          storage: createStudioStorage(root),
          sync: studioSync(ctx, deps),
        }),
      );
    },
  }),

  defineRoute({
    method: 'GET',
    url: '/api/v1/authoring/document-studio/versions/:id/download',
    policy: 'document.prepare',
    portal: 'AUTHORING',
    summary:
      'Download Word or PDF: the complete prepared content, with the notice and the original reference.',
    handler: async (ctx, request, reply, deps) => {
      const params = IdParams.safeParse(request.params);
      const query = z.object({ format: z.enum(['docx', 'pdf']) }).safeParse(request.query ?? {});
      if (!params.success || !query.success)
        return refuse(
          reply,
          ctx,
          request.url,
          'A version id and a format (docx or pdf) are required.',
        );
      return handle(reply, ctx, request.url, async () => {
        const found = await preparedExportFor(deps.prisma, params.data.id);
        const bytes =
          query.data.format === 'docx'
            ? writePreparedDocx(found.export)
            : writePreparedPdf(found.export);
        await recordDownload(context(ctx, deps), {
          versionId: params.data.id,
          preparedDocumentId: found.preparedDocumentId,
          versionNumber: found.versionNumber,
          format: query.data.format,
        });
        return reply
          .status(200)
          .header(
            'content-type',
            query.data.format === 'docx'
              ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
              : 'application/pdf',
          )
          .header(
            'content-disposition',
            contentDisposition(preparedDownloadName(found.export.originalName, query.data.format)),
          )
          .header('cache-control', 'no-store')
          .send(bytes);
      });
    },
  }),
];
