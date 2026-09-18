// Knowledge source configuration and document selection.
//
// MVP steps 1 and 2: "configure a knowledge source" and "select a document".
//
// Every route here forwards to an MCP tool rather than touching a source
// itself (ADR-003), and every route declares a policy (G1/P1). The policy on
// the route and the permission on the tool are checked independently — the
// route gate is not trusted by the MCP server, which re-resolves the subject
// from the database on every call (T1, E3).

import { z } from 'zod';
import type { ErrorCode } from '@knowzy/shared-types';
import { defineRoute, type RouteContext } from '../http/route.js';
import { McpCallError, type McpClient } from '../mcp/client.js';
import { toProblem } from '../http/problem.js';
import type { FastifyReply } from 'fastify';

/**
 * Maps an MCP failure onto a problem+json response.
 *
 * Without this a tool failure would surface as a 500 with an unhelpful body,
 * and "the source denies access to this document" would look like a bug in
 * Knowzy rather than a correct answer about permissions.
 */
export const replyFromMcpError = (
  error: unknown,
  ctx: RouteContext,
  reply: FastifyReply,
  instance: string,
): FastifyReply => {
  if (!(error instanceof McpCallError)) throw error;

  // Mapped to codes that exist in ERROR_REGISTRY, so the status and the
  // user-facing message come from the one registry (G3) rather than being
  // invented per route.
  const code: ErrorCode =
    error.code === 'SOURCE_NOT_FOUND' || error.code === 'TOOL_NOT_FOUND'
      ? 'NOT_FOUND'
      : error.code === 'FORBIDDEN'
        ? 'FORBIDDEN'
        : error.code === 'VALIDATION_FAILED'
          ? 'VALIDATION_FAILED'
          : error.code === 'ENVELOPE_INVALID'
            ? 'ENVELOPE_INVALID'
            : // A 5xx from the gateway is a platform problem, and MCP_UNAVAILABLE
              // says exactly that: "not a configuration issue". Reporting it as a
              // source error would send an administrator to check their settings.
              error.status >= 500
              ? 'MCP_UNAVAILABLE'
              : 'UPSTREAM_UNEXPECTED';

  const problem = toProblem({
    code,
    correlationId: ctx.correlationId,
    instance,
    detail: error.message,
  });
  return reply.status(problem.status).type('application/problem+json').send(problem);
};

const SourceIdParams = z.object({ sourceId: z.string().uuid() });

const ListItemsQuery = z.object({
  containerId: z.string().min(1),
  folderPath: z.string().optional(),
  recursive: z.coerce.boolean().optional(),
  cursor: z.string().optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
});

const SearchQuery = z.object({
  q: z.string().min(2).max(200),
  containerId: z.string().optional(),
  cursor: z.string().optional(),
});

const DocumentParams = SourceIdParams.extend({ sourceDocumentId: z.string().min(1) });

const SyncBody = z.object({ mode: z.enum(['FULL', 'INCREMENTAL']).default('FULL') });

/** Shared plumbing: every handler calls one tool with the caller's own scope. */
const callTool = async <T>(
  ctx: RouteContext,
  deps: { readonly mcp: McpClient },
  tool: string,
  args: Readonly<Record<string, unknown>>,
): Promise<T> =>
  deps.mcp.call<T>({
    tool,
    subject: ctx.subject,
    scope: ctx.scope,
    portal: ctx.portal,
    correlationId: ctx.correlationId,
    requestId: ctx.requestId,
    arguments: args,
  });

export const sourceRoutes = [
  defineRoute({
    method: 'GET',
    url: '/api/v1/authoring/sources',
    policy: 'source.read',
    portal: 'AUTHORING',
    summary: 'Lists the knowledge sources the caller may see.',
    handler: async (ctx, request, reply, deps) => {
      try {
        return await callTool(ctx, deps, 'list_knowledge_sources', {
          includeInactive: request.query !== null && typeof request.query === 'object' &&
            (request.query as Record<string, unknown>)['includeInactive'] === 'true',
        });
      } catch (error) {
        return replyFromMcpError(error, ctx, reply, request.url);
      }
    },
  }),

  defineRoute({
    method: 'GET',
    url: '/api/v1/authoring/sources/:sourceId',
    policy: 'source.read',
    portal: 'AUTHORING',
    summary: 'Returns one source with its configured paths and declared capabilities.',
    handler: async (ctx, request, reply, deps) => {
      const params = SourceIdParams.safeParse(request.params);
      if (!params.success) return badRequest(ctx, reply, request.url, 'sourceId');
      try {
        return await callTool(ctx, deps, 'get_knowledge_source', {
          sourceId: params.data.sourceId,
        });
      } catch (error) {
        return replyFromMcpError(error, ctx, reply, request.url);
      }
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/api/v1/authoring/sources/:sourceId/test-connection',
    policy: 'source.test',
    portal: 'AUTHORING',
    summary: 'Runs the connection probe and records its result against the source.',
    handler: async (ctx, request, reply, deps) => {
      const params = SourceIdParams.safeParse(request.params);
      if (!params.success) return badRequest(ctx, reply, request.url, 'sourceId');
      try {
        return await callTool(ctx, deps, 'test_knowledge_source', {
          sourceId: params.data.sourceId,
        });
      } catch (error) {
        return replyFromMcpError(error, ctx, reply, request.url);
      }
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/api/v1/authoring/sources/:sourceId/synchronize',
    policy: 'source.sync',
    portal: 'AUTHORING',
    summary: 'Synchronizes the source: discovers, extracts, and sections its documents.',
    handler: async (ctx, request, reply, deps) => {
      const params = SourceIdParams.safeParse(request.params);
      if (!params.success) return badRequest(ctx, reply, request.url, 'sourceId');
      const body = SyncBody.safeParse(request.body ?? {});
      if (!body.success) return badRequest(ctx, reply, request.url, 'mode');
      try {
        return await callTool(ctx, deps, 'synchronize_knowledge_source', {
          sourceId: params.data.sourceId,
          mode: body.data.mode,
        });
      } catch (error) {
        return replyFromMcpError(error, ctx, reply, request.url);
      }
    },
  }),

  defineRoute({
    method: 'GET',
    url: '/api/v1/authoring/sources/:sourceId/synchronizations',
    policy: 'source.read',
    portal: 'AUTHORING',
    summary: 'Returns the recent synchronization runs for a source.',
    handler: async (ctx, request, reply, deps) => {
      const params = SourceIdParams.safeParse(request.params);
      if (!params.success) return badRequest(ctx, reply, request.url, 'sourceId');
      try {
        return await callTool(ctx, deps, 'get_synchronization_history', {
          sourceId: params.data.sourceId,
        });
      } catch (error) {
        return replyFromMcpError(error, ctx, reply, request.url);
      }
    },
  }),

  defineRoute({
    method: 'GET',
    url: '/api/v1/authoring/sources/:sourceId/containers',
    policy: 'document.browse',
    portal: 'AUTHORING',
    summary: 'Lists the browsable containers a source exposes.',
    handler: async (ctx, request, reply, deps) => {
      const params = SourceIdParams.safeParse(request.params);
      if (!params.success) return badRequest(ctx, reply, request.url, 'sourceId');
      try {
        return await callTool(ctx, deps, 'list_source_containers', {
          sourceId: params.data.sourceId,
        });
      } catch (error) {
        return replyFromMcpError(error, ctx, reply, request.url);
      }
    },
  }),

  defineRoute({
    method: 'GET',
    url: '/api/v1/authoring/sources/:sourceId/items',
    policy: 'document.browse',
    portal: 'AUTHORING',
    summary: 'Lists folders and documents under a container path, with selectability.',
    handler: async (ctx, request, reply, deps) => {
      const params = SourceIdParams.safeParse(request.params);
      if (!params.success) return badRequest(ctx, reply, request.url, 'sourceId');
      const query = ListItemsQuery.safeParse(request.query ?? {});
      if (!query.success) {
        return badRequest(ctx, reply, request.url, query.error.issues[0]?.path.join('.') ?? 'query');
      }
      try {
        return await callTool(ctx, deps, 'list_source_items', {
          sourceId: params.data.sourceId,
          containerId: query.data.containerId,
          ...(query.data.folderPath === undefined ? {} : { folderPath: query.data.folderPath }),
          ...(query.data.recursive === undefined ? {} : { recursive: query.data.recursive }),
          ...(query.data.cursor === undefined ? {} : { cursor: query.data.cursor }),
          ...(query.data.pageSize === undefined ? {} : { pageSize: query.data.pageSize }),
        });
      } catch (error) {
        return replyFromMcpError(error, ctx, reply, request.url);
      }
    },
  }),

  defineRoute({
    method: 'GET',
    url: '/api/v1/authoring/sources/:sourceId/search',
    policy: 'document.browse',
    portal: 'AUTHORING',
    summary: 'Searches documents in a source, labelling indexed versus live results.',
    handler: async (ctx, request, reply, deps) => {
      const params = SourceIdParams.safeParse(request.params);
      if (!params.success) return badRequest(ctx, reply, request.url, 'sourceId');
      const query = SearchQuery.safeParse(request.query ?? {});
      if (!query.success) return badRequest(ctx, reply, request.url, 'q');
      try {
        return await callTool(ctx, deps, 'search_source_documents', {
          sourceId: params.data.sourceId,
          text: query.data.q,
          ...(query.data.containerId === undefined ? {} : { containerId: query.data.containerId }),
          ...(query.data.cursor === undefined ? {} : { cursor: query.data.cursor }),
        });
      } catch (error) {
        return replyFromMcpError(error, ctx, reply, request.url);
      }
    },
  }),

  defineRoute({
    method: 'GET',
    url: '/api/v1/authoring/sources/:sourceId/documents/:sourceDocumentId',
    policy: 'document.browse',
    portal: 'AUTHORING',
    summary: 'Returns one document with its metadata, access decision, and sync state.',
    handler: async (ctx, request, reply, deps) => {
      const params = DocumentParams.safeParse(request.params);
      if (!params.success) return badRequest(ctx, reply, request.url, 'sourceDocumentId');
      try {
        return await callTool(ctx, deps, 'get_source_document', {
          sourceId: params.data.sourceId,
          sourceDocumentId: params.data.sourceDocumentId,
        });
      } catch (error) {
        return replyFromMcpError(error, ctx, reply, request.url);
      }
    },
  }),

  defineRoute({
    method: 'GET',
    url: '/api/v1/authoring/sources/:sourceId/documents/:sourceDocumentId/permissions',
    policy: 'document.browse',
    portal: 'AUTHORING',
    summary: 'Returns the effective access decision for a document, and who decided it.',
    handler: async (ctx, request, reply, deps) => {
      const params = DocumentParams.safeParse(request.params);
      if (!params.success) return badRequest(ctx, reply, request.url, 'sourceDocumentId');
      try {
        return await callTool(ctx, deps, 'get_document_permissions', {
          sourceId: params.data.sourceId,
          sourceDocumentId: params.data.sourceDocumentId,
        });
      } catch (error) {
        return replyFromMcpError(error, ctx, reply, request.url);
      }
    },
  }),

  defineRoute({
    method: 'GET',
    url: '/api/v1/authoring/sources/:sourceId/documents/:documentId/sections',
    policy: 'document.browse',
    portal: 'AUTHORING',
    summary: 'Returns the persisted sections of a synchronized document.',
    handler: async (ctx, request, reply, deps) => {
      const params = SourceIdParams.extend({ documentId: z.string().uuid() }).safeParse(
        request.params,
      );
      if (!params.success) return badRequest(ctx, reply, request.url, 'documentId');
      const includeText =
        request.query !== null &&
        typeof request.query === 'object' &&
        (request.query as Record<string, unknown>)['includeText'] === 'true';
      try {
        return await callTool(ctx, deps, 'get_document_sections', {
          sourceId: params.data.sourceId,
          documentId: params.data.documentId,
          includeText,
        });
      } catch (error) {
        return replyFromMcpError(error, ctx, reply, request.url);
      }
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/api/v1/authoring/sources/:sourceId/documents/:sourceDocumentId/extract',
    policy: 'question.generate',
    portal: 'AUTHORING',
    summary: 'Extracts document content as untrusted data, for generation.',
    handler: async (ctx, request, reply, deps) => {
      const params = DocumentParams.safeParse(request.params);
      if (!params.success) return badRequest(ctx, reply, request.url, 'sourceDocumentId');
      try {
        return await callTool(ctx, deps, 'extract_document_content', {
          sourceId: params.data.sourceId,
          sourceDocumentId: params.data.sourceDocumentId,
        });
      } catch (error) {
        return replyFromMcpError(error, ctx, reply, request.url);
      }
    },
  }),
] as const;

const badRequest = (
  ctx: RouteContext,
  reply: FastifyReply,
  instance: string,
  field: string,
): FastifyReply => {
  const problem = toProblem({
    code: 'VALIDATION_FAILED',
    correlationId: ctx.correlationId,
    instance,
    // The field name only. Echoing the value would put caller-controlled text
    // into a response body.
    detail: `The parameter "${field}" is missing or invalid.`,
  });
  return reply.status(problem.status).type('application/problem+json').send(problem);
};
