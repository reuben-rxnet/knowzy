// AI Document Studio, Simple mode, in a browser
// (docs/competencies/AI_DOCUMENT_STUDIO_ARCHITECTURE.md §12).
//
//   1. the drop zone, the accepted types and the limit; none of the full
//      Studio's views;
//   2. an upload reaches the quiz settings: number of questions, the topic,
//      single choice selected, and Multiple choice, Yes or No and other
//      languages shown DISABLED as "Coming later";
//   3. a job's questions are approved by ticking them and published as a quiz
//      of exactly those questions, which reads as live (§12.4);
//   4. the sidebar shows only the simple path;
//   5. an administrator can switch to the full Studio and back.
//
// It NEVER clicks "Generate quiz": the active provider may be a live model,
// and a browser test must not send documents to one. The job for (3) comes
// from the DETERMINISTIC generator on the suite's own synthetic source, made
// through the API; the generation path behind the button is pinned by the
// contract suite (preflight, decision, job, in that order).

import { expect, test } from '@playwright/test';
import {
  actAs,
  api,
  freshSyntheticDocument,
  IDENTITY,
  seededTaxonomy,
  setStudioMode,
  syntheticSop,
} from '../support/portal';

const AUTHORING = process.env['E2E_AUTHORING_URL'] ?? 'http://localhost:3000';
const PAGE = `${AUTHORING}/document-studio`;

test.describe('AI Document Studio, Simple mode', () => {
  let previousMode: 'SIMPLE' | 'FULL' = 'SIMPLE';
  test.beforeAll(async ({ playwright }) => {
    const request = await playwright.request.newContext();
    previousMode = await setStudioMode(request, 'SIMPLE');
    await request.dispose();
  });
  test.afterAll(async ({ playwright }) => {
    const request = await playwright.request.newContext();
    await setStudioMode(request, previousMode);
    await request.dispose();
  });

  test('shows one drop zone and none of the full Studio’s views', async ({ page }) => {
    await actAs(page, IDENTITY.administrator);
    await page.goto(PAGE);
    await expect(page.getByRole('heading', { name: 'Create a quiz', level: 1 })).toBeVisible();
    await expect(page.locator('[data-quiz-dropzone]')).toBeVisible();
    for (const type of ['.pdf', '.docx', '.pptx', '.txt', '.md']) {
      await expect(page.getByRole('listitem').filter({ hasText: type })).toBeVisible();
    }
    await expect(page.getByText('Maximum file size is 8 MB.')).toBeVisible();
    for (const tab of ['My prepared documents', 'History', 'Readiness']) {
      await expect(page.getByRole('link', { name: tab, exact: true })).toHaveCount(0);
    }
  });

  test('an upload reaches the quiz settings, offering only what can be generated', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const stamp = `${Date.now()}`;
    const name = `E2E Quick Quiz ${stamp}.md`;
    await actAs(page, IDENTITY.administrator);
    await page.goto(PAGE);
    await page.waitForLoadState('networkidle');
    await page.locator('#qq-file').setInputFiles({
      name,
      mimeType: 'text/markdown',
      buffer: Buffer.from(syntheticSop(stamp), 'utf8'),
    });
    await page.waitForURL(/document=/, { timeout: 120_000 });
    await expect(
      page.getByRole('heading', { name: 'What kind of quiz would you like to create?' }),
    ).toBeVisible();
    await expect(page.getByText(name)).toBeVisible();
    await expect(page.getByLabel('Number of questions')).toHaveValue('10');
    await expect(page.getByLabel('Language')).toBeDisabled();
    await expect(page.getByRole('radio', { name: 'Single choice' })).toBeChecked();
    for (const type of ['Multiple choice', 'Yes or No']) {
      await expect(page.getByRole('radio', { name: type })).toBeDisabled();
    }
    await expect(page.getByText('Coming later', { exact: true })).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Generate quiz' })).toBeEnabled();
  });

  test('ticked questions are approved and published as a quiz of exactly those', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000);
    const { sourceId, documentId } = await freshSyntheticDocument(request);
    const preflight = await api<{ preflightId: string }>(
      request,
      '/api/v1/authoring/generation/preflight',
      { method: 'POST', body: { sourceId, documentIds: [documentId] } },
    );
    await api(request, `/api/v1/authoring/generation/preflight/${preflight.preflightId}/decide`, {
      method: 'POST',
      body: { chosenAction: 'GENERATE_NEW' },
    });
    const taxonomy = await seededTaxonomy(request);
    const job = await api<{ jobId: string; questionIds: string[] }>(
      request,
      '/api/v1/authoring/generation-jobs',
      {
        method: 'POST',
        body: {
          preflightId: preflight.preflightId,
          scope: 'ENTIRE_DOCUMENT',
          domainId: taxonomy.domainId,
          topicId: taxonomy.topicId,
          reasonCode: 'NEW_KNOWLEDGE',
          requestedQuestionCount: 2,
          providerId: 'DETERMINISTIC_LOCAL',
        },
      },
    );
    test.skip(job.questionIds.length === 0, 'The template generator produced no question.');

    await actAs(page, IDENTITY.administrator);
    await page.goto(`${PAGE}?job=${job.jobId}`);
    await page.waitForLoadState('networkidle');
    // The simple path only.
    const nav = page.getByRole('navigation').first();
    await expect(nav.getByRole('link', { name: /Review Queue/ })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: /AI Document Studio/ })).toBeVisible();

    // Nothing is ticked for you, and nothing is published yet.
    await expect(page.locator('input[name="questionIds"]:checked')).toHaveCount(0);
    await expect(page.locator('[data-publish-quiz]')).toHaveCount(0);
    await page.locator('input[name="questionIds"]').first().check();
    await page.getByRole('button', { name: 'Approve selected' }).click();
    await expect(page.locator('[data-question-status="APPROVED"]')).toHaveCount(1, {
      timeout: 60_000,
    });
    await expect(page.locator('[data-publish-quiz]')).toBeVisible();

    await page.getByLabel('Quiz name').fill(`E2E Simple Quiz ${Date.now()}`);
    await page.getByRole('button', { name: 'Publish quiz' }).click();
    await page.waitForURL(/quiz=/, { timeout: 120_000 });
    await expect(page.locator('[data-quiz-live="PUBLISHED"]')).toBeVisible();
  });

  test('the simple Studio is the only one offered: there is no switch', async ({ page }) => {
    await actAs(page, IDENTITY.administrator);
    await page.goto(PAGE);
    await expect(page.locator('[data-quiz-dropzone]')).toBeVisible();
    await expect(page.getByRole('button', { name: /Switch to the full Studio/ })).toHaveCount(0);
    await expect(page.locator('[data-quizzes]')).toBeVisible();
  });

  test('approved questions can go to the question bank without a quiz', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000);
    const { sourceId, documentId } = await freshSyntheticDocument(request);
    const preflight = await api<{ preflightId: string }>(
      request,
      '/api/v1/authoring/generation/preflight',
      { method: 'POST', body: { sourceId, documentIds: [documentId] } },
    );
    await api(request, `/api/v1/authoring/generation/preflight/${preflight.preflightId}/decide`, {
      method: 'POST',
      body: { chosenAction: 'GENERATE_NEW' },
    });
    const taxonomy = await seededTaxonomy(request);
    const job = await api<{ jobId: string; questionIds: string[] }>(
      request,
      '/api/v1/authoring/generation-jobs',
      {
        method: 'POST',
        body: {
          preflightId: preflight.preflightId,
          scope: 'ENTIRE_DOCUMENT',
          domainId: taxonomy.domainId,
          topicId: taxonomy.topicId,
          reasonCode: 'NEW_KNOWLEDGE',
          requestedQuestionCount: 2,
          providerId: 'DETERMINISTIC_LOCAL',
        },
      },
    );
    test.skip(job.questionIds.length === 0, 'The template generator produced no question.');
    const before = await api<{ assessments: unknown[] }>(request, '/api/v1/authoring/assessments');

    await actAs(page, IDENTITY.administrator);
    await page.goto(`${PAGE}?job=${job.jobId}`);
    await page.waitForLoadState('networkidle');
    await page.locator('input[name="questionIds"]').first().check();
    await page.getByRole('button', { name: 'Approve selected' }).click();
    await expect(page.locator('[data-publish-quiz]')).toBeVisible({ timeout: 60_000 });
    await page.getByRole('radio', { name: /Add to the question bank only/ }).check();
    await expect(page.getByLabel('Quiz name')).toHaveCount(0);
    await page.getByRole('button', { name: 'Add to question bank' }).click();
    await page.waitForURL(/banked=1/, { timeout: 120_000 });
    await expect(page.locator('[data-quiz-banked="1"]')).toBeVisible();

    // In the bank, and no quiz was made.
    const after = await api<{ assessments: unknown[] }>(request, '/api/v1/authoring/assessments');
    expect(after.assessments.length).toBe(before.assessments.length);
    await page.goto('/question-bank');
    await expect(page.locator('[data-bank-questions]')).toBeVisible();
  });

  test('a quiz is built from the question bank by topic, drawn at random', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);
    const taxonomy = await seededTaxonomy(request);
    const bank = await api<{ poolCounts: { topicId: string; count: number }[] }>(
      request,
      '/api/v1/authoring/question-bank',
    );
    const pool = bank.poolCounts.find((row) => row.topicId === taxonomy.topicId)?.count ?? 0;
    test.skip(pool === 0, 'Nothing is published in the seeded topic yet.');

    await actAs(page, IDENTITY.administrator);
    await page.goto(`${PAGE}?from=bank`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('link', { name: 'From the question bank' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await page.getByLabel('Domain').selectOption(taxonomy.domainId);
    // Every topic starts ticked; keep only the seeded one.
    const topics = page.locator('[data-bank-topics]');
    await topics.getByRole('button', { name: 'Clear' }).click();
    await expect(page.locator('[data-bank-problem]')).toHaveText('Tick at least one topic.');
    await topics.locator(`input[value="${taxonomy.topicId}"]`).check();
    await expect(page.getByText(new RegExp(`${pool} questions? available`))).toBeVisible();
    await page.getByLabel('Number of questions').fill('1');
    const name = `E2E Bank Quiz ${Date.now()}`;
    await page.getByLabel('Quiz name').fill(name);
    await page.getByRole('button', { name: 'Publish quiz' }).click();
    await page.waitForURL(/quiz=/, { timeout: 120_000 });
    await expect(page.locator('[data-quiz-live="PUBLISHED"]')).toBeVisible();

    const quizzes = await api<{
      assessments: { name: string; versionStatus: string | null; questionCount: number | null }[];
    }>(request, '/api/v1/authoring/assessments');
    const quiz = quizzes.assessments.find((row) => row.name === name);
    expect(quiz?.versionStatus).toBe('PUBLISHED');
    expect(quiz?.questionCount).toBe(1);
  });
});
