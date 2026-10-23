// AI Document Studio -- Simple or Full (docs/competencies/AI_DOCUMENT_STUDIO_ARCHITECTURE.md §12).
//
// One platform setting, `documentStudio.mode`, decides which Studio people
// see. SIMPLE is upload -> quiz settings -> generate; FULL is the M3 Studio.
// It is a DISPLAY decision: no route is disabled by it, no row is touched by
// switching it, and the full Studio's pages answer at their addresses in
// either mode. A malformed stored value reads as the code default.
//
// The write is the platform's configuration write shape: application_
// configuration + configuration_change + an audited previous/new value, in
// one transaction.

import { createAuditWriter, type PrismaClient, type TransactionClient } from '@knowzy/database';
import type { Clock } from '@knowzy/observability';
import type { AdminActor } from '../generation/control/provider-administration.js';

export const STUDIO_MODE_KEY = 'documentStudio.mode';
export const STUDIO_MODES = ['SIMPLE', 'FULL'] as const;
export type StudioMode = (typeof STUDIO_MODES)[number];
/** The code default. Matches the declaration in @knowzy/configuration keys.ts. */
export const DEFAULT_STUDIO_MODE: StudioMode = 'SIMPLE';

const parseMode = (value: unknown): StudioMode =>
  value === 'SIMPLE' || value === 'FULL' ? value : DEFAULT_STUDIO_MODE;

export const readStudioMode = async (prisma: PrismaClient): Promise<StudioMode> => {
  const row = await prisma.applicationConfiguration.findFirst({
    where: { key: STUDIO_MODE_KEY, scope: 'PLATFORM', scopeId: null },
    select: { value: true },
  });
  return parseMode(row?.value);
};

export const setStudioMode = async (args: {
  readonly prisma: PrismaClient;
  readonly clock: Clock;
  readonly actor: AdminActor;
  readonly correlationId: string;
  readonly requestId: string;
  readonly mode: StudioMode;
}): Promise<{ readonly mode: StudioMode; readonly changed: boolean }> => {
  const auditWriter = createAuditWriter({ clock: args.clock });
  return args.prisma.$transaction(async (tx: TransactionClient) => {
    const existing = await tx.applicationConfiguration.findFirst({
      where: { key: STUDIO_MODE_KEY, scope: 'PLATFORM', scopeId: null },
      select: { id: true, value: true },
    });
    const previous = parseMode(existing?.value);
    if (existing !== null && previous === args.mode) return { mode: args.mode, changed: false };

    if (existing) {
      await tx.applicationConfiguration.update({
        where: { id: existing.id },
        data: {
          value: args.mode,
          updatedByUserId: args.actor.userId,
          version: { increment: 1 },
        },
      });
    } else {
      await tx.applicationConfiguration.create({
        data: {
          key: STUDIO_MODE_KEY,
          scope: 'PLATFORM',
          scopeId: null,
          value: args.mode,
          valueType: 'string',
          updatedByUserId: args.actor.userId,
        },
      });
    }
    await tx.configurationChange.create({
      data: {
        key: STUDIO_MODE_KEY,
        scope: 'PLATFORM',
        scopeId: null,
        ...(existing ? { previousValue: previous } : {}),
        newValue: args.mode,
        changedByUserId: args.actor.userId,
        correlationId: args.correlationId,
      },
    });
    await auditWriter.write(tx, {
      action: 'ADMIN.CONFIGURATION.UPDATED',
      outcome: 'SUCCESS',
      actorType: 'USER',
      actorUserId: args.actor.userId,
      actorDisplayName: args.actor.displayName,
      actorRoles: [...args.actor.roles],
      entityType: 'ApplicationConfiguration',
      entityId: STUDIO_MODE_KEY,
      entityLabel: STUDIO_MODE_KEY,
      correlationId: args.correlationId,
      requestId: args.requestId,
      portal: 'AUTHORING',
      previousValue: { mode: previous },
      newValue: { mode: args.mode },
      detail: {
        key: STUDIO_MODE_KEY,
        scope: 'PLATFORM',
        valueType: 'string',
        changedFields: ['mode'],
      },
    });
    return { mode: args.mode, changed: true };
  });
};
