'use client';

// The four controls of Administration -> AI Providers.
//
// Client components because every one of them can be REFUSED for a reason the
// administrator has to read, and a redirect-and-rerender throws the reason
// away. "Set baseUrl, modelId, apiKeyRef before enabling this provider" and
// "OPENAI is UNAVAILABLE: no client for this provider is implemented in this
// build" are the entire value of these screens.
//
// Four controls and not one form, because they are four different decisions
// with four different consequences:
//
//   Configure   endpoint, model, credential reference, sampling, on/off
//   Approve     the data-processing approval, with a reference. Its own act.
//   Activate    which provider generation actually uses
//   Validate    a recorded readiness check that calls nothing
//
// The approval is the one that must not be folded into the settings form. It is
// the control that makes T-29 real -- a credential is not authorization -- and
// a checkbox beside "Enabled" is a checkbox somebody ticks on the way past.

import { useActionState, useState } from 'react';
import {
  Badge,
  Button,
  CheckboxRow,
  Field,
  Modal,
  Select,
  Textarea,
  StatusBadge,
  TextInput,
} from '@knowzy/shared-ui';
import { KeyRound, PlugZap, ShieldCheck, Sliders } from 'lucide-react';
import { t } from '../copy';
import {
  setActiveProviderAction,
  setProviderApprovalAction,
  setProviderSettingsAction,
  validateProviderAction,
} from '../app/actions';
import { Problem } from './Problem';

export interface ProviderFormValues {
  readonly providerId: string;
  readonly displayName: string;
  readonly enabled: boolean;
  readonly baseUrl: string | null;
  readonly modelId: string | null;
  readonly temperature: number | null;
  readonly maxOutputTokens: number | null;
  readonly apiStyle: string | null;
  readonly authHeaderName: string | null;
  /** GATEWAY-M1. */
  readonly authLocation: 'HEADER' | 'QUERY_PARAMETER';
  readonly authQueryParameterName: string | null;
  readonly extraHeaders: Readonly<Record<string, string>>;
  readonly credentialConfigured: boolean;
  /** The reference, shown: it names a secret and is not one. */
  readonly credentialReference: string | null;
  readonly approved: boolean;
  readonly state: string;
}

const outcome = (state: { ok: boolean } | null, ok: string): React.JSX.Element | null =>
  state?.ok === true ? <p className="text-sm font-semibold text-success">{ok}</p> : null;

// ---------------------------------------------------------------- configure

export const ProviderSettingsButton = ({
  provider,
  actingAs,
}: {
  readonly provider: ProviderFormValues;
  readonly actingAs: string;
}): React.JSX.Element => {
  const [open, setOpen] = useState(false);
  const [state, submit, pending] = useActionState(setProviderSettingsAction, null);
  const id = provider.providerId;

  return (
    <>
      <Button tone="secondary" size="sm" onClick={() => setOpen(true)}>
        <Sliders className="size-4" aria-hidden="true" />
        {t('prov.configure')}
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t('prov.configureTitle', { provider: provider.displayName })}
        description={t('prov.configureIntro')}
      >
        <form action={submit} className="flex flex-col gap-4">
          <input type="hidden" name="providerId" value={id} />

          <div className="rounded-md border border-line bg-surface-sunken px-3 py-2.5">
            <CheckboxRow
              name="enabled"
              value="true"
              defaultChecked={provider.enabled}
              description={t('prov.enabledHint')}
            >
              {t('prov.enabled')}
            </CheckboxRow>
          </div>

          <Field id={`displayName-${id}`} label={t('prov.displayName')}>
            <TextInput
              id={`displayName-${id}`}
              name="displayName"
              defaultValue={provider.displayName === id ? '' : provider.displayName}
              maxLength={120}
            />
          </Field>

          <Field id={`baseUrl-${id}`} label={t('prov.baseUrl')} hint={t('prov.baseUrlHint')}>
            <TextInput
              id={`baseUrl-${id}`}
              name="baseUrl"
              type="url"
              defaultValue={provider.baseUrl ?? ''}
            />
          </Field>

          <Field id={`modelId-${id}`} label={t('prov.modelId')} hint={t('prov.modelIdHint')}>
            <TextInput id={`modelId-${id}`} name="modelId" defaultValue={provider.modelId ?? ''} />
          </Field>

          {/* The credential box is EMPTY even when a reference is recorded, and
              the recorded one is printed above it instead. Leaving the box
              empty KEEPS it (P-5); removing it is the checkbox below. A
              pre-filled box would be echoed back on every save and could be
              autofilled by the browser. */}
          <Field id={`apiKeyRef-${id}`} label={t('prov.apiKeyRef')} hint={t('prov.apiKeyRefHint')}>
            <span className="mb-2 flex items-center gap-2">
              <KeyRound className="size-4 text-ink-muted" aria-hidden="true" />
              <Badge tone={provider.credentialConfigured ? 'success' : 'neutral'} withIcon={false}>
                {provider.credentialConfigured ? t('prov.refConfigured') : t('prov.refMissing')}
              </Badge>
              {provider.credentialReference === null ? null : (
                <span className="break-all font-mono text-2xs text-ink-muted">
                  {t('prov.refCurrent', { reference: provider.credentialReference })}
                </span>
              )}
            </span>
            <TextInput
              id={`apiKeyRef-${id}`}
              name="apiKeyRef"
              placeholder="localstore://openai-api-key"
              autoComplete="off"
            />
          </Field>

          {provider.credentialConfigured ? (
            <CheckboxRow name="removeApiKeyRef" value="true" description={t('prov.removeRefHint')}>
              {t('prov.removeRef')}
            </CheckboxRow>
          ) : null}

          {/* OPENAI-CODEX-01: how the endpoint is spoken to. Both default to
              OpenAI's own API; a corporate gateway in front of the model
              usually needs the header changed, and sometimes the style. */}
          {id === 'DETERMINISTIC_LOCAL' ? null : (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id={`apiStyle-${id}`} label={t('prov.apiStyle')} hint={t('prov.apiStyleHint')}>
                <Select
                  id={`apiStyle-${id}`}
                  name="apiStyle"
                  defaultValue={provider.apiStyle ?? ''}
                >
                  <option value="">{t('prov.apiStyleDefault')}</option>
                  <option value="RESPONSES">{t('prov.apiStyleResponses')}</option>
                  <option value="CHAT_COMPLETIONS">{t('prov.apiStyleChat')}</option>
                </Select>
              </Field>
              <Field
                id={`authHeaderName-${id}`}
                label={t('prov.authHeaderName')}
                hint={t('prov.authHeaderNameHint')}
              >
                <TextInput
                  id={`authHeaderName-${id}`}
                  name="authHeaderName"
                  placeholder="authorization"
                  defaultValue={provider.authHeaderName ?? ''}
                  autoComplete="off"
                />
              </Field>
              {/* GATEWAY-M1: where the key travels. There is no fallback
                  between the two, so the name for the location NOT chosen
                  must be left empty -- the server refuses both at once. */}
              <Field
                id={`authLocation-${id}`}
                label={t('prov.authLocation')}
                hint={t('prov.authLocationHint')}
              >
                <Select
                  id={`authLocation-${id}`}
                  name="authLocation"
                  defaultValue={provider.authLocation}
                >
                  <option value="HEADER">{t('prov.authLocationHeader')}</option>
                  <option value="QUERY_PARAMETER">{t('prov.authLocationQuery')}</option>
                </Select>
              </Field>
              <Field
                id={`authQueryParameterName-${id}`}
                label={t('prov.authQueryParameterName')}
                hint={t('prov.authQueryParameterNameHint')}
              >
                <TextInput
                  id={`authQueryParameterName-${id}`}
                  name="authQueryParameterName"
                  placeholder="subscription-key"
                  defaultValue={provider.authQueryParameterName ?? ''}
                  autoComplete="off"
                />
              </Field>
              <div className="sm:col-span-2">
                <Field
                  id={`extraHeaders-${id}`}
                  label={t('prov.extraHeaders')}
                  hint={t('prov.extraHeadersHint')}
                >
                  <Textarea
                    id={`extraHeaders-${id}`}
                    name="extraHeaders"
                    rows={2}
                    placeholder="x-openai-supplier: EssilorLuxottica"
                    defaultValue={Object.entries(provider.extraHeaders)
                      .map(([name, value]) => `${name}: ${value}`)
                      .join('\n')}
                  />
                </Field>
              </div>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field id={`temperature-${id}`} label={t('prov.temperature')}>
              <TextInput
                id={`temperature-${id}`}
                name="temperature"
                type="number"
                step="0.1"
                min={0}
                max={2}
                defaultValue={provider.temperature === null ? '' : String(provider.temperature)}
              />
            </Field>
            <Field id={`maxOut-${id}`} label={t('prov.maxOutputTokens')}>
              <TextInput
                id={`maxOut-${id}`}
                name="maxOutputTokens"
                type="number"
                min={1}
                defaultValue={
                  provider.maxOutputTokens === null ? '' : String(provider.maxOutputTokens)
                }
              />
            </Field>
          </div>

          {state === null || state.ok || state.problem === undefined ? null : (
            <Problem problem={state.problem} actingAs={actingAs} />
          )}
          {outcome(state, t('prov.settingsSaved'))}

          <div className="flex gap-3">
            <Button disabled={pending}>{pending ? t('prov.saving') : t('prov.save')}</Button>
          </div>
        </form>
      </Modal>
    </>
  );
};

// ----------------------------------------------------------------- approve

export const ProviderApprovalButton = ({
  provider,
  actingAs,
}: {
  readonly provider: ProviderFormValues;
  readonly actingAs: string;
}): React.JSX.Element => {
  const [open, setOpen] = useState(false);
  const [state, submit, pending] = useActionState(setProviderApprovalAction, null);
  const id = provider.providerId;

  return (
    <>
      <Button tone="secondary" size="sm" onClick={() => setOpen(true)}>
        <ShieldCheck className="size-4" aria-hidden="true" />
        {provider.approved ? t('prov.approvalManage') : t('prov.approvalRecord')}
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t('prov.approvalTitle', { provider: provider.displayName })}
        description={t('prov.approvalIntro')}
      >
        <div className="flex flex-col gap-4">
          <p className="flex items-center gap-2 text-sm">
            <StatusBadge
              status={provider.approved ? t('prov.approvalHeld') : t('prov.approvalAbsent')}
              tone={provider.approved ? 'success' : 'warning'}
            />
          </p>

          {provider.approved ? (
            <form action={submit} className="flex flex-col gap-3">
              <input type="hidden" name="providerId" value={id} />
              <input type="hidden" name="approved" value="false" />
              <p className="max-w-prose text-sm text-ink-muted">{t('prov.withdrawBody')}</p>
              {state === null || state.ok || state.problem === undefined ? null : (
                <Problem problem={state.problem} actingAs={actingAs} />
              )}
              {outcome(state, t('prov.approvalWithdrawn'))}
              <div>
                <Button tone="danger" disabled={pending}>
                  {t('prov.withdraw')}
                </Button>
              </div>
            </form>
          ) : (
            <form action={submit} className="flex flex-col gap-3">
              <input type="hidden" name="providerId" value={id} />
              <input type="hidden" name="approved" value="true" />
              <Field
                id={`approvalReference-${id}`}
                label={t('prov.approvalReference')}
                hint={t('prov.approvalReferenceHint')}
              >
                <TextInput
                  id={`approvalReference-${id}`}
                  name="approvalReference"
                  maxLength={200}
                  placeholder="T-29 / DPIA-2026-014"
                />
              </Field>
              {state === null || state.ok || state.problem === undefined ? null : (
                <Problem problem={state.problem} actingAs={actingAs} />
              )}
              {outcome(state, t('prov.approvalRecorded'))}
              <div>
                <Button disabled={pending}>{t('prov.approvalRecord')}</Button>
              </div>
            </form>
          )}
        </div>
      </Modal>
    </>
  );
};

// ---------------------------------------------------------------- activate

export const ActivateProviderButton = ({
  provider,
  actingAs,
}: {
  readonly provider: ProviderFormValues;
  readonly actingAs: string;
}): React.JSX.Element => {
  const [state, submit, pending] = useActionState(setActiveProviderAction, null);
  const unavailable = provider.state !== 'AVAILABLE';

  return (
    <form action={submit} className="flex flex-col items-start gap-2">
      <input type="hidden" name="providerId" value={provider.providerId} />
      <Button
        tone="secondary"
        size="sm"
        disabled={pending || unavailable}
        // A disabled button's accessible name carries its reason, so the
        // refusal is readable without submitting -- and the server refuses it
        // too, which is the refusal that counts.
        {...(unavailable ? { disabledReason: t('prov.activateBlocked') } : {})}
      >
        {t('prov.activate')}
      </Button>
      {state === null || state.ok || state.problem === undefined ? null : (
        <Problem problem={state.problem} actingAs={actingAs} />
      )}
      {outcome(state, t('prov.activated'))}
    </form>
  );
};

// ---------------------------------------------------------------- validate

interface ValidationResponse {
  readonly readiness?: { readonly state: string; readonly reason: string };
  readonly limits?: {
    readonly requestsPerMinute: number | null;
    readonly tokensPerMinute: number | null;
  } | null;
}

const readinessOf = (state: { ok: boolean; data?: unknown } | null) =>
  state?.ok === true ? ((state.data as ValidationResponse | undefined)?.readiness ?? null) : null;

/** The limits line, or null when there is no result yet. */
const limitsLine = (state: { ok: boolean; data?: unknown } | null): string | null => {
  if (state?.ok !== true) return null;
  const limits = (state.data as ValidationResponse | undefined)?.limits ?? null;
  if (limits === null || (limits.requestsPerMinute === null && limits.tokensPerMinute === null)) {
    return t('prov.limitsNotReported');
  }
  return t('prov.limitsReported', {
    requests: limits.requestsPerMinute === null ? '?' : String(limits.requestsPerMinute),
    tokens: limits.tokensPerMinute === null ? '?' : String(limits.tokensPerMinute),
  });
};

export const ValidateProviderButton = ({
  provider,
  actingAs,
}: {
  readonly provider: ProviderFormValues;
  readonly actingAs: string;
}): React.JSX.Element => {
  const [state, submit, pending] = useActionState(validateProviderAction, null);

  return (
    <form action={submit} className="flex flex-col items-start gap-2">
      <input type="hidden" name="providerId" value={provider.providerId} />
      <Button tone="secondary" size="sm" disabled={pending}>
        <PlugZap className="size-4" aria-hidden="true" />
        {pending ? t('prov.validating') : t('prov.validate')}
      </Button>
      {state === null || state.ok || state.problem === undefined ? null : (
        <Problem problem={state.problem} actingAs={actingAs} />
      )}
      {/* The result is NOT reduced to a tick. Each check is named with what it
          established, and the one that was not attempted says so -- a green
          tick here would be read as "authentication succeeded", which nothing
          in this build has verified. */}
      {state?.ok === true ? (
        <p className="max-w-64 text-sm font-semibold text-ink">{t('prov.validationRecorded')}</p>
      ) : null}
      {readinessOf(state) === null ? null : (
        <p className="max-w-64 text-2xs text-ink-muted" role="status">
          {t('prov.readinessAfter', {
            state: readinessOf(state)?.state ?? '',
            reason: readinessOf(state)?.reason ?? '',
          })}
        </p>
      )}
      {limitsLine(state) === null ? null : (
        <p className="max-w-64 text-2xs text-ink-muted">{limitsLine(state)}</p>
      )}
    </form>
  );
};
