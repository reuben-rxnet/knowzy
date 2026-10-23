'use server';

// AI Document Studio, Simple mode -- the server actions behind upload ->
// quiz settings -> generate (docs/competencies/AI_DOCUMENT_STUDIO_ARCHITECTURE.md §12).
//
// "Generate quiz" is ONE click and still THREE recorded acts, in the order
// workflows.md §4.2 requires: a preflight, the decision recorded against it,
// then the job. Simple mode removes the screens between them, not the
// records. The decision is the preflight's own recommendation, and only a
// recommendation that authorizes generation is followed: when the document
// already has its questions, the person is shown them instead -- duplicate
// prevention is a rule, not a step a simpler screen may skip.

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { api, type ApiProblem } from '../../lib/api';
import type { ActionState } from '../actions';

const failed = (problem: ApiProblem): ActionState => ({ ok: false, problem });
const local = (detail: string): ActionState =>
  failed({ status: 400, code: 'VALIDATION_FAILED', title: 'Check the form', detail });

/** What the settings form needs to say when a quiz is not generated. */
export interface QuizNotGenerated {
  readonly kind: 'EXISTING';
  readonly reason: string;
}

export const quickUploadAction = async (
  _previous: ActionState | null,
  formData: FormData,
): Promise<ActionState> => {
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) return local('Choose a file to upload.');
  const contentBase64 = Buffer.from(await file.arrayBuffer()).toString('base64');
  const result = await api<{ documentId: string; sourceId: string; fileName: string }>(
    '/api/v1/authoring/document-studio/uploads',
    { method: 'POST', body: { fileName: file.name, contentBase64, destination: 'QUIZ' } },
  );
  if (!result.ok) return failed(result.problem);
  // The file name travels as a LABEL only: the page reads the document itself
  // from the API, and the name is never used to find anything.
  redirect(
    `/document-studio?document=${encodeURIComponent(result.data.documentId)}&source=${encodeURIComponent(result.data.sourceId)}&name=${encodeURIComponent(result.data.fileName)}`,
  );
};

/** A recommendation the Simple Studio follows, with the job it implies. */
const JOB_FOR: Readonly<Record<string, { scope: string; reasonCode: string } | undefined>> = {
  GENERATE_NEW: { scope: 'ENTIRE_DOCUMENT', reasonCode: 'NEW_KNOWLEDGE' },
};
const additional = (reason: string): { scope: string; reasonCode: string } =>
  reason.includes('COVERAGE_GAP')
    ? { scope: 'UNCOVERED_SECTIONS_ONLY', reasonCode: 'COVERAGE_GAP' }
    : { scope: 'ENTIRE_DOCUMENT', reasonCode: 'CONTENT_CHANGED' };

export const generateQuizAction = async (
  _previous: ActionState | null,
  formData: FormData,
): Promise<ActionState> => {
  const sourceId = String(formData.get('sourceId') ?? '');
  const documentId = String(formData.get('documentId') ?? '');
  const [domainId = '', topicId = ''] = String(formData.get('topic') ?? '').split('|');
  const count = Number(formData.get('questionCount') ?? 10);
  const providerId = String(formData.get('providerId') ?? 'DETERMINISTIC_LOCAL');
  if (domainId.length === 0 || topicId.length === 0) return local('Choose a topic for the quiz.');
  if (!Number.isInteger(count) || count < 1 || count > 50)
    return local('The number of questions must be between 1 and 50.');

  const preflight = await api<{
    preflightId: string;
    recommendation: string;
    recommendationReason: string;
  }>('/api/v1/authoring/generation/preflight', {
    method: 'POST',
    body: { sourceId, documentIds: [documentId] },
  });
  if (!preflight.ok) return failed(preflight.problem);
  const { preflightId, recommendation, recommendationReason } = preflight.data;
  const job =
    recommendation === 'GENERATE_ADDITIONAL'
      ? additional(recommendationReason)
      : JOB_FOR[recommendation];
  if (job === undefined) {
    // VIEW_EXISTING, or anything that does not authorize generation.
    const outcome: QuizNotGenerated = { kind: 'EXISTING', reason: recommendationReason };
    return { ok: true, data: outcome };
  }

  const decision = await api<unknown>(
    `/api/v1/authoring/generation/preflight/${encodeURIComponent(preflightId)}/decide`,
    { method: 'POST', body: { chosenAction: recommendation } },
  );
  if (!decision.ok) return failed(decision.problem);

  const created = await api<{ jobId: string }>('/api/v1/authoring/generation-jobs', {
    method: 'POST',
    body: {
      preflightId,
      scope: job.scope,
      domainId,
      topicId,
      reasonCode: job.reasonCode,
      requestedQuestionCount: count,
      providerId,
      executionMode: 'PLATFORM_MANAGED',
    },
  });
  if (!created.ok) return failed(created.problem);
  revalidatePath('/review');
  redirect(`/document-studio?job=${encodeURIComponent(created.data.jobId)}`);
};

export const setStudioModeAction = async (
  _previous: ActionState | null,
  formData: FormData,
): Promise<ActionState> => {
  const mode = String(formData.get('mode') ?? '');
  const result = await api<{ mode: string }>('/api/v1/authoring/document-studio/mode', {
    method: 'PUT',
    body: { mode },
  });
  if (!result.ok) return failed(result.problem);
  revalidatePath('/document-studio');
  redirect('/document-studio');
};

// ------------------------------------------- approve, then publish (§12.4)

/** One question the Simple Studio could not approve, and why. */
export interface ApprovalFailure {
  readonly questionId: string;
  readonly problem: ApiProblem;
}

/** The transition that moves a question one step towards APPROVED, by status. */
const NEXT_STEP: Readonly<Record<string, 'claim' | 'submit' | 'approve' | undefined>> = {
  GENERATED: 'claim',
  DRAFT: 'claim',
  AUTHOR_REVIEW: 'submit',
  CHANGES_REQUESTED: 'submit',
  SUBMITTED_FOR_APPROVAL: 'approve',
};

/**
 * "Approve selected": each TICKED question, and only those, is walked through
 * the real transitions -- claim, submit, approve -- each its own audited act
 * with every gate evaluated. A question the gates refuse stops where it is and
 * is reported with the gates' own reasons; the others carry on.
 */
export const approveQuestionsAction = async (
  _previous: ActionState | null,
  formData: FormData,
): Promise<ActionState> => {
  const ids = formData
    .getAll('questionIds')
    .map(String)
    .filter((id) => id.length > 0);
  if (ids.length === 0) return local('Tick at least one question to approve.');

  const failures: ApprovalFailure[] = [];
  for (const questionId of ids) {
    for (let step = 0; step < 4; step += 1) {
      const question = await api<{ status: string }>(
        `/api/v1/authoring/questions/${encodeURIComponent(questionId)}`,
      );
      if (!question.ok) {
        failures.push({ questionId, problem: question.problem });
        break;
      }
      const next = NEXT_STEP[question.data.status];
      if (next === undefined) break; // APPROVED, PUBLISHED, or not approvable here
      const moved = await api<unknown>(
        `/api/v1/authoring/questions/${encodeURIComponent(questionId)}/${next}`,
        { method: 'POST', body: {} },
      );
      if (!moved.ok) {
        failures.push({ questionId, problem: moved.problem });
        break;
      }
    }
  }
  revalidatePath('/document-studio');
  revalidatePath('/review');
  return failures.length === 0
    ? { ok: true, data: { failures } }
    : { ok: false, data: { failures } };
};

/**
 * "Publish quiz": the approved questions go to the Question Bank, then an
 * assessment of EXACTLY those questions (FIXED_SET) is created, submitted,
 * approved and published -- the Publish page's own sequence, each step its own
 * audited transition. A failure stops the sequence and is shown.
 */
export const publishQuizAction = async (
  _previous: ActionState | null,
  formData: FormData,
): Promise<ActionState> => {
  const jobId = String(formData.get('jobId') ?? '');
  // BANK: add the approved questions to the Question Bank and stop there, for
  // a quiz to be built from the bank later. QUIZ (the default): also make a
  // quiz of exactly these questions now.
  const bankOnly = String(formData.get('intent') ?? 'quiz') === 'bank';
  const name = String(formData.get('name') ?? '').trim();
  const pass = Number(formData.get('passPercentage') ?? 70);
  const showAnswers = formData.get('showAnswers') !== null;
  if (!bankOnly && name.length < 3) return local('Give the quiz a name of at least 3 characters.');
  if (!bankOnly && (!Number.isFinite(pass) || pass < 0 || pass > 100))
    return local('The pass mark must be between 0 and 100.');

  const job = await api<{
    domainId: string;
    topicId: string;
    questionIds: readonly string[];
  }>(`/api/v1/authoring/generation-jobs/${encodeURIComponent(jobId)}`);
  if (!job.ok) return failed(job.problem);
  const statuses = await Promise.all(
    job.data.questionIds.map(async (id) => ({
      id,
      read: await api<{ status: string }>(`/api/v1/authoring/questions/${encodeURIComponent(id)}`),
    })),
  );
  const status = (id: string): string => {
    const row = statuses.find((entry) => entry.id === id);
    return row?.read.ok === true ? row.read.data.status : 'UNKNOWN';
  };
  const toPublish = job.data.questionIds.filter((id) => status(id) === 'APPROVED');
  const already = job.data.questionIds.filter((id) => status(id) === 'PUBLISHED');
  if (toPublish.length + already.length === 0) return local('Approve at least one question first.');

  if (toPublish.length > 0) {
    const published = await api<unknown>('/api/v1/authoring/question-bank/publish', {
      method: 'POST',
      body: { questionIds: toPublish },
    });
    if (!published.ok) return failed(published.problem);
  }
  const questionIds = job.data.questionIds.filter(
    (id) => toPublish.includes(id) || already.includes(id),
  );
  if (bankOnly) {
    revalidatePath('/question-bank');
    redirect(`/document-studio?job=${encodeURIComponent(jobId)}&banked=${questionIds.length}`);
  }

  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 100);
  const created = await api<{ assessmentVersionId: string }>('/api/v1/authoring/assessments', {
    method: 'POST',
    body: {
      name,
      slug: `${slug.length >= 3 ? slug : 'quiz'}-${Date.now().toString(36)}`,
      domainId: job.data.domainId,
      topicIds: [job.data.topicId],
      questionCount: questionIds.length,
      selectionStrategy: 'FIXED_SET',
      questionIds,
      passPercentage: pass,
      showAnswersAfterCompletion: showAnswers,
    },
  });
  if (!created.ok) return failed(created.problem);
  const versionId = created.data.assessmentVersionId;
  for (const step of ['submit', 'approve', 'publish'] as const) {
    const result = await api<unknown>(
      `/api/v1/authoring/assessments/${encodeURIComponent(versionId)}/${step}`,
      { method: 'POST' },
    );
    if (!result.ok) return failed(result.problem);
  }
  revalidatePath('/publish');
  redirect(
    `/document-studio?job=${encodeURIComponent(jobId)}&quiz=${encodeURIComponent(versionId)}`,
  );
};
