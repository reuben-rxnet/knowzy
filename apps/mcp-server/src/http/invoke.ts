// The tool invocation surface.
//
// The gate order below is the contract, not an implementation detail:
//
//   1. envelope structure and expiry      (E1 partially, see envelope.ts)
//   2. portal partition                   (E5 — the tool DOES NOT EXIST)
//   3. fresh re-resolution of roles/scope (E3 — intersection, never union)
//   4. declared permission                (E7 — BEFORE argument validation)
//   5. argument validation                (T4)
//   6. handler, under the declared timeout budget (G2)
//
// E7 is the reason 4 precedes 5: if arguments were validated first, an
// unauthorized caller could read schema details out of the validation error and
// probe the tool surface.

import type { FastifyInstance } from 'fastify';
import { createAuditWriter, subjectLookupRepository, type DbClient } from '@knowzy/database';
import type { Clock, Logger } from '@knowzy/observability';
import {
  EnvelopeInvalidError,
  verifyEnvelope,
  type AuthorizationEnvelope,
} from '../tools/envelope.js';
import { resolveTool, toolsForPortal, type ToolPortal } from '../tools/registry.js';
import type { ToolDeps } from '../tools/deps.js';

export interface InvokeOptions {
  readonly deps: ToolDeps;
  readonly logger: Logger;
  readonly clock: Clock;
}

interface ToolProblem {
  readonly status: number;
  readonly code: string;
  readonly message: string;
}

const problem = (status: number, code: string, message: string): ToolProblem => ({
  status,
  code,
  message,
});

/**
 * Re-resolves the subject from the database and intersects with the envelope.
 *
 * E3: a stale envelope can never grant more than current state allows. The
 * intersection direction matters — a permission revoked a second ago is gone
 * even though the envelope still lists it.
 */
const intersectWithCurrentState = async (
  prisma: DbClient,
  envelope: AuthorizationEnvelope,
): Promise<{ permissions: Set<string>; roles: readonly string[] } | null> => {
  const subject = await subjectLookupRepository(prisma).byIdentifier(
    envelope.subject.entraObjectId,
  );
  if (!subject) return null;

  const fresh = new Set<string>(subject.permissions);
  return {
    permissions: new Set(envelope.permissions.filter((permission) => fresh.has(permission))),
    roles: subject.roles.filter((role) => envelope.effectiveRoles.includes(role)),
  };
};

export const registerToolRoutes = (app: FastifyInstance, options: InvokeOptions): void => {
  const { deps, logger, clock } = options;
  const auditWriter = createAuditWriter({ clock });

  /** Lists the tools a portal can reach. Not a catalogue of all tools (E5). */
  app.get<{ Params: { portal: string } }>('/internal/tools/:portal', async (request, reply) => {
    const portal = request.params.portal.toUpperCase();
    if (portal !== 'AUTHORING' && portal !== 'LIVE' && portal !== 'SYSTEM') {
      return reply.code(404).send({ code: 'NOT_FOUND', message: 'Unknown portal.' });
    }
    return reply.send({
      portal,
      tools: toolsForPortal(portal as ToolPortal).map((tool) => ({
        name: tool.name,
        family: tool.family,
        permission: tool.permission,
        writes: tool.writes,
        timeoutMs: tool.timeoutMs,
        auditAction: tool.auditAction,
        description: tool.description,
      })),
    });
  });

  app.post<{ Params: { toolName: string }; Body: unknown }>(
    '/internal/tools/:toolName/invoke',
    async (request, reply) => {
      const body = (request.body ?? {}) as { envelope?: unknown; arguments?: unknown };

      // ---- 1. envelope
      let envelope: AuthorizationEnvelope;
      try {
        envelope = verifyEnvelope(body.envelope, { clock }).envelope;
      } catch (error) {
        const detail =
          error instanceof EnvelopeInvalidError ? error.message : 'Malformed envelope.';
        // An envelope rejection IS audited: audit-model.md exempts reads, not
        // security events, and PLATFORM.SECURITY.ENVELOPE_VERIFICATION_FAILED
        // exists for exactly this.
        await auditWriter
          .write(deps.prisma, {
            action: 'PLATFORM.SECURITY.ENVELOPE_VERIFICATION_FAILED',
            outcome: 'DENIED',
            actorType: 'SYSTEM',
            entityType: 'McpTool',
            entityId: request.params.toolName,
            entityLabel: request.params.toolName,
            detail: { reason: detail },
            correlationId: request.headers['x-correlation-id']?.toString() ?? 'unknown',
          })
          .catch(() => undefined);
        const p = problem(401, 'ENVELOPE_INVALID', detail);
        return reply.code(p.status).send(p);
      }

      // ---- 2. portal partition
      const tool = resolveTool(envelope.portal, request.params.toolName);
      if (!tool) {
        // 404, not 403: for this portal the tool does not exist, so the reply
        // must not confirm that it exists for another one (E5).
        const p = problem(404, 'TOOL_NOT_FOUND', `No such tool for the ${envelope.portal} portal.`);
        return reply.code(p.status).send(p);
      }

      // ---- 3. fresh re-resolution
      const current = await intersectWithCurrentState(deps.prisma, envelope);
      if (!current) {
        const p = problem(403, 'FORBIDDEN', 'The subject in the envelope no longer resolves.');
        return reply.code(p.status).send(p);
      }

      // ---- 4. declared permission, before argument validation
      if (!current.permissions.has(tool.permission)) {
        await auditWriter
          .write(deps.prisma, {
            action: 'PLATFORM.SECURITY.AUTHORIZATION_DENIED',
            outcome: 'DENIED',
            actorType: 'USER',
            actorUserId: envelope.subject.userId,
            actorDisplayName: envelope.subject.displayName,
            actorRoles: [...current.roles],
            entityType: 'McpTool',
            entityId: tool.name,
            entityLabel: tool.name,
            policyName: tool.permission,
            denyReason: 'The subject lacks the permission this tool declares.',
            detail: { portal: envelope.portal },
            correlationId: envelope.correlationId,
            requestId: envelope.requestId,
            portal: envelope.portal,
          })
          .catch(() => undefined);
        const p = problem(403, 'FORBIDDEN', `This tool requires "${tool.permission}".`);
        return reply.code(p.status).send(p);
      }

      // ---- 5. argument validation
      const parsed = tool.input.safeParse(body.arguments ?? {});
      if (!parsed.success) {
        const field = parsed.error.issues[0]?.path.join('.') ?? 'arguments';
        const p = problem(
          400,
          'VALIDATION_FAILED',
          `The argument "${field}" is missing or invalid.`,
        );
        return reply.code(p.status).send(p);
      }

      // ---- 6. handler, under the declared timeout budget
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), tool.timeoutMs);
      const startedAt = clock.now().getTime();

      try {
        const result = await tool.handler({
          envelope,
          input: parsed.data as never,
          deps,
          signal: controller.signal,
        });
        logger.info('tool invoked', {
          tool: tool.name,
          portal: envelope.portal,
          durationMs: clock.now().getTime() - startedAt,
          correlationId: envelope.correlationId,
        });
        return reply.send({ tool: tool.name, result });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'The tool failed.';
        const code = readErrorCode(error);
        logger.warn('tool failed', {
          tool: tool.name,
          code,
          correlationId: envelope.correlationId,
        });
        // T8: a typed error, never a partial success that looks whole.
        const status = code === 'SOURCE_NOT_FOUND' ? 404 : code === 'FORBIDDEN' ? 403 : 500;
        return reply.code(status).send({ code, message });
      } finally {
        clearTimeout(timer);
      }
    },
  );
};

const readErrorCode = (error: unknown): string => {
  if (error !== null && typeof error === 'object' && 'code' in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return 'INTERNAL_ERROR';
};

// Re-exported so the API's client and the contract test share one spelling of
// the route rather than two string literals that can drift.
export const TOOL_INVOKE_PATH = (toolName: string): string => `/internal/tools/${toolName}/invoke`;
