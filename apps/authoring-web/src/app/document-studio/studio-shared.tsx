// AI Document Studio M3 -- pieces both Studio pages show: the progress
// sequence, the availability banner, and the shapes the API returns.

import { WorkflowRibbon } from '@knowzy/shared-ui';
import { Info } from 'lucide-react';
import { t } from '../../copy';

export type VersionState =
  'DRAFT' | 'READY_FOR_QUESTION_GENERATION' | 'SUPERSEDED' | 'REVALIDATION_REQUIRED' | 'REJECTED';

export interface StudioStatus {
  readonly state: 'BLOCKED_BY_APPROVAL' | 'NOT_BUILT' | 'READY';
  readonly stateReason: string;
  readonly evaluatedAt: string;
  readonly canManage: boolean;
  readonly canPrepare: boolean;
  /** documentStudio.mode (§12): which Studio this address shows. */
  readonly mode: 'SIMPLE' | 'FULL';
  readonly preparation: {
    readonly liveProviderId: string | null;
    readonly testPreparationAvailable: boolean;
    readonly storageConfigured: boolean;
  };
  readonly providers: readonly {
    readonly providerId: string;
    readonly capable: boolean;
    readonly capabilityReason: string;
    readonly approval: {
      readonly reference: string;
      readonly approvedByDisplayName: string;
      readonly approvedAt: string;
    } | null;
    readonly clientImplemented: boolean;
    readonly configured: boolean;
    readonly state: 'BLOCKED_BY_APPROVAL' | 'NOT_BUILT' | 'READY' | null;
    readonly reason: string;
  }[];
}

export const when = (iso: string | null): string =>
  iso === null ? '—' : `${iso.slice(0, 16).replace('T', ' ')} UTC`;

/** Mark a stage complete only when completion is known (WorkflowRibbon rule). */
export const StudioProgress = ({
  active,
  added,
  prepared,
  ready,
}: {
  readonly active: string;
  readonly added: boolean;
  readonly prepared: boolean;
  readonly ready: boolean;
}) => (
  <WorkflowRibbon
    ariaLabel={t('ds.progressLabel')}
    activeLabel={active}
    stages={[
      { label: t('ds.progressAdd'), ...(added ? { complete: true } : {}) },
      { label: t('ds.progressPrepare'), ...(prepared ? { complete: true } : {}) },
      { label: t('ds.progressReview'), ...(ready ? { complete: true } : {}) },
      { label: t('ds.progressAddRepo'), ...(ready ? { complete: true } : {}) },
      { label: t('ds.progressGenerate') },
    ]}
  />
);

/**
 * What can prepare a document here, in business words. The CP-5 sentence is
 * shown whenever no LIVE provider is ready -- even where the test preparation
 * can run -- because the test preparation is not AI.
 */
export const AvailabilityBanner = ({ status }: { readonly status: StudioStatus }) => (
  <div
    role="status"
    data-preparation={
      status.preparation.liveProviderId !== null
        ? 'LIVE'
        : status.preparation.testPreparationAvailable
          ? 'TEST_ONLY'
          : 'NOT_ENABLED'
    }
    className="flex items-start gap-3 rounded-lg border border-line bg-info-soft px-4 py-3"
  >
    <Info aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-info" />
    <div className="flex flex-col gap-1">
      <span className="font-semibold text-ink">
        {status.preparation.liveProviderId !== null
          ? t('ds.liveAvailable', { provider: status.preparation.liveProviderId })
          : t('ds.notEnabled')}
      </span>
      {status.preparation.liveProviderId === null && status.preparation.testPreparationAvailable ? (
        <span className="max-w-prose text-sm text-ink-muted">{t('ds.testAvailable')}</span>
      ) : null}
    </div>
  </div>
);

export const VERSION_TONE: Readonly<
  Record<VersionState, 'warning' | 'neutral' | 'success' | 'info'>
> = {
  DRAFT: 'info',
  READY_FOR_QUESTION_GENERATION: 'success',
  SUPERSEDED: 'neutral',
  REVALIDATION_REQUIRED: 'warning',
  REJECTED: 'neutral',
};
