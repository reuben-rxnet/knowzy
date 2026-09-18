// What a tool handler is given.
//
// The MCP server is the component that holds source credentials and talks to
// external systems, so it is also the only place an adapter is constructed.
// Handlers receive a resolver rather than a concrete adapter, because which
// adapter serves a source is a property of the source row.

import type { DbClient } from '@knowzy/database';
import type { Clock, Logger } from '@knowzy/observability';
import type { KnowledgeSourceAdapter } from '@knowzy/knowledge-source-adapters';
import type { KnowzyEnv } from '@knowzy/shared-types';

export interface SourceRow {
  readonly id: string;
  readonly name: string;
  readonly sourceType: string;
  readonly connection: unknown;
  readonly permissionMode: string;
  readonly usableForGeneration: boolean;
  readonly isActive: boolean;
}

export interface ToolDeps {
  readonly prisma: DbClient;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly environment: KnowzyEnv;
  /** Resolves the adapter that serves a source, or throws if none is registered. */
  readonly adapterFor: (source: SourceRow) => KnowledgeSourceAdapter;
  readonly limits: {
    readonly maxBytes: number;
    readonly maxCharsPerDocument: number;
    readonly pageSize: number;
  };
}
