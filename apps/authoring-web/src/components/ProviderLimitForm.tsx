'use client';

// The per-provider token limit dialog.
//
// A client component for the same reason the taxonomy forms are: the write can
// be refused for a reason the person has to read — a per-job ceiling above the
// daily one, a concurrency value out of range — and a redirect-and-rerender
// would throw the reason away.
//
// Every field is OPTIONAL and an empty one means "leave the platform ceiling in
// place". Clearing them all removes the override entirely, which is a different
// gesture from setting a ceiling of zero: zero forbids generation for that
// provider, and there has to be a way back to the default.

import { useActionState } from 'react';
import { Button, Field, Modal, TextInput } from '@knowzy/shared-ui';
import { SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';
import { t } from '../copy';
import { setProviderLimitsAction } from '../app/actions';
import { Problem } from './Problem';

export const ProviderLimitButton = ({
  providerId,
  actingAs,
}: {
  readonly providerId: string;
  readonly actingAs: string;
}) => {
  const [open, setOpen] = useState(false);
  const [state, submit, pending] = useActionState(setProviderLimitsAction, null);

  return (
    <>
      <Button tone="secondary" size="sm" onClick={() => setOpen(true)}>
        <SlidersHorizontal className="size-4" aria-hidden="true" />
        {t('ai.setLimits')}
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t('ai.limitsTitle', { provider: providerId })}
        description={t('ai.limitsIntro')}
      >
        <form action={submit} className="flex flex-col gap-4">
          <input type="hidden" name="providerId" value={providerId} />

          <Field
            id={`perJob-${providerId}`}
            label={t('ai.limitPerJob')}
            hint={t('ai.limitPerJobHint')}
          >
            <TextInput id={`perJob-${providerId}`} name="perJobTokenBudget" type="number" min={0} />
          </Field>

          <Field
            id={`daily-${providerId}`}
            label={t('ai.limitDaily')}
            hint={t('ai.limitDailyHint')}
          >
            <TextInput id={`daily-${providerId}`} name="dailyTokenBudget" type="number" min={0} />
          </Field>

          <Field id={`weekly-${providerId}`} label={t('ai.limitWeekly')}>
            <TextInput id={`weekly-${providerId}`} name="weeklyTokenBudget" type="number" min={0} />
          </Field>

          <Field id={`monthly-${providerId}`} label={t('ai.limitMonthly')}>
            <TextInput
              id={`monthly-${providerId}`}
              name="monthlyTokenBudget"
              type="number"
              min={0}
            />
          </Field>

          <Field
            id={`concurrency-${providerId}`}
            label={t('ai.limitConcurrency')}
            hint={t('ai.limitConcurrencyHint')}
          >
            <TextInput
              id={`concurrency-${providerId}`}
              name="concurrency"
              type="number"
              min={1}
              max={32}
            />
          </Field>

          {state === null || state.ok || state.problem === undefined ? null : (
            <Problem problem={state.problem} actingAs={actingAs} />
          )}

          {state?.ok === true ? (
            <p className="text-sm font-semibold text-success">
              {state.removed === true ? t('ai.limitsRemoved') : t('ai.limitsSaved')}
            </p>
          ) : null}

          {/* One action. `Modal` supplies its own Close, and a second one beside
              Save read as two different ways out of the same dialog. Found by
              looking at the screenshot rather than at the code. */}
          <div className="flex gap-3">
            <Button disabled={pending}>{t('ai.saveLimits')}</Button>
          </div>
        </form>
      </Modal>
    </>
  );
};
