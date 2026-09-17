// Audit partition maintenance.
//
// Migration 0001 seeds a rolling window of monthly partitions. This job keeps
// the window ahead of now, and reports anything that landed in the DEFAULT
// partition.
//
// Why the default partition matters: U1 couples the audit insert to the state
// change it describes, so an insert with no matching partition would roll back
// a legitimate transition. The default partition prevents that; a row arriving
// there means the window fell behind, which is a platform finding rather than a
// silent success.
//
// The SQL itself lives in @knowzy/database (auditPartitionRepository) because
// C4 confines raw SQL to the data layer. This module owns the schedule and the
// decision, not the statements.

import type { Clock } from '@knowzy/observability';
import { auditPartitionRepository, findingRepository, type PrismaClient } from '@knowzy/database';

/** Months of partition runway maintained ahead of the current month. */
export const PARTITION_RUNWAY_MONTHS = 12;

export interface PartitionMaintenanceResult {
  readonly ensured: readonly string[];
  readonly defaultPartitionRows: number;
}

export const runAuditPartitionMaintenance = async (
  prisma: PrismaClient,
  clock: Clock,
): Promise<PartitionMaintenanceResult> => {
  const partitions = auditPartitionRepository(prisma);
  const findings = findingRepository(prisma);

  const now = clock.now();
  const ensured: string[] = [];

  for (let offset = 0; offset <= PARTITION_RUNWAY_MONTHS; offset += 1) {
    const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
    const name = await partitions.ensurePartition(month.toISOString().slice(0, 10));
    if (name) ensured.push(name);
  }

  const defaultPartitionRows = await partitions.countDefaultPartitionRows();

  if (defaultPartitionRows > 0) {
    // Reported, never silently corrected (M4). Moving the rows is an operator
    // decision: the correct partition may not exist yet, and an automatic move
    // during a window gap could relocate rows twice.
    await findings.raise({
      checkKey: 'audit.defaultPartitionOccupied',
      entityType: 'AuditEvent',
      actual: { rows: defaultPartitionRows },
      note:
        'Audit rows landed in the default partition, so the monthly window fell behind. ' +
        'The rows are intact; move them once the correct partition exists.',
    });
  }

  return { ensured, defaultPartitionRows };
};
