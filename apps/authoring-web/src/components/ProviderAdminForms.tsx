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
  readonly credentialConfigured: boolean;
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

          {/* The credential box is EMPTY even when one is recorded, and says so.
              A masked value pre-filled in a text input is a value the browser
              can be asked to autofill and a value a submit would echo back;
              the field is write-only, and the badge beside it carries the only
              fact a reader needs. */}
          <Field id={`apiKeyRef-${id}`} label={t('prov.apiKeyRef')} hint={t('prov.apiKeyRefHint')}>
            <span className="mb-2 flex items-center gap-2">
              <KeyRound className="size-4 text-ink-muted" aria-hidden="true" />
              <Badge tone={provider.credentialConfigured ? 'success' : 'neutral'} withIcon={false}>
                {provider.credentialConfigured ? t('prov.refConfigured') : t('prov.refMissing')}
              </Badge>
            </span>
            <TextInput
              id={`apiKeyRef-${id}`}
              name="apiKeyRef"
              placeholder="keyvault://my-vault/secrets/OPENAI-API-KEY"
              autoComplete="off"
            />
          </Field>

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
        <p className="text-sm font-semibold text-ink">{t('prov.validationRecorded')}</p>
      ) : null}
    </form>
  );
};
