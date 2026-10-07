'use client';

// The dialogs and buttons of Administration → Competencies (COMPETENCY-M2,
// docs/competencies/COMPETENCY_ADMINISTRATION.md).
//
// A client component for the same reason TaxonomyForms is one: nearly every
// write here can be REFUSED for a reason the administrator has to read -- a
// duplicate, a near match, a stale version, separation of duties -- and a
// redirect would throw the reason away. A dialog stays open on a refusal with
// the reason inside it, and closes only on success.
//
// What is deliberately NOT here: any decision. An Approve button the server
// would refuse is rendered disabled WITH the reason (`blockedReason`) so the
// rule is visible before the click, and the server refuses it again anyway.

import { useEffect, useState, useActionState } from 'react';
import { Button, CheckboxRow, Field, Modal, Select, TextInput, Textarea } from '@knowzy/shared-ui';
import { CheckCircle2, Pencil, Plus } from 'lucide-react';
import { t, type CopyKey } from '../copy';
import { competencyWriteAction, type ActionState } from '../app/actions';
import { Problem } from './Problem';

const DOMAINS = [
  'PRODUCT_KNOWLEDGE',
  'FUNCTIONAL_DOMAIN',
  'TECHNICAL',
  'PROCESS',
  'AGILE_PRACTICE',
  'POWER_SKILL',
] as const;

const DECISIONS = [
  'EXACT',
  'CASE_OR_SPACING',
  'SPELLING_CORRECTION',
  'ABBREVIATION',
  'CATEGORY_QUALIFIED',
  'PROVISIONAL',
] as const;

const domainLabel = (kind: string): string => t(`comp.domain.${kind}` as CopyKey);
const decisionLabel = (decision: string): string => t(`comp.decision.${decision}` as CopyKey);

/** One dialog shell, so a refusal renders identically in every form. */
const Dialog = ({
  open,
  onClose,
  title,
  description,
  op,
  children,
  actingAs,
  submitLabel,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: string;
  readonly description?: string;
  readonly op: string;
  readonly children: React.ReactNode;
  readonly actingAs: string;
  readonly submitLabel?: string;
}) => {
  const [state, submit, pending] = useActionState<ActionState | null, FormData>(
    competencyWriteAction,
    null,
  );
  useEffect(() => {
    if (state?.ok === true) onClose();
  }, [state, onClose]);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description ?? t('comp.dialogNote')}
    >
      <form action={submit} className="flex flex-col gap-4">
        <input type="hidden" name="op" value={op} />
        {children}
        {state?.ok === false && state.problem !== undefined ? (
          <Problem problem={state.problem} actingAs={actingAs} />
        ) : null}
        <div className="flex gap-3">
          <Button disabled={pending} {...(pending ? { disabledReason: t('comp.working') } : {})}>
            {submitLabel ?? t('comp.save')}
          </Button>
          <Button type="button" tone="secondary" onClick={onClose}>
            {t('comp.cancel')}
          </Button>
        </div>
      </form>
    </Modal>
  );
};

/** A launcher button plus its dialog. */
const Launcher = ({
  label,
  icon,
  tone = 'secondary',
  disabledReason,
  children,
}: {
  readonly label: string;
  readonly icon?: 'plus' | 'edit' | 'approve';
  readonly tone?: 'primary' | 'secondary';
  readonly disabledReason?: string | null;
  readonly children: (close: () => void, open: boolean) => React.ReactNode;
}) => {
  const [open, setOpen] = useState(false);
  const Icon = icon === 'plus' ? Plus : icon === 'approve' ? CheckCircle2 : Pencil;
  const blocked = disabledReason !== undefined && disabledReason !== null;
  return (
    <>
      <Button
        tone={tone}
        size="sm"
        onClick={() => setOpen(true)}
        disabled={blocked}
        {...(blocked ? { disabledReason } : {})}
      >
        {icon === undefined ? null : <Icon aria-hidden="true" className="size-4" />}
        {label}
      </Button>
      {children(() => setOpen(false), open)}
    </>
  );
};

/** Deactivate / reactivate: one field, so a form rather than a dialog. */
export const StatusButton = ({
  op,
  id,
  status,
  actingAs,
}: {
  readonly op: 'setCategoryStatus' | 'setCompetencyStatus' | 'setAliasStatus';
  readonly id: string;
  readonly status: 'ACTIVE' | 'RETIRED';
  readonly actingAs: string;
}) => {
  const [state, submit, pending] = useActionState<ActionState | null, FormData>(
    competencyWriteAction,
    null,
  );
  return (
    <div className="flex flex-col gap-1">
      <form action={submit}>
        <input type="hidden" name="op" value={op} />
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="status" value={status === 'ACTIVE' ? 'RETIRED' : 'ACTIVE'} />
        <Button
          tone="secondary"
          size="sm"
          disabled={pending}
          {...(pending ? { disabledReason: t('comp.working') } : {})}
        >
          {status === 'ACTIVE' ? t('comp.deactivate') : t('comp.reactivate')}
        </Button>
      </form>
      {state?.ok === false && state.problem !== undefined ? (
        <Problem problem={state.problem} actingAs={actingAs} />
      ) : null}
    </div>
  );
};

const DomainSelect = ({ id, value }: { readonly id: string; readonly value?: string }) => (
  <Field id={id} label={t('comp.fieldDomain')}>
    <Select id={id} name="kind" defaultValue={value ?? 'TECHNICAL'} required>
      {DOMAINS.map((kind) => (
        <option key={kind} value={kind}>
          {domainLabel(kind)}
        </option>
      ))}
    </Select>
  </Field>
);

// ------------------------------------------------------------------ categories

export const NewCategoryButton = ({
  frameworkId,
  actingAs,
}: {
  readonly frameworkId: string;
  readonly actingAs: string;
}) => (
  <Launcher label={t('comp.newCategory')} icon="plus" tone="primary">
    {(close, open) => (
      <Dialog
        open={open}
        onClose={close}
        title={t('comp.createCategoryTitle')}
        op="createCategory"
        actingAs={actingAs}
      >
        <input type="hidden" name="frameworkId" value={frameworkId} />
        <Field id="new-category-code" label={t('comp.fieldCode')} hint={t('comp.fieldCodeHint')}>
          <TextInput id="new-category-code" name="code" required />
        </Field>
        <Field id="new-category-name" label={t('comp.fieldName')}>
          <TextInput id="new-category-name" name="name" required />
        </Field>
        <DomainSelect id="new-category-kind" />
      </Dialog>
    )}
  </Launcher>
);

export const EditCategoryButton = ({
  category,
  actingAs,
}: {
  readonly category: {
    readonly categoryId: string;
    readonly code: string;
    readonly name: string;
    readonly kind: string;
  };
  readonly actingAs: string;
}) => (
  <Launcher label={t('comp.edit')} icon="edit">
    {(close, open) => (
      <Dialog
        open={open}
        onClose={close}
        title={`${t('comp.editCategoryTitle')} — ${category.code}`}
        op="updateCategory"
        actingAs={actingAs}
      >
        <input type="hidden" name="id" value={category.categoryId} />
        <Field id={`category-name-${category.categoryId}`} label={t('comp.fieldName')}>
          <TextInput
            id={`category-name-${category.categoryId}`}
            name="name"
            defaultValue={category.name}
            required
          />
        </Field>
        <DomainSelect id={`category-kind-${category.categoryId}`} value={category.kind} />
      </Dialog>
    )}
  </Launcher>
);

// ---------------------------------------------------------------- competencies

export interface CategoryOption {
  readonly categoryId: string;
  readonly code: string;
  readonly name: string;
}

export interface ScaleOption {
  readonly scaleId: string;
  readonly code: string;
  readonly name: string;
}

export const NewCompetencyButton = ({
  categories,
  scales,
  defaultCategoryId,
  actingAs,
}: {
  readonly categories: readonly CategoryOption[];
  readonly scales: readonly ScaleOption[];
  readonly defaultCategoryId?: string;
  readonly actingAs: string;
}) => (
  <Launcher label={t('comp.newCompetency')} icon="plus" tone="primary">
    {(close, open) => (
      <Dialog
        open={open}
        onClose={close}
        title={t('comp.createCompetencyTitle')}
        op="createCompetency"
        actingAs={actingAs}
      >
        <Field id="new-competency-category" label={t('comp.fieldCategory')}>
          <Select
            id="new-competency-category"
            name="categoryId"
            defaultValue={defaultCategoryId ?? categories[0]?.categoryId ?? ''}
            required
          >
            {categories.map((category) => (
              <option key={category.categoryId} value={category.categoryId}>
                {category.code} — {category.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="new-competency-name" label={t('comp.fieldName')}>
          <TextInput id="new-competency-name" name="name" required />
        </Field>
        <Field
          id="new-competency-segment"
          label={t('comp.fieldSegment')}
          hint={t('comp.fieldSegmentHint')}
        >
          <TextInput id="new-competency-segment" name="codeSegment" />
        </Field>
        <Field id="new-competency-scale" label={t('comp.fieldScale')}>
          <Select
            id="new-competency-scale"
            name="levelScaleId"
            defaultValue={scales[0]?.scaleId ?? ''}
            required
          >
            {scales.map((scale) => (
              <option key={scale.scaleId} value={scale.scaleId}>
                {scale.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="new-competency-description" label={t('comp.fieldDescription')}>
          <Textarea id="new-competency-description" name="description" rows={3} />
        </Field>
        <CheckboxRow name="confirmDistinct" value="true">
          {t('comp.fieldConfirmDistinct')}
        </CheckboxRow>
      </Dialog>
    )}
  </Launcher>
);

export const EditCompetencyButton = ({
  competency,
  actingAs,
}: {
  readonly competency: {
    readonly competencyId: string;
    readonly code: string;
    readonly name: string;
    readonly description: string | null;
  };
  readonly actingAs: string;
}) => (
  <Launcher label={t('comp.edit')} icon="edit">
    {(close, open) => (
      <Dialog
        open={open}
        onClose={close}
        title={`${t('comp.editCompetencyTitle')} — ${competency.code}`}
        op="updateCompetency"
        actingAs={actingAs}
      >
        <input type="hidden" name="id" value={competency.competencyId} />
        <Field id={`competency-name-${competency.competencyId}`} label={t('comp.fieldName')}>
          <TextInput
            id={`competency-name-${competency.competencyId}`}
            name="name"
            defaultValue={competency.name}
            required
          />
        </Field>
        <Field
          id={`competency-description-${competency.competencyId}`}
          label={t('comp.fieldDescription')}
        >
          <Textarea
            id={`competency-description-${competency.competencyId}`}
            name="description"
            rows={3}
            defaultValue={competency.description ?? ''}
          />
        </Field>
      </Dialog>
    )}
  </Launcher>
);

// --------------------------------------------------------------------- aliases

export interface CompetencyOption {
  readonly competencyId: string;
  readonly code: string;
  readonly name: string;
}

const AliasTargetFields = ({
  categories,
  competencies,
}: {
  readonly categories: readonly CategoryOption[];
  readonly competencies: readonly CompetencyOption[];
}) => {
  const [subject, setSubject] = useState<'COMPETENCY' | 'CATEGORY'>('COMPETENCY');
  return (
    <>
      <Field id="new-alias-subject" label={t('comp.fieldSubject')}>
        <Select
          id="new-alias-subject"
          name="subject"
          value={subject}
          onChange={(event) =>
            setSubject(event.target.value === 'CATEGORY' ? 'CATEGORY' : 'COMPETENCY')
          }
        >
          <option value="COMPETENCY">{t('comp.subjectCompetency')}</option>
          <option value="CATEGORY">{t('comp.subjectCategory')}</option>
        </Select>
      </Field>
      <Field id="new-alias-target" label={t('comp.fieldAliasFor')}>
        <Select id="new-alias-target" name="targetId" required key={subject}>
          {subject === 'CATEGORY'
            ? categories.map((row) => (
                <option key={row.categoryId} value={row.categoryId}>
                  {row.code} — {row.name}
                </option>
              ))
            : competencies.map((row) => (
                <option key={row.competencyId} value={row.competencyId}>
                  {row.code} — {row.name}
                </option>
              ))}
        </Select>
      </Field>
    </>
  );
};

const DecisionSelect = ({ id, value }: { readonly id: string; readonly value?: string }) => (
  <Field id={id} label={t('comp.fieldDecision')}>
    <Select id={id} name="decision" defaultValue={value ?? 'SPELLING_CORRECTION'} required>
      {DECISIONS.map((decision) => (
        <option key={decision} value={decision}>
          {decisionLabel(decision)}
        </option>
      ))}
    </Select>
  </Field>
);

export const NewAliasButton = ({
  categories,
  competencies,
  actingAs,
}: {
  readonly categories: readonly CategoryOption[];
  readonly competencies: readonly CompetencyOption[];
  readonly actingAs: string;
}) => (
  <Launcher label={t('comp.newAlias')} icon="plus" tone="primary">
    {(close, open) => (
      <Dialog
        open={open}
        onClose={close}
        title={t('comp.createAliasTitle')}
        op="createAlias"
        actingAs={actingAs}
      >
        <Field id="new-alias-text" label={t('comp.fieldAlias')}>
          <TextInput id="new-alias-text" name="alias" required />
        </Field>
        <AliasTargetFields categories={categories} competencies={competencies} />
        <DecisionSelect id="new-alias-decision" />
        <Field id="new-alias-note" label={t('comp.fieldNote')}>
          <Textarea id="new-alias-note" name="note" rows={2} />
        </Field>
      </Dialog>
    )}
  </Launcher>
);

export const EditAliasButton = ({
  alias,
  actingAs,
}: {
  readonly alias: {
    readonly aliasId: string;
    readonly alias: string;
    readonly decision: string;
    readonly note: string | null;
  };
  readonly actingAs: string;
}) => (
  <Launcher label={t('comp.edit')} icon="edit">
    {(close, open) => (
      <Dialog
        open={open}
        onClose={close}
        title={`${t('comp.editAliasTitle')} — ${alias.alias}`}
        op="updateAlias"
        actingAs={actingAs}
      >
        <input type="hidden" name="id" value={alias.aliasId} />
        <DecisionSelect
          id={`alias-decision-${alias.aliasId}`}
          value={alias.decision === 'UNDECLARED' ? 'PROVISIONAL' : alias.decision}
        />
        <Field id={`alias-note-${alias.aliasId}`} label={t('comp.fieldNote')}>
          <Textarea
            id={`alias-note-${alias.aliasId}`}
            name="note"
            rows={2}
            defaultValue={alias.note ?? ''}
          />
        </Field>
      </Dialog>
    )}
  </Launcher>
);

// -------------------------------------------------------------------- versions

export const NewVersionButton = ({
  frameworkId,
  actingAs,
}: {
  readonly frameworkId: string;
  readonly actingAs: string;
}) => (
  <Launcher label={t('comp.newVersion')} icon="plus" tone="primary">
    {(close, open) => (
      <Dialog
        open={open}
        onClose={close}
        title={t('comp.createVersionTitle')}
        description={t('comp.createVersionNote')}
        op="createVersion"
        actingAs={actingAs}
      >
        <input type="hidden" name="frameworkId" value={frameworkId} />
        <Field
          id="new-version-label"
          label={t('comp.fieldVersionLabel')}
          hint={t('comp.fieldVersionLabelHint')}
        >
          <TextInput id="new-version-label" name="versionLabel" required />
        </Field>
      </Dialog>
    )}
  </Launcher>
);

export const ApproveVersionButton = ({
  versionId,
  versionLabel,
  blockedReason,
  actingAs,
}: {
  readonly versionId: string;
  readonly versionLabel: string;
  readonly blockedReason: string | null;
  readonly actingAs: string;
}) => (
  <Launcher label={t('comp.approve')} icon="approve" tone="primary" disabledReason={blockedReason}>
    {(close, open) => (
      <Dialog
        open={open}
        onClose={close}
        title={`${t('comp.approveVersionTitle')} — ${versionLabel}`}
        description={t('comp.approveVersionNote')}
        op="approveVersion"
        actingAs={actingAs}
        submitLabel={t('comp.approve')}
      >
        <input type="hidden" name="id" value={versionId} />
        <Field
          id={`version-ref-${versionId}`}
          label={t('comp.fieldReference')}
          hint={t('comp.fieldReferenceHint')}
        >
          <TextInput id={`version-ref-${versionId}`} name="approvalReference" required />
        </Field>
        <Field id={`version-effective-${versionId}`} label={t('comp.fieldEffective')}>
          <TextInput id={`version-effective-${versionId}`} name="effectiveFrom" type="date" />
        </Field>
      </Dialog>
    )}
  </Launcher>
);

// ---------------------------------------------------------- role requirements

export interface RequirementCompetencyOption {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly levels: readonly {
    readonly id: string;
    readonly code: string;
    readonly label: string;
  }[];
}

export const ProposeRequirementButton = ({
  roles,
  competencies,
  actingAs,
}: {
  readonly roles: readonly { readonly id: string; readonly code: string; readonly name: string }[];
  readonly competencies: readonly RequirementCompetencyOption[];
  readonly actingAs: string;
}) => {
  const [competencyId, setCompetencyId] = useState('');
  const levels = competencies.find((row) => row.id === competencyId)?.levels ?? [];
  return (
    <Launcher label={t('comp.newRequirement')} icon="plus" tone="primary">
      {(close, open) => (
        <Dialog
          open={open}
          onClose={close}
          title={t('comp.proposeTitle')}
          op="proposeTarget"
          actingAs={actingAs}
        >
          <Field id="req-role" label={t('comp.fieldRole')}>
            <Select id="req-role" name="jobRoleId" defaultValue="" required>
              <option value="" disabled>
                {t('form.select')}
              </option>
              {roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.code} — {role.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="req-competency" label={t('comp.fieldCompetency')}>
            <Select
              id="req-competency"
              name="competencyId"
              value={competencyId}
              onChange={(event) => setCompetencyId(event.target.value)}
              required
            >
              <option value="" disabled>
                {t('form.select')}
              </option>
              {competencies.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.code} — {row.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="req-level" label={t('comp.fieldLevel')}>
            <Select id="req-level" name="targetLevelId" defaultValue="" required key={competencyId}>
              <option value="" disabled>
                {levels.length === 0 ? t('comp.fieldLevelFirst') : t('form.select')}
              </option>
              {levels.map((level) => (
                <option key={level.id} value={level.id}>
                  {level.code} — {level.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="req-source" label={t('comp.fieldSource')} hint={t('comp.fieldSourceHint')}>
            <TextInput id="req-source" name="source" required />
          </Field>
          <Field id="req-rationale" label={t('comp.fieldRationale')}>
            <Textarea id="req-rationale" name="rationale" rows={2} />
          </Field>
          <Field id="req-effective" label={t('comp.fieldEffective')}>
            <TextInput id="req-effective" name="effectiveFrom" type="date" />
          </Field>
        </Dialog>
      )}
    </Launcher>
  );
};

export const EditRequirementButton = ({
  target,
  levels,
  actingAs,
}: {
  readonly target: {
    readonly targetId: string;
    readonly targetLevelId: string;
    readonly source: string;
    readonly rationale: string | null;
    readonly effectiveFrom: string | null;
    readonly label: string;
  };
  readonly levels: readonly {
    readonly id: string;
    readonly code: string;
    readonly label: string;
  }[];
  readonly actingAs: string;
}) => (
  <Launcher label={t('comp.edit')} icon="edit">
    {(close, open) => (
      <Dialog
        open={open}
        onClose={close}
        title={`${t('comp.editRequirementTitle')} — ${target.label}`}
        op="updateTarget"
        actingAs={actingAs}
      >
        <input type="hidden" name="id" value={target.targetId} />
        <Field id={`req-level-${target.targetId}`} label={t('comp.fieldLevel')}>
          <Select
            id={`req-level-${target.targetId}`}
            name="targetLevelId"
            defaultValue={target.targetLevelId}
          >
            {levels.map((level) => (
              <option key={level.id} value={level.id}>
                {level.code} — {level.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          id={`req-source-${target.targetId}`}
          label={t('comp.fieldSource')}
          hint={t('comp.fieldSourceHint')}
        >
          <TextInput
            id={`req-source-${target.targetId}`}
            name="source"
            defaultValue={target.source}
            required
          />
        </Field>
        <Field id={`req-rationale-${target.targetId}`} label={t('comp.fieldRationale')}>
          <Textarea
            id={`req-rationale-${target.targetId}`}
            name="rationale"
            rows={2}
            defaultValue={target.rationale ?? ''}
          />
        </Field>
        <Field id={`req-effective-${target.targetId}`} label={t('comp.fieldEffective')}>
          <TextInput
            id={`req-effective-${target.targetId}`}
            name="effectiveFrom"
            type="date"
            defaultValue={target.effectiveFrom ?? ''}
          />
        </Field>
      </Dialog>
    )}
  </Launcher>
);

export const ApproveRequirementButton = ({
  targetId,
  label,
  blockedReason,
  actingAs,
}: {
  readonly targetId: string;
  readonly label: string;
  readonly blockedReason: string | null;
  readonly actingAs: string;
}) => (
  <Launcher label={t('comp.approve')} icon="approve" tone="primary" disabledReason={blockedReason}>
    {(close, open) => (
      <Dialog
        open={open}
        onClose={close}
        title={`${t('comp.approveRequirementTitle')} — ${label}`}
        description={t('comp.approveRequirementNote')}
        op="approveTarget"
        actingAs={actingAs}
        submitLabel={t('comp.approve')}
      >
        <input type="hidden" name="id" value={targetId} />
        <Field
          id={`req-ref-${targetId}`}
          label={t('comp.fieldReference')}
          hint={t('comp.fieldReferenceHint')}
        >
          <TextInput id={`req-ref-${targetId}`} name="approvalReference" required />
        </Field>
      </Dialog>
    )}
  </Launcher>
);

export const RetireRequirementButton = ({
  targetId,
  actingAs,
}: {
  readonly targetId: string;
  readonly actingAs: string;
}) => {
  const [state, submit, pending] = useActionState<ActionState | null, FormData>(
    competencyWriteAction,
    null,
  );
  return (
    <div className="flex flex-col gap-1">
      <form action={submit}>
        <input type="hidden" name="op" value="retireTarget" />
        <input type="hidden" name="id" value={targetId} />
        <Button
          tone="secondary"
          size="sm"
          disabled={pending}
          {...(pending ? { disabledReason: t('comp.working') } : {})}
        >
          {t('comp.retire')}
        </Button>
      </form>
      {state?.ok === false && state.problem !== undefined ? (
        <Problem problem={state.problem} actingAs={actingAs} />
      ) : null}
    </div>
  );
};
