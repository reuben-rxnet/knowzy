'use client';

// The create and edit dialogs for domains and topics, and the activate /
// deactivate buttons.
//
// A client component for the same reason SourceActions is one: every one of
// these writes can be refused for a reason the person has to read — a
// duplicate code, a code that has become permanent, a topic that already
// exists in the domain — and a redirect-and-rerender would throw the reason
// away.
//
// The dialog is the shared `Modal`, so Escape, the focus trap and focus
// restoration come with it rather than being reimplemented here.
//
// What is deliberately NOT here: any decision about whether a field may
// change. The code input is rendered only when the server said the code is
// still editable (`codeLocked: false`), and the server refuses it again on
// submit. The screen never becomes the authority.

import { useEffect, useState } from 'react';
import { useActionState } from 'react';
import { Button, CheckboxRow, Field, Modal, Select, TextInput, Textarea } from '@knowzy/shared-ui';
import { Pencil, Plus } from 'lucide-react';
import { t } from '../copy';
import {
  createDomainAction,
  createOrgEntryAction,
  createTopicAction,
  setDomainActiveAction,
  setOrgEntryActiveAction,
  setTopicActiveAction,
  updateDomainAction,
  updateOrgEntryAction,
  updateTopicAction,
} from '../app/actions';
import { Problem } from './Problem';

export interface DomainOption {
  readonly domainId: string;
  readonly code: string;
  readonly name: string;
}

export interface DomainFormValues {
  readonly domainId: string;
  readonly code: string;
  readonly name: string;
  readonly description: string | null;
  readonly isActive: boolean;
  readonly requireSmeSignoff: boolean;
  readonly codeLocked: boolean;
  readonly questionCount: number;
}

export interface TopicFormValues {
  readonly topicId: string;
  readonly domainId: string;
  readonly name: string;
  readonly description: string | null;
  readonly isActive: boolean;
}

/** Both dialogs share this shell so a refusal renders identically in each. */
const DialogForm = ({
  open,
  onClose,
  title,
  action,
  children,
  actingAs,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: string;
  readonly action: (previous: never, formData: FormData) => Promise<never>;
  readonly children: React.ReactNode;
  readonly actingAs: string;
}) => {
  const [state, submit, pending] = useActionState(
    action as unknown as (
      previous: { ok: boolean; problem?: never } | null,
      formData: FormData,
    ) => Promise<{ ok: boolean; problem?: never }>,
    null,
    '/administration/taxonomy',
  );

  // Closed on success, and left open on a refusal with the reason on screen.
  // The opposite — closing on every submit — is how a duplicate code becomes
  // invisible.
  useEffect(() => {
    if (state?.ok === true) onClose();
  }, [state, onClose]);

  return (
    <Modal open={open} onClose={onClose} title={title} description={t('tax.deactivateNote')}>
      <form action={submit} className="flex flex-col gap-4">
        {children}
        {state?.ok === false && state.problem !== undefined ? (
          <Problem problem={state.problem} actingAs={actingAs} />
        ) : null}
        <div className="flex gap-3">
          <Button disabled={pending} {...(pending ? { disabledReason: t('sources.working') } : {})}>
            {t('tax.save')}
          </Button>
          <Button type="button" tone="secondary" onClick={onClose}>
            {t('tax.cancel')}
          </Button>
        </div>
      </form>
    </Modal>
  );
};

export const NewDomainButton = ({ actingAs }: { readonly actingAs: string }) => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus aria-hidden="true" className="size-4" />
        {t('tax.newDomain')}
      </Button>
      <DialogForm
        open={open}
        onClose={() => setOpen(false)}
        title={t('tax.createDomainTitle')}
        action={createDomainAction as never}
        actingAs={actingAs}
      >
        <Field id="new-domain-code" label={t('tax.code')} hint={t('tax.codeHint')}>
          <TextInput id="new-domain-code" name="code" required />
        </Field>
        <Field id="new-domain-name" label={t('tax.name')}>
          <TextInput id="new-domain-name" name="name" required />
        </Field>
        <Field id="new-domain-description" label={t('tax.description')}>
          <Textarea id="new-domain-description" name="description" rows={3} />
        </Field>
        <CheckboxRow name="isActive" value="true" defaultChecked>
          {t('tax.activeField')}
        </CheckboxRow>
        <CheckboxRow name="requireSmeSignoff" value="true">
          {t('tax.requireSmeSignoff')}
        </CheckboxRow>
      </DialogForm>
    </>
  );
};

export const EditDomainButton = ({
  domain,
  actingAs,
}: {
  readonly domain: DomainFormValues;
  readonly actingAs: string;
}) => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button tone="secondary" size="sm" onClick={() => setOpen(true)}>
        <Pencil aria-hidden="true" className="size-4" />
        {t('tax.edit')}
      </Button>
      <DialogForm
        open={open}
        onClose={() => setOpen(false)}
        title={`${t('tax.editDomainTitle')} — ${domain.code}`}
        action={updateDomainAction as never}
        actingAs={actingAs}
      >
        <input type="hidden" name="domainId" value={domain.domainId} />
        {domain.codeLocked ? (
          // Rendered as text, not a disabled input: a disabled field still
          // looks like something that could be enabled. The reason names the
          // number of references, because "permanent" without a cause reads
          // like an arbitrary rule.
          <div className="flex flex-col gap-1 rounded-md bg-surface-muted px-3 py-2">
            <span className="text-2xs font-semibold uppercase tracking-wide text-ink-muted">
              {t('tax.code')} · {t('tax.codeLocked')}
            </span>
            <span className="font-mono text-base text-ink">{domain.code}</span>
            <span className="text-2xs text-ink-muted">
              {t('tax.codeLockedReason', { questions: domain.questionCount })}
            </span>
          </div>
        ) : (
          <Field
            id={`domain-code-${domain.domainId}`}
            label={t('tax.code')}
            hint={t('tax.codeEditableReason')}
          >
            <TextInput
              id={`domain-code-${domain.domainId}`}
              name="code"
              defaultValue={domain.code}
              required
            />
          </Field>
        )}
        <Field id={`domain-name-${domain.domainId}`} label={t('tax.name')}>
          <TextInput
            id={`domain-name-${domain.domainId}`}
            name="name"
            defaultValue={domain.name}
            required
          />
        </Field>
        <Field id={`domain-description-${domain.domainId}`} label={t('tax.description')}>
          <Textarea
            id={`domain-description-${domain.domainId}`}
            name="description"
            defaultValue={domain.description ?? ''}
            rows={3}
          />
        </Field>
        <CheckboxRow name="isActive" value="true" defaultChecked>
          {t('tax.activeField')}
        </CheckboxRow>
        <CheckboxRow name="requireSmeSignoff" value="true" defaultChecked>
          {t('tax.requireSmeSignoff')}
        </CheckboxRow>
      </DialogForm>
    </>
  );
};

export const NewTopicButton = ({
  domains,
  actingAs,
}: {
  readonly domains: readonly DomainOption[];
  readonly actingAs: string;
}) => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        disabled={domains.length === 0}
        {...(domains.length === 0 ? { disabledReason: t('tax.noDomains') } : {})}
      >
        <Plus aria-hidden="true" className="size-4" />
        {t('tax.newTopic')}
      </Button>
      <DialogForm
        open={open}
        onClose={() => setOpen(false)}
        title={t('tax.createTopicTitle')}
        action={createTopicAction as never}
        actingAs={actingAs}
      >
        {/* Exactly one domain, chosen here and never changed afterwards: a
            topic that moved domain would take its questions' lineage with
            it. */}
        <Field id="new-topic-domain" label={t('tax.domainColumn')}>
          <Select id="new-topic-domain" name="domainId">
            {domains.map((domain) => (
              <option key={domain.domainId} value={domain.domainId}>
                {domain.code} — {domain.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="new-topic-name" label={t('tax.name')}>
          <TextInput id="new-topic-name" name="name" required />
        </Field>
        <Field id="new-topic-description" label={t('tax.description')}>
          <Textarea id="new-topic-description" name="description" rows={3} />
        </Field>
        <CheckboxRow name="isActive" value="true" defaultChecked>
          {t('tax.activeField')}
        </CheckboxRow>
      </DialogForm>
    </>
  );
};

export const EditTopicButton = ({
  topic,
  actingAs,
}: {
  readonly topic: TopicFormValues;
  readonly actingAs: string;
}) => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button tone="secondary" size="sm" onClick={() => setOpen(true)}>
        <Pencil aria-hidden="true" className="size-4" />
        {t('tax.edit')}
      </Button>
      <DialogForm
        open={open}
        onClose={() => setOpen(false)}
        title={`${t('tax.editTopicTitle')} — ${topic.name}`}
        action={updateTopicAction as never}
        actingAs={actingAs}
      >
        <input type="hidden" name="topicId" value={topic.topicId} />
        <Field id={`topic-name-${topic.topicId}`} label={t('tax.name')}>
          <TextInput
            id={`topic-name-${topic.topicId}`}
            name="name"
            defaultValue={topic.name}
            required
          />
        </Field>
        <Field id={`topic-description-${topic.topicId}`} label={t('tax.description')}>
          <Textarea
            id={`topic-description-${topic.topicId}`}
            name="description"
            defaultValue={topic.description ?? ''}
            rows={3}
          />
        </Field>
        <CheckboxRow name="isActive" value="true" defaultChecked>
          {t('tax.activeField')}
        </CheckboxRow>
      </DialogForm>
    </>
  );
};

/**
 * Activate / deactivate, as its own one-field form.
 *
 * Separate from the edit dialog because it is the action an administrator
 * takes most often and it needs no other decision. It posts the target state
 * rather than a toggle, so a double submit cannot flip something twice.
 */
export const ActiveToggle = ({
  kind,
  id,
  isActive,
  actingAs,
}: {
  readonly kind: 'domain' | 'topic';
  readonly id: string;
  readonly isActive: boolean;
  readonly actingAs: string;
}) => {
  const [state, submit, pending] = useActionState(
    kind === 'domain' ? setDomainActiveAction : setTopicActiveAction,
    null,
    '/administration/taxonomy',
  );

  return (
    <div className="flex flex-col gap-1">
      <form action={submit}>
        <input type="hidden" name={kind === 'domain' ? 'domainId' : 'topicId'} value={id} />
        <input type="hidden" name="isActive" value={isActive ? 'false' : 'true'} />
        <Button
          tone="secondary"
          size="sm"
          disabled={pending}
          {...(pending ? { disabledReason: t('sources.working') } : {})}
        >
          {isActive ? t('tax.deactivate') : t('tax.activate')}
        </Button>
      </form>
      {state?.ok === false && state.problem !== undefined ? (
        <Problem problem={state.problem} actingAs={actingAs} />
      ) : null}
    </div>
  );
};

// ---------------------------------------------------------------------------
// The organizational axes — departments and roles (2026-09-26)
//
// ONE pair of components for both catalogues. A department and a role differ in
// their noun and nothing else, and two copies of this form would drift the
// first time one of them gained a field.
//
// The code input is rendered only while the server says the code is still
// editable (`codeLocked: false`), and the server refuses it again on submit.
// The screen never becomes the authority — it only declines to offer a control
// that would be refused.

export type OrgKind = 'department' | 'role';

export interface OrgFormValues {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly description: string | null;
  readonly isActive: boolean;
  readonly codeLocked: boolean;
}

export const NewOrgEntryButton = ({
  kind,
  actingAs,
}: {
  readonly kind: OrgKind;
  readonly actingAs: string;
}) => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus aria-hidden="true" className="size-4" />
        {kind === 'department' ? t('tax.newDepartment') : t('tax.newRole')}
      </Button>
      <DialogForm
        open={open}
        onClose={() => setOpen(false)}
        title={kind === 'department' ? t('tax.createDepartmentTitle') : t('tax.createRoleTitle')}
        action={createOrgEntryAction as never}
        actingAs={actingAs}
      >
        <input type="hidden" name="kind" value={kind} />
        <Field id={`new-${kind}-code`} label={t('tax.code')} hint={t('tax.orgCodeHint')}>
          <TextInput id={`new-${kind}-code`} name="code" required />
        </Field>
        <Field id={`new-${kind}-name`} label={t('tax.name')}>
          <TextInput id={`new-${kind}-name`} name="name" required />
        </Field>
        <Field id={`new-${kind}-description`} label={t('tax.description')}>
          <Textarea id={`new-${kind}-description`} name="description" rows={2} />
        </Field>
        <CheckboxRow name="isActive" value="true" defaultChecked>
          {t('tax.activeField')}
        </CheckboxRow>
      </DialogForm>
    </>
  );
};

export const EditOrgEntryButton = ({
  kind,
  entry,
  actingAs,
}: {
  readonly kind: OrgKind;
  readonly entry: OrgFormValues;
  readonly actingAs: string;
}) => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button tone="secondary" size="sm" onClick={() => setOpen(true)}>
        <Pencil aria-hidden="true" className="size-4" />
        {t('tax.edit')}
      </Button>
      <DialogForm
        open={open}
        onClose={() => setOpen(false)}
        title={kind === 'department' ? t('tax.editDepartmentTitle') : t('tax.editRoleTitle')}
        action={updateOrgEntryAction as never}
        actingAs={actingAs}
      >
        <input type="hidden" name="kind" value={kind} />
        <input type="hidden" name="entryId" value={entry.id} />
        {entry.codeLocked ? (
          <p className="text-sm text-ink-muted">{t('tax.codePermanent', { code: entry.code })}</p>
        ) : (
          <Field id={`edit-${kind}-code`} label={t('tax.code')} hint={t('tax.orgCodeHint')}>
            <TextInput id={`edit-${kind}-code`} name="code" defaultValue={entry.code} required />
          </Field>
        )}
        <Field id={`edit-${kind}-name`} label={t('tax.name')}>
          <TextInput id={`edit-${kind}-name`} name="name" defaultValue={entry.name} required />
        </Field>
        <Field id={`edit-${kind}-description`} label={t('tax.description')}>
          <Textarea
            id={`edit-${kind}-description`}
            name="description"
            rows={2}
            defaultValue={entry.description ?? ''}
          />
        </Field>
        <CheckboxRow name="isActive" value="true" defaultChecked={entry.isActive}>
          {t('tax.activeField')}
        </CheckboxRow>
      </DialogForm>
    </>
  );
};

export const OrgActiveToggle = ({
  kind,
  id,
  isActive,
  actingAs,
}: {
  readonly kind: OrgKind;
  readonly id: string;
  readonly isActive: boolean;
  readonly actingAs: string;
}) => {
  const [state, submit, pending] = useActionState(
    setOrgEntryActiveAction,
    null,
    '/administration/taxonomy',
  );

  return (
    <div className="flex flex-col gap-1">
      <form action={submit}>
        <input type="hidden" name="kind" value={kind} />
        <input type="hidden" name="entryId" value={id} />
        <input type="hidden" name="isActive" value={isActive ? 'false' : 'true'} />
        <Button
          tone="secondary"
          size="sm"
          disabled={pending}
          {...(pending ? { disabledReason: t('sources.working') } : {})}
        >
          {isActive ? t('tax.deactivate') : t('tax.activate')}
        </Button>
      </form>
      {state?.ok === false && state.problem !== undefined ? (
        <Problem problem={state.problem} actingAs={actingAs} />
      ) : null}
    </div>
  );
};
