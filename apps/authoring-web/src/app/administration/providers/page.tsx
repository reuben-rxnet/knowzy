// Administration -> AI Providers.
//
// One table of every DECLARED provider, and four controls per row. The screen's
// job is to make one question answerable at a glance -- "can this provider run
// a job, and if not, what is the next thing to do" -- and then to let an
// administrator do that thing without a deployment.
//
// THREE THINGS IT REFUSES TO DO:
//
//   1. It does not hide the providers that cannot be used. OPENAI, ANTHROPIC,
//      MICROSOFT_COPILOT, AZURE_OPENAI and GEMINI are declared and unavailable,
//      and a table listing only the deterministic generator would suggest the
//      others do not exist rather than that they are not built yet. Each row
//      carries the registry's own reason.
//   2. It does not show a credential. The box for one is write-only and the
//      row says CONFIGURED or NOT CONFIGURED -- the reference names a secret,
//      and no read model returns it.
//   3. It does not claim a connection. "Validate" records what the
//      configuration chain establishes and marks the live call NOT ATTEMPTED,
//      because no client for any external provider exists in this build. A
//      green "Model reachable" here would be the one lie that gets quoted back
//      during an incident.
//
// The state column is the registry's, in its own order of permanence:
// capability, approval, implementation, credential. The reason beneath it is
// what tells somebody whether they need Legal, a release, or a vault entry.

import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  DataTable,
  KpiCard,
  PageHero,
  StatusBadge,
  TBody,
  THead,
  TabNav,
  Td,
  Th,
  Tr,
} from '@knowzy/shared-ui';
import { Cpu, KeyRound, ShieldCheck, Sparkles } from 'lucide-react';
import { t } from '../../../copy';
import { api } from '../../../lib/api';
import { Problem } from '../../../components/Problem';
import {
  ActivateProviderButton,
  ProviderApprovalButton,
  ProviderSettingsButton,
  ValidateProviderButton,
  type ProviderFormValues,
} from '../../../components/ProviderAdminForms';
import { ProviderLimitButton } from '../../../components/ProviderLimitForm';
import { currentSubject } from '../../../lib/identity';
import { ADMINISTRATION_TABS } from '../tabs';

interface ValidationStep {
  readonly check: string;
  readonly result: string;
  readonly detail: string;
}

interface ProviderRow {
  readonly providerId: string;
  readonly displayName: string;
  readonly state: string;
  readonly stateReason: string;
  readonly enabled: boolean;
  readonly registered: boolean;
  readonly approved: boolean;
  readonly groundingSafe: boolean;
  readonly supportedExecutionModes: readonly string[];
  readonly providerVersion: string | null;
  readonly credentialConfigured: boolean;
  readonly settingsUpdatedAt: string | null;
  readonly baseUrl: string | null;
  readonly modelId: string | null;
  readonly temperature: number | null;
  readonly maxOutputTokens: number | null;
  readonly limits: {
    readonly perJobTokenBudget?: number;
    readonly dailyTokenBudget?: number;
    readonly concurrency?: number;
    readonly maxAttempts?: number;
  };
  readonly health: string;
  readonly healthReason: string;
  readonly lastValidation: {
    readonly outcome: string;
    readonly state: string;
    readonly steps: readonly ValidationStep[];
    readonly validatedAt: string;
    readonly validatedByDisplayName: string | null;
  } | null;
}

interface Administration {
  readonly asOf: string;
  readonly activeProvider: string;
  readonly providers: readonly ProviderRow[];
  readonly defaults: {
    readonly perJobTokenBudget: number;
    readonly dailyTokenBudget: number;
    readonly concurrency: number;
    readonly maxAttempts: number;
  };
  readonly canManage: boolean;
}

/** The registry's six states, mapped to the four tones the design system has. */
const STATE_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  AVAILABLE: 'success',
  OVER_BUDGET: 'warning',
  BLOCKED_BY_CONFIGURATION: 'warning',
  BLOCKED_BY_APPROVAL: 'warning',
  BLOCKED_BY_CAPABILITY: 'danger',
  UNAVAILABLE: 'neutral',
};

const HEALTH_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  HEALTHY: 'success',
  DEGRADED: 'warning',
  FAILING: 'danger',
  UNKNOWN: 'neutral',
};

const RESULT_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  PASSED: 'success',
  FAILED: 'danger',
  NOT_ATTEMPTED: 'neutral',
};

const DASH = '—';

const when = (iso: string | null): string =>
  iso === null ? DASH : new Date(iso).toISOString().replace('T', ' ').slice(0, 16);

export const dynamic = 'force-dynamic';

export default async function AiProvidersPage() {
  const [result, subject] = await Promise.all([
    api<Administration>('/api/v1/authoring/administration/providers'),
    currentSubject(),
  ]);

  const tabs = (
    <TabNav
      items={ADMINISTRATION_TABS.map((tab) => ({ href: tab.href, label: t(tab.labelKey) }))}
      activeHref="/administration/providers"
      ariaLabel={t('prov.tabsLabel')}
    />
  );

  if (!result.ok) {
    return (
      <div className="flex flex-col gap-6">
        <PageHero title={t('prov.heading')} purpose={t('prov.intro')} />
        {tabs}
        <Problem problem={result.problem} actingAs={subject.label} />
      </div>
    );
  }

  const data = result.data;
  const available = data.providers.filter((row) => row.state === 'AVAILABLE');
  const values = (row: ProviderRow): ProviderFormValues => ({
    providerId: row.providerId,
    displayName: row.displayName,
    enabled: row.enabled,
    baseUrl: row.baseUrl,
    modelId: row.modelId,
    temperature: row.temperature,
    maxOutputTokens: row.maxOutputTokens,
    credentialConfigured: row.credentialConfigured,
    approved: row.approved,
    state: row.state,
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHero title={t('prov.heading')} purpose={t('prov.intro')} />
      {tabs}

      <Card>
        <CardBody>
          <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1">
            <Sparkles aria-hidden="true" className="size-5 text-ai" />
            <span className="text-2xs font-bold uppercase tracking-wider text-ink-subtle">
              {t('prov.kpiActive')}
            </span>
            {/* A monospace badge, not a display-size number. `DETERMINISTIC_LOCAL`
                is a 19-character identifier and the KpiCard slot it started in
                clipped it at 1440px -- that component is built for a figure. */}
            <Badge tone="info" withIcon={false}>
              <span className="font-mono">{data.activeProvider}</span>
            </Badge>
            <span className="text-2xs text-ink-muted">{t('prov.kpiActiveCaption')}</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <KpiCard
              label={t('prov.kpiDeclared')}
              value={String(data.providers.length)}
              icon={<Cpu aria-hidden="true" className="size-5" />}
            />
            <KpiCard
              label={t('prov.kpiAvailable')}
              value={String(available.length)}
              caption={t('prov.kpiAvailableCaption')}
              icon={<ShieldCheck aria-hidden="true" className="size-5" />}
            />
            <KpiCard
              label={t('prov.kpiCredentialled')}
              value={String(data.providers.filter((row) => row.credentialConfigured).length)}
              caption={t('prov.kpiCredentialledCaption')}
              icon={<KeyRound aria-hidden="true" className="size-5" />}
            />
          </div>
          <p className="mt-3 text-2xs text-ink-muted">
            {t('prov.defaultsNote', {
              perJob: String(data.defaults.perJobTokenBudget),
              daily: String(data.defaults.dailyTokenBudget),
              concurrency: String(data.defaults.concurrency),
              attempts: String(data.defaults.maxAttempts),
            })}
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t('prov.tableHeading')} description={t('prov.tableIntro')} />
        <CardBody>
          <DataTable caption={t('prov.tableHeading')} captionHidden>
            <THead>
              <Tr>
                <Th scope="col">{t('prov.colProvider')}</Th>
                <Th scope="col">{t('prov.colState')}</Th>
                <Th scope="col">{t('prov.colModel')}</Th>
                <Th scope="col">{t('prov.colCredential')}</Th>
                <Th scope="col">{t('prov.colHealth')}</Th>
                <Th scope="col">{t('prov.colValidation')}</Th>
                <Th scope="col">{t('prov.colActions')}</Th>
              </Tr>
            </THead>
            <TBody>
              {data.providers.map((row) => (
                <Tr key={row.providerId}>
                  <Th scope="row">
                    <span className="flex flex-col gap-1">
                      <span className="font-mono text-2xs font-bold">{row.providerId}</span>
                      <span className="text-2xs text-ink-muted">{row.displayName}</span>
                      {/* Execution mode lives here rather than in a column of
                          its own: it is a property of the provider, not a
                          measurement, and eight columns pushed Actions off a
                          1440px screen. */}
                      <span className="text-2xs text-ink-muted">
                        {row.supportedExecutionModes
                          .map((mode) =>
                            mode === 'PLATFORM_MANAGED' ? t('prov.platform') : t('prov.user'),
                          )
                          .join(' · ')}
                      </span>
                      {row.providerId === data.activeProvider ? (
                        <Badge tone="info" withIcon={false}>
                          {t('prov.isActive')}
                        </Badge>
                      ) : null}
                    </span>
                  </Th>
                  <Td>
                    <span className="flex flex-col gap-1">
                      <Badge tone={STATE_TONE[row.state] ?? 'neutral'} withIcon={false}>
                        {row.state}
                      </Badge>
                      {/* The REASON, always. A state with no reason sends the
                          reader to guess between Legal, a release and a vault. */}
                      <span className="max-w-56 text-2xs text-ink-muted">{row.stateReason}</span>
                      <span className="flex flex-wrap gap-1">
                        <Badge tone={row.enabled ? 'success' : 'neutral'} withIcon={false}>
                          {row.enabled ? t('prov.on') : t('prov.off')}
                        </Badge>
                        <Badge tone={row.approved ? 'success' : 'warning'} withIcon={false}>
                          {row.approved ? t('prov.approvedShort') : t('prov.unapprovedShort')}
                        </Badge>
                        <Badge tone={row.registered ? 'success' : 'neutral'} withIcon={false}>
                          {row.registered ? t('prov.built') : t('prov.notBuilt')}
                        </Badge>
                      </span>
                    </span>
                  </Td>
                  <Td>
                    <span className="flex flex-col gap-0.5 text-2xs">
                      <span className="font-mono">{row.modelId ?? DASH}</span>
                      <span className="text-ink-muted">{row.baseUrl ?? t('prov.noEndpoint')}</span>
                      <span className="text-ink-muted">
                        {row.providerVersion === null
                          ? t('prov.noVersion')
                          : t('prov.version', { version: row.providerVersion })}
                      </span>
                    </span>
                  </Td>
                  <Td>
                    <span className="flex flex-col gap-1">
                      <Badge
                        tone={row.credentialConfigured ? 'success' : 'neutral'}
                        withIcon={false}
                      >
                        {row.credentialConfigured ? t('prov.refConfigured') : t('prov.refMissing')}
                      </Badge>
                      {/* Labelled as the SETTINGS row's timestamp, not the
                          credential's. Nothing records when one reference
                          changed, and a rotation date inferred from a shared
                          row would be a fabricated fact about a secret. */}
                      <span className="text-2xs text-ink-muted">
                        {row.settingsUpdatedAt === null
                          ? t('prov.neverConfigured')
                          : t('prov.settingsUpdated', { at: when(row.settingsUpdatedAt) })}
                      </span>
                    </span>
                  </Td>
                  <Td>
                    <span className="flex flex-col gap-1">
                      <StatusBadge
                        status={row.health}
                        tone={HEALTH_TONE[row.health] ?? 'neutral'}
                      />
                      <span className="max-w-40 text-2xs text-ink-muted">{row.healthReason}</span>
                    </span>
                  </Td>
                  <Td>
                    {row.lastValidation === null ? (
                      <span className="text-2xs text-ink-muted">{t('prov.neverValidated')}</span>
                    ) : (
                      <span className="flex flex-col gap-1">
                        <StatusBadge
                          status={row.lastValidation.outcome}
                          tone={
                            row.lastValidation.outcome === 'PASSED'
                              ? 'success'
                              : row.lastValidation.outcome === 'FAILED'
                                ? 'danger'
                                : 'warning'
                          }
                        />
                        <span className="text-2xs text-ink-muted">
                          {t('prov.validatedAt', {
                            at: when(row.lastValidation.validatedAt),
                            by: row.lastValidation.validatedByDisplayName ?? t('prov.unknownActor'),
                          })}
                        </span>
                        {/* The FAILING checks in the closed state, because
                            that is what a reader has to act on, and the whole
                            chain behind a native disclosure. Five checks with a
                            sentence each made one row 800px tall and pushed the
                            Actions column off a 1440px screen. */}
                        {row.lastValidation.steps.filter((step) => step.result === 'FAILED')
                          .length > 0 ? (
                          <span className="flex flex-wrap gap-1">
                            {row.lastValidation.steps
                              .filter((step) => step.result === 'FAILED')
                              .map((step) => (
                                <Badge key={step.check} tone="danger" withIcon={false}>
                                  {step.check}
                                </Badge>
                              ))}
                          </span>
                        ) : null}
                        <details className="text-2xs">
                          <summary className="cursor-pointer text-info underline">
                            {t('prov.showChain')}
                          </summary>
                          <ul className="mt-1 flex w-64 flex-col gap-1">
                            {row.lastValidation.steps.map((step) => (
                              <li key={step.check} className="flex flex-col gap-0.5">
                                <Badge
                                  tone={RESULT_TONE[step.result] ?? 'neutral'}
                                  withIcon={false}
                                >
                                  {step.check} — {step.result}
                                </Badge>
                                <span className="text-ink-muted">{step.detail}</span>
                              </li>
                            ))}
                          </ul>
                        </details>
                      </span>
                    )}
                  </Td>
                  <Td>
                    {data.canManage ? (
                      <span className="flex flex-col items-start gap-2">
                        <ProviderSettingsButton provider={values(row)} actingAs={subject.label} />
                        <ProviderApprovalButton provider={values(row)} actingAs={subject.label} />
                        <ProviderLimitButton providerId={row.providerId} actingAs={subject.label} />
                        <ValidateProviderButton provider={values(row)} actingAs={subject.label} />
                        {row.providerId === data.activeProvider ? null : (
                          <ActivateProviderButton provider={values(row)} actingAs={subject.label} />
                        )}
                      </span>
                    ) : (
                      <span className="text-2xs text-ink-muted">{t('prov.readOnly')}</span>
                    )}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </DataTable>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t('prov.secretsHeading')} />
        <CardBody>
          <p className="max-w-prose text-base text-ink-muted">{t('prov.secretsBody')}</p>
          <ul className="mt-3 flex list-disc flex-col gap-1 pl-5 text-sm text-ink-muted">
            <li>{t('prov.secretsRefShape')}</li>
            <li>{t('prov.secretsNeverShown')}</li>
            <li>{t('prov.secretsNoResolver')}</li>
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}
