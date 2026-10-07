'use client';

// AI Document Studio, Slice 2: the DOCUMENT_RESTRUCTURE approval controls.
//
// Record (or replace) opens a dialog that REQUIRES a reference; Remove is one
// button. Neither starts anything: there is no restructuring client, and the
// dialog says so. The server decides every refusal, including that a provider
// which cannot restructure cannot be approved.

import { useActionState, useEffect, useState } from 'react';
import { Button, Field, Modal, TextInput } from '@knowzy/shared-ui';
import { CheckCircle2 } from 'lucide-react';
import { t } from '../copy';
import { documentStudioApprovalAction, type ActionState } from '../app/actions';
import { Problem } from './Problem';

export const RecordRestructureApprovalButton = ({
  providerId,
  providerName,
  replacing,
  actingAs,
}: {
  readonly providerId: string;
  readonly providerName: string;
  readonly replacing: boolean;
  readonly actingAs: string;
}) => {
  const [open, setOpen] = useState(false);
  const [state, submit, pending] = useActionState<ActionState | null, FormData>(
    documentStudioApprovalAction,
    null,
  );
  useEffect(() => {
    if (state?.ok === true) setOpen(false);
  }, [state]);
  return (
    <>
      <Button tone={replacing ? 'secondary' : 'primary'} size="sm" onClick={() => setOpen(true)}>
        <CheckCircle2 aria-hidden="true" className="size-4" />
        {replacing ? t('ds.replaceApproval') : t('ds.recordApproval')}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`${replacing ? t('ds.replaceApproval') : t('ds.recordApproval')} — ${providerName}`}
        description={t('ds.approvalDialogNote')}
      >
        <form action={submit} className="flex flex-col gap-4">
          <input type="hidden" name="providerId" value={providerId} />
          <input type="hidden" name="approved" value="true" />
          <Field
            id={`ds-ref-${providerId}`}
            label={t('ds.fieldReference')}
            hint={t('ds.fieldReferenceHint')}
          >
            <TextInput id={`ds-ref-${providerId}`} name="approvalReference" required />
          </Field>
          {state?.ok === false && state.problem !== undefined ? (
            <Problem problem={state.problem} actingAs={actingAs} />
          ) : null}
          <div className="flex gap-3">
            <Button disabled={pending} {...(pending ? { disabledReason: t('ds.working') } : {})}>
              {t('ds.saveApproval')}
            </Button>
            <Button type="button" tone="secondary" onClick={() => setOpen(false)}>
              {t('ds.cancel')}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
};

export const RemoveRestructureApprovalButton = ({
  providerId,
  actingAs,
}: {
  readonly providerId: string;
  readonly actingAs: string;
}) => {
  const [state, submit, pending] = useActionState<ActionState | null, FormData>(
    documentStudioApprovalAction,
    null,
  );
  return (
    <div className="flex flex-col gap-1">
      <form action={submit}>
        <input type="hidden" name="providerId" value={providerId} />
        <input type="hidden" name="approved" value="false" />
        <Button
          tone="secondary"
          size="sm"
          disabled={pending}
          {...(pending ? { disabledReason: t('ds.working') } : {})}
        >
          {t('ds.removeApproval')}
        </Button>
      </form>
      {state?.ok === false && state.problem !== undefined ? (
        <Problem problem={state.problem} actingAs={actingAs} />
      ) : null}
    </div>
  );
};
