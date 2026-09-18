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

import { useActionState } from 'react';
import { t } from '../copy';
import { createAndPublishAssessment } from '../app/actions';
import { Problem } from './Problem';
import type { WizardDomain } from './GenerateWizard';

export const AssessmentForm = ({ domains }: { domains: readonly WizardDomain[] }) => {
  const [state, submit, pending] = useActionState(createAndPublishAssessment, null, '/publish');

  const domain = domains[0];

  return (
    <>
      <p className="lede">{t('publish.assessmentIntro')}</p>
      <form action={submit}>
        <label htmlFor="assessment-name">{t('publish.assessmentNameLabel')}</label>
        <input id="assessment-name" name="name" type="text" required defaultValue="" />

        <div className="row">
          <div>
            <label htmlFor="assessment-domain">{t('publish.assessmentDomainLabel')}</label>
            <select id="assessment-domain" name="domainId" defaultValue={domain?.domainId ?? ''}>
              {domains.map((option) => (
                <option key={option.domainId} value={option.domainId}>
                  {option.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="assessment-topic">{t('publish.assessmentTopicLabel')}</label>
            <select id="assessment-topic" name="topicId">
              {(domain?.topics ?? []).map((topic) => (
                <option key={topic.topicId} value={topic.topicId}>
                  {topic.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="row">
          <div>
            <label htmlFor="question-count">{t('publish.assessmentCountLabel')}</label>
            <input
              id="question-count"
              name="questionCount"
              type="number"
              min={1}
              max={200}
              defaultValue={4}
            />
          </div>
          <div>
            <label htmlFor="pass-percentage">{t('publish.assessmentPassLabel')}</label>
            <input
              id="pass-percentage"
              name="passPercentage"
              type="number"
              min={0}
              max={100}
              defaultValue={70}
            />
          </div>
          <div>
            <label htmlFor="time-limit">
              {t('publish.assessmentTimeLabel')}{' '}
              <span className="hint">({t('form.optional')})</span>
            </label>
            <input id="time-limit" name="timeLimitMinutes" type="number" min={1} max={600} />
          </div>
        </div>

        <button type="submit" disabled={pending}>
          {t('publish.assessmentCreate')}
        </button>
      </form>

      {state?.ok === false && state.problem !== undefined ? (
        <Problem problem={state.problem} />
      ) : null}
      {state?.ok === true ? (
        <p className="panel okpanel pass" role="status">
          {t('publish.assessmentReady')}
        </p>
      ) : null}
    </>
  );
};
