'use client';

// Create an assessment and publish it, in one submission.
//
// The user's M7 list has no assessment-builder page, but the Live Learning
// Portal serves only PUBLISHED assessments — without one it has nothing to
// show. So this is the smallest thing that unblocks the learner half of the
// demonstration, and it sits on the Publish page rather than pretending to be
// the assessment builder that authoring-portal.md §6 specifies.
//
// The four transitions (create → submit → approve → publish) each run and each
// are audited; publication is what pins the eligibility snapshot. The action
// stops at the first refusal and reports it, so a half-made assessment never
// looks ready.
//
// UI-M2 converted the markup and says out loud what this form is: the note
// below is not decoration, it is the difference between this and the specified
// builder.

import { useActionState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import {
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  Field,
  PlannedBadge,
  Select,
  TextInput,
} from '@knowzy/shared-ui';
import { t } from '../copy';
import { createAndPublishAssessment } from '../app/actions';
import { Problem } from './Problem';
import type { WizardDomain } from './GenerateWizard';

export const AssessmentForm = ({ domains }: { domains: readonly WizardDomain[] }) => {
  const [state, submit, pending] = useActionState(createAndPublishAssessment, null, '/publish');

  const domain = domains[0];

  return (
    <Card>
      <CardHeader
        title={t('publish.assessmentHeading')}
        description={t('publish.assessmentIntro')}
        actions={<PlannedBadge>{t('publish.builderPlanned')}</PlannedBadge>}
      />
      <form action={submit}>
        <CardBody>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <Field
              id="assessment-name"
              label={t('publish.assessmentNameLabel')}
              className="md:col-span-2"
            >
              <TextInput id="assessment-name" name="name" type="text" required />
            </Field>
            <Field id="assessment-domain" label={t('publish.assessmentDomainLabel')}>
              <Select id="assessment-domain" name="domainId" defaultValue={domain?.domainId ?? ''}>
                {domains.map((option) => (
                  <option key={option.domainId} value={option.domainId}>
                    {option.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="assessment-topic" label={t('publish.assessmentTopicLabel')}>
              <Select id="assessment-topic" name="topicId">
                {(domain?.topics ?? []).map((topic) => (
                  <option key={topic.topicId} value={topic.topicId}>
                    {topic.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="question-count" label={t('publish.assessmentCountLabel')}>
              <TextInput
                id="question-count"
                name="questionCount"
                type="number"
                min={1}
                max={200}
                defaultValue={4}
              />
            </Field>
            <Field id="pass-percentage" label={t('publish.assessmentPassLabel')}>
              <TextInput
                id="pass-percentage"
                name="passPercentage"
                type="number"
                min={0}
                max={100}
                defaultValue={70}
              />
            </Field>
            <Field
              id="time-limit"
              label={t('publish.assessmentTimeLabel')}
              hint={t('form.optional')}
            >
              <TextInput id="time-limit" name="timeLimitMinutes" type="number" min={1} max={600} />
            </Field>
          </div>
        </CardBody>
        <CardFooter>
          <Button disabled={pending} {...(pending ? { disabledReason: t('sources.working') } : {})}>
            {t('publish.assessmentCreate')}
          </Button>
        </CardFooter>
      </form>

      {state?.ok === false && state.problem !== undefined ? (
        <CardBody>
          <Problem problem={state.problem} />
        </CardBody>
      ) : null}
      {state?.ok === true ? (
        <CardBody>
          <p
            className="flex items-center gap-2 rounded-md bg-success-soft px-3 py-2 text-base font-semibold text-success"
            role="status"
          >
            <CheckCircle2 aria-hidden="true" className="size-4" />
            {t('publish.assessmentReady')}
          </p>
        </CardBody>
      ) : null}
    </Card>
  );
};
