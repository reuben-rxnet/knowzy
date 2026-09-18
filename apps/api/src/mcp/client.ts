// The MCP client.
//
// ADR-003: MCP is the SOLE gateway to a knowledge source. Boundary rule B2
// keeps apps/api from importing the adapter package at all, so this HTTP client
// is the only way the API reaches a source — the constraint is structural, not
// a convention a handler could forget.
//
// The envelope is constructed HERE, from the subject the route gate resolved.
// mcp-tools.md §3: "constructed by the API from the validated Entra token,
// never from request body fields." A handler passes arguments; it cannot
// influence who the call is made as.

import type { DataScope, PortalContext, Subject } from '@knowzy/shared-types';

export interface McpClientOptions {
  /** e.g. http://mcp:8081 — resolvable only inside the container network. */
  readonly baseUrl: string;
  /** Envelope lifetime. §3: short-lived; default 120 s. */
  readonly envelopeTtlMs?: number;
  readonly now?: () => Date;
  readonly fetchImpl?: typeof fetch;
}

export interface McpCallArgs {
  readonly tool: string;
  readonly subject: Subject;
  readonly scope: DataScope;
  readonly portal: PortalContext;
  readonly correlationId: string;
  readonly requestId: string;
  readonly arguments: Readonly<Record<string, unknown>>;
}

export class McpCallError extends Error {
  constructor(
    readonly tool: string,
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'McpCallError';
  }
}

const DEFAULT_TTL_MS = 120_000;

export interface McpClient {
  call<T>(args: McpCallArgs): Promise<T>;
  listTools(portal: PortalContext): Promise<readonly { name: string; permission: string }[]>;
}

export const createMcpClient = (options: McpClientOptions): McpClient => {
  const now = options.now ?? (() => new Date());
  const doFetch = options.fetchImpl ?? fetch;
  const ttl = options.envelopeTtlMs ?? DEFAULT_TTL_MS;
  const base = options.baseUrl.replace(/\/+$/, '');

  const buildEnvelope = (args: McpCallArgs): Record<string, unknown> => {
    const issuedAt = now();
    return {
      subject: {
        userId: args.subject.userId,
        entraObjectId: args.subject.entraObjectId,
        displayName: args.subject.displayName,
      },
      portal: args.portal,
      // From the database, never from token group claims (E2).
      effectiveRoles: [...args.subject.roles],
      permissions: [...args.subject.permissions],
      dataScope: {
        domainIds: [...args.scope.domainIds],
        teamIds: [...args.scope.teamIds],
        sourceIds: [...args.scope.sourceIds],
        denySourceIds: [...args.scope.denySourceIds],
      },
      // DELEGATED_OBO arrives with the SharePoint adapter; until a broker
      // exists, claiming delegation would be claiming a capability we lack.
      delegation: { mode: 'NONE' },
      correlationId: args.correlationId,
      requestId: args.requestId,
      issuedAt: issuedAt.toISOString(),
      expiresAt: new Date(issuedAt.getTime() + ttl).toISOString(),
    };
  };

  return {
    async call<T>(args: McpCallArgs): Promise<T> {
      const response = await doFetch(`${base}/internal/tools/${args.tool}/invoke`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-correlation-id': args.correlationId,
        },
        body: JSON.stringify({
          envelope: buildEnvelope(args),
          arguments: args.arguments,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        result?: unknown;
        code?: string;
        message?: string;
      };

      if (!response.ok) {
        throw new McpCallError(
          args.tool,
          response.status,
          payload.code ?? 'UPSTREAM_ERROR',
          // The MCP server has already sanitized this; the API does not add
          // detail of its own, so an error cannot grow as it propagates.
          payload.message ?? `The tool ${args.tool} failed.`,
        );
      }

      return payload.result as T;
    },

    async listTools(portal) {
      const response = await doFetch(`${base}/internal/tools/${portal}`);
      if (!response.ok) {
        throw new McpCallError(
          'list',
          response.status,
          'UPSTREAM_ERROR',
          'The MCP tool catalogue could not be read.',
        );
      }
      const payload = (await response.json()) as {
        tools: { name: string; permission: string }[];
      };
      return payload.tools;
    },
  };
};
