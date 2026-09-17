// Transactional audit writer — audit-model.md §1 U1.
//
// "The audit write shares the database transaction with the state change it
//  describes. A transition that cannot be audited does not commit."
//
// That guarantee only holds if it is easier to do the right thing than the
// wrong thing, so `transactWithAudit` is the ergonomic entry point: a caller
// gets the transaction and the audit write together, and there is no overload
// that writes state without an accompanying event.
//
// Event construction, taxonomy validation, and redaction live in
// @knowzy/observability; this module performs the insert.

import {
  buildAuditEvent,
  isKnownAuditAction,
  UnknownAuditActionError,
  type AuditEventRow,
  type Clock,
} from '@knowzy/observability';
import type { AuditEventInput } from '@knowzy/shared-types';
import type { DbClient, PrismaClient, TransactionClient } from './client.js';

export interface AuditWriterOptions {
  readonly clock: Clock;
  /** Raw user agent for classification; never stored (§5). */
  readonly userAgent?: string | null;
}

export interface AuditWriter {
  /**
   * Inserts one audit event using the supplied client. Pass the TRANSACTION
   * client, not the pooled one — passing the pooled client would break U1 by
   * letting the event commit independently of the state change.
   */
  write(client: DbClient, input: AuditEventInput): Promise<AuditEventRow>;
  /** Inserts several events in one round trip, for a bulk operation. */
  writeMany(client: DbClient, inputs: readonly AuditEventInput[]): Promise<number>;
}

const toCreateData = (row: AuditEventRow) => ({
  occurredAt: row.occurredAt,
  action: row.action,
  family: row.family,
  category: row.category,
  outcome: row.outcome,
  severity: row.severity,
  actorType: row.actorType,
  actorUserId: row.actorUserId,
  actorDisplayName: row.actorDisplayName,
  actorRoles: row.actorRoles,
  onBehalfOfUserId: row.onBehalfOfUserId,
  entityType: row.entityType,
  entityId: row.entityId,
  entityLabel: row.entityLabel,
  domainId: row.domainId,
  sourceId: row.sourceId,
  previousValue: row.previousValue === null ? undefined : (row.previousValue as object),
  newValue: row.newValue === null ? undefined : (row.newValue as object),
  detail: row.detail as object,
  correlationId: row.correlationId,
  requestId: row.requestId,
  portal: row.portal,
  ipAddress: row.ipAddress,
  userAgentClass: row.userAgentClass,
  policyName: row.policyName,
  denyReason: row.denyReason,
  errorCode: row.errorCode,
  schemaVersion: row.schemaVersion,
});

export const createAuditWriter = (options: AuditWriterOptions): AuditWriter => ({
  async write(client, input) {
    const row = buildAuditEvent(input, {
      clock: options.clock,
      userAgent: options.userAgent ?? null,
    });
    await (client as PrismaClient).auditEvent.create({ data: toCreateData(row) });
    return row;
  },

  async writeMany(client, inputs) {
    const rows = inputs.map((input) =>
      buildAuditEvent(input, { clock: options.clock, userAgent: options.userAgent ?? null }),
    );
    const result = await (client as PrismaClient).auditEvent.createMany({
      data: rows.map(toCreateData),
    });
    return result.count;
  },
});

/**
 * Raised when a caller asks for an audit action the taxonomy does not declare.
 * Thrown BEFORE any work runs, so the caller learns immediately rather than
 * doing the work and then discovering it cannot be attributed.
 */
export const assertAuditable = (action: string): void => {
  if (!isKnownAuditAction(action)) throw new UnknownAuditActionError(action);
};

export interface TransactWithAuditArgs<T> {
  readonly prisma: PrismaClient;
  readonly auditWriter: AuditWriter;
  /** The action is validated before `work` runs. */
  readonly action: string;
  /** The state change. Receives the transaction client. */
  readonly work: (tx: TransactionClient) => Promise<T>;
  /**
   * Builds the audit input from the work result, so the event can reference
   * ids the work created.
   */
  readonly audit: (result: T) => AuditEventInput;
  readonly timeoutMs?: number;
}

/**
 * Runs a state change and its audit event in ONE transaction.
 *
 * If the audit insert fails for any reason — an undeclared action, a constraint
 * violation, a lost connection — the transaction aborts and the state change is
 * not persisted. That is the behaviour U1 requires, and it is verified by
 * test/audit-transaction.test.ts.
 */
export const transactWithAudit = async <T>(args: TransactWithAuditArgs<T>): Promise<T> => {
  assertAuditable(args.action);

  return args.prisma.$transaction(
    async (tx) => {
      const result = await args.work(tx as TransactionClient);
      const input = args.audit(result);

      if (input.action !== args.action) {
        // A mismatch means the pre-validated action is not the one being
        // written, which would defeat the point of validating up front.
        throw new Error(
          `Audit action mismatch: pre-validated "${args.action}" but writing "${input.action}".`,
        );
      }

      await args.auditWriter.write(tx as TransactionClient, input);
      return result;
    },
    args.timeoutMs ? { timeout: args.timeoutMs } : undefined,
  );
};
