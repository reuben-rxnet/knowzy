'use client';

// AI Document Studio M3 -- the forms on the Studio's pages
// (docs/competencies/AI_DOCUMENT_STUDIO_ARCHITECTURE.md §11).
//
// Each is a real form posting to a server action; the API decides every
// refusal and the form shows it. "Add to Question Generation Repository"
// opens a confirmation with the brief's exact words, because the confirmation
// IS the approval (§11.8) -- there is no second step after it.

import { useActionState, useState } from 'react';
import { Button, ButtonLink, Field, Modal, Textarea } from '@knowzy/shared-ui';
import { FilePlus2, Sparkles } from 'lucide-react';
import { t } from '../copy';
import type { ActionState } from '../app/actions';
import {
  addToRepositoryAction,
  chooseDocumentAction,
  discardDraftAction,
  prepareDocumentAction,
  restoreAiAction,
  revalidationDraftAction,
  saveContentAction,
  uploadDocumentAction,
} from '../app/document-studio/actions';
import { Problem } from './Problem';

const Outcome = ({
  state,
  actingAs,
  success,
}: {
  readonly state: ActionState | null;
  readonly actingAs: string;
  readonly success?: string;
}) => {
  if (state === null) return null;
  if (state.ok === false && state.problem !== undefined) {
    return <Problem problem={state.problem} actingAs={actingAs} />;
  }
  return success === undefined ? null : (
    <p role="status" className="text-sm font-medium text-success">
      {success}
    </p>
  );
};

export const UploadDocumentForm = ({ actingAs }: { readonly actingAs: string }) => {
  const [state, submit, pending] = useActionState(uploadDocumentAction, null);
  return (
    <form action={submit} className="flex flex-col gap-3">
      <Field id="ds-upload" label={t('ds.uploadField')} hint={t('ds.uploadHint')}>
        <input
          id="ds-upload"
          name="file"
          type="file"
          required
          accept=".docx,.pdf,.pptx,.md,.txt"
          className="block w-full max-w-md text-sm text-ink file:mr-3 file:min-h-target file:rounded-md file:border file:border-line file:bg-surface file:px-3 file:text-sm file:font-medium"
        />
      </Field>
      <div>
        <Button disabled={pending} {...(pending ? { disabledReason: t('ds.working') } : {})}>
          <FilePlus2 aria-hidden="true" className="size-4" />
          {t('ds.uploadButton')}
        </Button>
      </div>
      <Outcome state={state} actingAs={actingAs} />
    </form>
  );
};

export const ChooseDocumentButton = ({
  documentId,
  actingAs,
}: {
  readonly documentId: string;
  readonly actingAs: string;
}) => {
  const [state, submit, pending] = useActionState(chooseDocumentAction, null);
  return (
    <form action={submit} className="flex flex-col gap-1">
      <input type="hidden" name="documentId" value={documentId} />
      <Button
        tone="secondary"
        size="sm"
        disabled={pending}
        {...(pending ? { disabledReason: t('ds.working') } : {})}
      >
        {t('ds.chooseButton')}
      </Button>
      <Outcome state={state} actingAs={actingAs} />
    </form>
  );
};

export const PrepareButton = ({
  preparedDocumentId,
  again,
  blockedReason,
  actingAs,
}: {
  readonly preparedDocumentId: string;
  readonly again: boolean;
  /** Set when nothing can prepare: the button is disabled and says why. */
  readonly blockedReason: string | null;
  readonly actingAs: string;
}) => {
  const [state, submit, pending] = useActionState(prepareDocumentAction, null);
  const label = again ? t('ds.prepareAgain') : t('ds.prepareButton');
  return (
    <form action={submit} className="flex flex-col gap-2">
      <input type="hidden" name="preparedDocumentId" value={preparedDocumentId} />
      <div>
        <Button
          tone={again ? 'secondary' : 'primary'}
          disabled={pending || blockedReason !== null}
          {...(blockedReason !== null
            ? { disabledReason: blockedReason }
            : pending
              ? { disabledReason: t('ds.preparing') }
              : {})}
        >
          <Sparkles aria-hidden="true" className="size-4" />
          {pending ? t('ds.preparing') : label}
        </Button>
      </div>
      <Outcome state={state} actingAs={actingAs} />
    </form>
  );
};

export const EditPreparedForm = ({
  preparedDocumentId,
  versionId,
  content,
  isDraft,
  actingAs,
}: {
  readonly preparedDocumentId: string;
  readonly versionId: string;
  readonly content: string;
  readonly isDraft: boolean;
  readonly actingAs: string;
}) => {
  const [state, submit, pending] = useActionState(saveContentAction, null);
  return (
    <form action={submit} className="flex flex-col gap-3">
      <input type="hidden" name="preparedDocumentId" value={preparedDocumentId} />
      <input type="hidden" name="versionId" value={versionId} />
      {isDraft ? null : <p className="text-sm text-ink-muted">{t('ds.readOnlyVersion')}</p>}
      <Field id="ds-content" label={t('ds.editLabel')} hint={t('ds.editHint')}>
        <Textarea id="ds-content" name="content" rows={28} defaultValue={content} />
      </Field>
      <div>
        <Button disabled={pending} {...(pending ? { disabledReason: t('ds.working') } : {})}>
          {t('ds.saveChanges')}
        </Button>
      </div>
      <Outcome state={state} actingAs={actingAs} success={t('ds.saved')} />
    </form>
  );
};

const VersionAct = ({
  action,
  preparedDocumentId,
  versionId,
  label,
  success,
  actingAs,
  tone = 'secondary',
}: {
  readonly action: typeof restoreAiAction;
  readonly preparedDocumentId: string;
  readonly versionId: string;
  readonly label: string;
  readonly success: string;
  readonly actingAs: string;
  readonly tone?: 'primary' | 'secondary';
}) => {
  const [state, submit, pending] = useActionState(action, null);
  return (
    <form action={submit} className="flex flex-col gap-1">
      <input type="hidden" name="preparedDocumentId" value={preparedDocumentId} />
      <input type="hidden" name="versionId" value={versionId} />
      <Button
        tone={tone}
        size="sm"
        disabled={pending}
        {...(pending ? { disabledReason: t('ds.working') } : {})}
      >
        {label}
      </Button>
      <Outcome state={state} actingAs={actingAs} success={success} />
    </form>
  );
};

export const RestoreAiButton = (props: {
  readonly preparedDocumentId: string;
  readonly versionId: string;
  readonly live: boolean;
  readonly actingAs: string;
}) => (
  <VersionAct
    action={restoreAiAction}
    preparedDocumentId={props.preparedDocumentId}
    versionId={props.versionId}
    // The test preparer is not AI, so its button does not say "AI" (§11.4).
    label={props.live ? t('ds.restoreAi') : t('ds.restoreTest')}
    success={t('ds.restored')}
    actingAs={props.actingAs}
  />
);

export const DiscardDraftButton = (props: {
  readonly preparedDocumentId: string;
  readonly versionId: string;
  readonly actingAs: string;
}) => (
  <VersionAct
    action={discardDraftAction}
    preparedDocumentId={props.preparedDocumentId}
    versionId={props.versionId}
    label={t('ds.discard')}
    success={t('ds.discarded')}
    actingAs={props.actingAs}
  />
);

export const ReviewUpdatedOriginalButton = (props: {
  readonly preparedDocumentId: string;
  readonly versionId: string;
  readonly actingAs: string;
}) => (
  <VersionAct
    action={revalidationDraftAction}
    preparedDocumentId={props.preparedDocumentId}
    versionId={props.versionId}
    label={t('ds.reviewUpdated')}
    success=""
    actingAs={props.actingAs}
    tone="primary"
  />
);

export const AddToRepositoryButton = ({
  preparedDocumentId,
  versionId,
  versionNumber,
  actingAs,
}: {
  readonly preparedDocumentId: string;
  readonly versionId: string;
  readonly versionNumber: number;
  readonly actingAs: string;
}) => {
  const [open, setOpen] = useState(false);
  const [state, submit, pending] = useActionState(addToRepositoryAction, null);
  const added =
    state?.ok === true
      ? (state.data as { repositorySourceId: string; repositoryDocumentId: string })
      : null;
  if (added !== null) {
    return (
      <div className="flex flex-col gap-2" role="status">
        <p className="text-sm font-medium text-success">{t('ds.added', { n: versionNumber })}</p>
        <div>
          <ButtonLink
            tone="primary"
            href={`/generate?source=${encodeURIComponent(added.repositorySourceId)}&document=${encodeURIComponent(added.repositoryDocumentId)}`}
          >
            {t('ds.generateNow')}
          </ButtonLink>
        </div>
      </div>
    );
  }
  return (
    <>
      <Button onClick={() => setOpen(true)}>{t('ds.addToRepository')}</Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t('ds.confirmTitle')}
        description={t('ds.confirmBody')}
      >
        <form action={submit} className="flex flex-col gap-4">
          <input type="hidden" name="preparedDocumentId" value={preparedDocumentId} />
          <input type="hidden" name="versionId" value={versionId} />
          {state?.ok === false && state.problem !== undefined ? (
            <Problem problem={state.problem} actingAs={actingAs} />
          ) : null}
          <div className="flex gap-3">
            <Button disabled={pending} {...(pending ? { disabledReason: t('ds.working') } : {})}>
              {t('ds.confirmButton')}
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
