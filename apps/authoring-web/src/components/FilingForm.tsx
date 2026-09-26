'use client';

// The two editable axes of a question's filing.
//
// Domain and topic are rendered by the page as read-only text, not by this
// form, because they are not editable at all: the domain code is inside the
// published identifier and the topic is what the preflight authorized. Putting
// all four in one form and disabling two would invite the next change to
// "just enable" them.
//
// "Not specified" is a real option, not a placeholder. Clearing an axis is a
// legitimate act -- a batch filed under the wrong department should be able to
// go back to unfiled rather than to a second wrong guess -- so the form sends
// `null` for it, which the service treats as CLEAR. An absent key would mean
// "leave alone", and the two must not be the same wire value.

import { useActionState } from 'react';
import { Button, Card, CardBody, CardFooter, CardHeader, Field, Select } from '@knowzy/shared-ui';
import { t } from '../copy';
import { setQuestionFilingAction } from '../app/actions';
import { Problem } from './Problem';

export interface FilingOption {
  readonly id: string;
  readonly name: string;
}

export const FilingForm = ({
  questionId,
  departments,
  jobRoles,
  currentDepartmentId,
  currentJobRoleId,
  actingAs,
}: {
  readonly questionId: string;
  readonly departments: readonly FilingOption[];
  readonly jobRoles: readonly FilingOption[];
  readonly currentDepartmentId: string | null;
  readonly currentJobRoleId: string | null;
  readonly actingAs: string;
}): React.JSX.Element => {
  const [state, submit, pending] = useActionState(setQuestionFilingAction, null);

  return (
    <Card>
      <CardHeader title={t('filing.editHeading')} description={t('filing.editIntro')} />
      <form action={submit}>
        <CardBody>
          <div className="grid gap-4 md:grid-cols-2">
            <Field id="filing-departmentId" label={t('filing.departmentLabel')}>
              <Select
                id="filing-departmentId"
                name="departmentId"
                defaultValue={currentDepartmentId ?? ''}
              >
                <option value="">{t('filing.unspecified')}</option>
                {departments.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="filing-jobRoleId" label={t('filing.roleLabel')}>
              <Select id="filing-jobRoleId" name="jobRoleId" defaultValue={currentJobRoleId ?? ''}>
                <option value="">{t('filing.unspecified')}</option>
                {jobRoles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <input type="hidden" name="questionId" value={questionId} />
          <p className="mt-3 text-2xs text-ink-muted">{t('filing.versionNote')}</p>
          {state !== null && state.ok === false && state.problem !== undefined ? (
            <div className="mt-3">
              <Problem problem={state.problem} actingAs={actingAs} />
            </div>
          ) : null}
          {/* Three outcomes, not two. "Saved" after a submit that changed
              nothing would claim a version that was deliberately not written. */}
          {state?.ok === true ? (
            <p className="mt-3 text-sm font-semibold text-ink">
              {(state.data as { changedFields?: readonly string[] })?.changedFields?.length
                ? t('filing.saved', {
                    version: String((state.data as { version?: number })?.version ?? ''),
                  })
                : t('filing.unchanged')}
            </p>
          ) : null}
        </CardBody>
        <CardFooter>
          <Button type="submit" disabled={pending}>
            {pending ? t('filing.saving') : t('filing.save')}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
};
