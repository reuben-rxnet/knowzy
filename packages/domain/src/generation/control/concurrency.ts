// The concurrency cap — architecture.md §9.0 rule 4.
//
// Counted from RUNNING generation jobs rather than from an in-process counter,
// because the API and the job runner are separate processes and an in-memory
// count would cap each of them independently — which is not a cap.
//
// The cap protects three things at once: the provider's rate limit, the
// reviewer (a hundred simultaneous jobs produce a queue nobody reads), and the
// budget, since concurrent jobs can each pass a budget check that their sum
// would fail.

import type { DbClient } from '@knowzy/database';
import type { GenerationProviderId, ProviderLimits } from '@knowzy/shared-types';

export interface ConcurrencySettings {
  readonly concurrency: number;
  readonly providerLimits: Readonly<Partial<Record<GenerationProviderId, ProviderLimits>>>;
}

export const concurrencyLimitFor = (
  settings: ConcurrencySettings,
  providerId: GenerationProviderId,
): number => settings.providerLimits[providerId]?.concurrency ?? settings.concurrency;

export interface ConcurrencyRefusal {
  readonly limitValue: number;
  readonly observedValue: number;
  readonly detail: string;
}

/**
 * Whether another job may start for this provider.
 *
 * `excludeJobId` is required in practice: the caller's own job row is already
 * RUNNING by the time some paths reach here, and counting yourself is how a
 * cap of 1 refuses every job.
 */
export const checkConcurrency = async (
  db: DbClient,
  settings: ConcurrencySettings,
  providerId: GenerationProviderId,
  excludeJobId: string | null = null,
): Promise<ConcurrencyRefusal | null> => {
  const limit = concurrencyLimitFor(settings, providerId);
  const running = await db.generationJob.count({
    where: {
      status: 'RUNNING',
      providerId,
      ...(excludeJobId === null ? {} : { id: { not: excludeJobId } }),
    },
  });
  if (running < limit) return null;
  return {
    limitValue: limit,
    observedValue: running,
    detail: `${running} generation ${running === 1 ? 'job is' : 'jobs are'} already running for this provider and the cap is ${limit}. Try again when one finishes.`,
  };
};
