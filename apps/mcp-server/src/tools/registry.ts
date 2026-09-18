// The MCP tool registry — mcp-tools.md §2 and repository-structure.md §5.3 G2.
//
// G2: every MCP tool has a declared policy, portal partition, timeout budget,
// and audit action. The registry is the single place those four facts live, and
// the contract test asserts that the HTTP surface exposes exactly the tools
// declared here — so a tool cannot be added by writing a handler.
//
// E5 is why the lookup is partitioned by portal rather than checked after the
// fact: for a LIVE envelope an authoring tool DOES NOT EXIST, which is a
// stronger statement than "is refused".

import type { z } from 'zod';
import type { AuditAction, PermissionKey } from '@knowzy/shared-types';
import type { AuthorizationEnvelope } from './envelope.js';
import type { ToolDeps } from './deps.js';

export type ToolPortal = 'AUTHORING' | 'LIVE' | 'SYSTEM';

/** What a tool may write. Only the bank family may ever be EXTERNAL. */
export type ToolWriteScope = 'NONE' | 'LOCAL' | 'EXTERNAL';

export interface ToolInvocation<TInput> {
  readonly envelope: AuthorizationEnvelope;
  readonly input: TInput;
  readonly deps: ToolDeps;
  readonly signal: AbortSignal;
}

export interface McpToolDefinition<TInput = unknown, TOutput = unknown> {
  readonly name: string;
  readonly family: string;
  /** G2: the declared policy. Checked BEFORE argument validation (E7). */
  readonly permission: PermissionKey;
  /** G2: the portal partition. A portal absent here cannot reach the tool. */
  readonly portals: readonly ToolPortal[];
  /**
   * G2: the audit action written for this invocation (T7).
   *
   * `null` where audit-model.md §8 deliberately excludes the call. The two
   * documents disagree — mcp-tools.md T7 says "every invocation writes an audit
   * event", audit-model.md §8 lists "individual read requests (page loads, list
   * queries)" as deliberately not audited — and the audit model wins, because
   * it is the document that owns what the store contains and it gives the
   * reason: volume would dwarf the meaningful signal.
   *
   * The field is still REQUIRED, so G2 holds: a tool declares an action or
   * declares and justifies its absence. It cannot stay silent.
   */
  readonly auditAction: AuditAction | null;
  /** Required when auditAction is null. Cites the rule that exempts the call. */
  readonly auditExemptionReason?: string;
  /** G2: the timeout budget, passed to the adapter as an AbortSignal. */
  readonly timeoutMs: number;
  readonly writes: ToolWriteScope;
  readonly description: string;
  /**
   * The argument schema (T4).
   *
   * `unknown` on the Input side is load-bearing: it forces TInput to be
   * inferred from the schema's OUTPUT, so a field declared with `.default()`
   * arrives at the handler as a value rather than as possibly-undefined.
   */
  readonly input: z.ZodType<TInput, z.ZodTypeDef, unknown>;
  handler(invocation: ToolInvocation<TInput>): Promise<TOutput>;
}

/** Erased element type, so tools with different input types share one map. */
export type AnyMcpTool = McpToolDefinition<never, unknown>;

const toolMap = new Map<string, AnyMcpTool>();

/**
 * Registers a tool.
 *
 * Duplicate registration throws rather than overwriting: two definitions of one
 * name would mean the effective policy depends on module load order.
 */
export const registerTool = <TInput, TOutput>(
  definition: McpToolDefinition<TInput, TOutput>,
): McpToolDefinition<TInput, TOutput> => {
  if (toolMap.has(definition.name)) {
    throw new Error(`MCP tool "${definition.name}" is already registered.`);
  }
  if (definition.portals.length === 0) {
    throw new Error(`MCP tool "${definition.name}" declares no portal, so nothing could call it.`);
  }
  if (definition.auditAction === null && !definition.auditExemptionReason) {
    throw new Error(
      `MCP tool "${definition.name}" declares no audit action and no exemption reason. ` +
        'A call is audited or its exemption is stated; silence is not an option (G2).',
    );
  }
  if (definition.auditAction !== null && definition.auditExemptionReason) {
    throw new Error(
      `MCP tool "${definition.name}" declares both an audit action and an exemption reason.`,
    );
  }
  if (definition.writes !== 'NONE' && definition.auditAction === null) {
    // A write is never exempt: §8 exempts reads, and only reads.
    throw new Error(`MCP tool "${definition.name}" writes, so it cannot be exempt from audit.`);
  }
  if (definition.writes === 'EXTERNAL' && definition.family !== 'question-bank') {
    // Only the Question Bank port writes outside Knowzy (§2). A tool in another
    // family claiming EXTERNAL is a design error, not a configuration choice.
    throw new Error(
      `MCP tool "${definition.name}" is not in the question-bank family and cannot write externally.`,
    );
  }
  toolMap.set(definition.name, definition as unknown as AnyMcpTool);
  return definition;
};

export const allTools = (): readonly AnyMcpTool[] =>
  [...toolMap.values()].sort((a, b) => a.name.localeCompare(b.name));

export const toolNames = (): readonly string[] => allTools().map((tool) => tool.name);

/**
 * Resolves a tool for a portal.
 *
 * Returns undefined when the portal is not in the tool's partition, so the
 * caller answers 404 rather than 403 (E5).
 */
export const resolveTool = (portal: ToolPortal, name: string): AnyMcpTool | undefined => {
  const tool = toolMap.get(name);
  if (!tool) return undefined;
  return tool.portals.includes(portal) ? tool : undefined;
};

export const toolsForPortal = (portal: ToolPortal): readonly AnyMcpTool[] =>
  allTools().filter((tool) => tool.portals.includes(portal));

/** Test-only: the registry is module state, and a suite may need it empty. */
export const resetToolRegistry = (): void => {
  toolMap.clear();
};
