// AI Document Studio M3, the whole journey in a browser
// (docs/competencies/AI_DOCUMENT_STUDIO_ARCHITECTURE.md §11):
//
//   Add document -> Prepare -> Review and edit -> Download Word and PDF ->
//   Add to Question Generation Repository -> Generate questions -> the
//   question names the prepared document as its immediate source.
//
// It runs ONLY where the local test preparation is available, and it prepares
// with that provider, which is not AI: CP-5 is not recorded, and this suite
// never records it. The uploaded file is a SYNTHETIC procedure written for
// this run; nothing real is uploaded. Generation is pinned to the
// deterministic generator, so nothing leaves the machine.

import { expect, test } from '@playwright/test';
import { actAs, api, IDENTITY, setStudioMode, syntheticSop } from '../support/portal';

interface Status {
  readonly preparation: {
    readonly liveProviderId: string | null;
    readonly testPreparationAvailable: boolean;
    readonly storageConfigured: boolean;
  };
}

test.describe('AI Document Studio journey', () => {
  // The journey are the FULL Studio's (§12): pinned for the run, then put back.
  let previousMode: 'SIMPLE' | 'FULL' = 'SIMPLE';
  test.beforeAll(async ({ playwright }) => {
    const request = await playwright.request.newContext();
    previousMode = await setStudioMode(request, 'FULL');
    await request.dispose();
  });
  test.afterAll(async ({ playwright }) => {
    const request = await playwright.request.newContext();
    await setStudioMode(request, previousMode);
    await request.dispose();
  });

  test('add, prepare, edit, download, add to the repository and generate', async ({
    page,
    request,
  }) => {
    test.setTimeout(300_000);
    const status = await api<Status>(request, '/api/v1/authoring/document-studio/status');
    test.skip(
      !status.preparation.testPreparationAvailable || !status.preparation.storageConfigured,
      'Needs the local test preparation and Studio storage.',
    );
    test.skip(
      status.preparation.liveProviderId !== null,
      'A live provider is ready: this suite must not send a document to it.',
    );

    const stamp = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
    const title = `E2E Studio Procedure ${stamp}`;
    await actAs(page, IDENTITY.administrator);

    // 1. Add document.
    await page.goto('/document-studio');
    await expect(
      page.getByText(
        'AI document preparation is not yet enabled for this environment. Contact your administrator.',
      ),
    ).toBeVisible();
    await page.locator('#ds-upload').setInputFiles({
      name: `${title}.md`,
      mimeType: 'text/markdown',
      buffer: Buffer.from(syntheticSop(stamp), 'utf8'),
    });
    await page.getByRole('button', { name: 'Add document' }).click();
    await page.waitForURL(/\/document-studio\/[0-9a-f-]{36}/, { timeout: 120_000 });
    const studioUrl = page.url();
    await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible();
    await expect(page.getByText('This document has not been prepared yet.')).toBeVisible();

    // 2. Prepare -- with the test preparation, labelled as not AI.
    await page.getByRole('button', { name: 'Prepare for question generation' }).click();
    await expect(page.locator('[data-version-state="DRAFT"]')).toBeVisible({ timeout: 120_000 });
    await expect(page.locator('[data-provider-live="false"]')).toHaveText(
      'Test preparation — not AI',
    );
    await expect(page.getByText(/Prepared with AI/)).toHaveCount(0);
    await expect(page.locator('[data-original-document]')).toContainText('Authority Limits');
    await expect(page.locator('[data-prepared-document]')).toContainText('Authority Limits');

    // 3. Review and edit.
    await page.getByRole('link', { name: 'Edit', exact: true }).click();
    // A full navigation: fill only once the page has hydrated, or React
    // replaces the typed value with the server's.
    await page.waitForLoadState('networkidle');
    const editor = page.getByLabel('Prepared document text');
    const text = await editor.inputValue();
    await editor.fill(`${text}\nThis line was added in review by the browser suite.\n`);
    await expect(editor).toHaveValue(/This line was added in review by the browser suite\./);
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Changes saved.')).toBeVisible({ timeout: 60_000 });
    await page.goto(studioUrl);
    await expect(
      page.locator('[data-change="reworded"]', {
        hasText: 'This line was added in review by the browser suite.',
      }),
    ).toBeVisible();

    // 4. Download Word and PDF, with safe names.
    for (const [label, extension] of [
      ['Download Word', 'docx'],
      ['Download PDF', 'pdf'],
    ] as const) {
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('link', { name: label }).click(),
      ]);
      expect(download.suggestedFilename()).toBe(`${title} - Assessment Prepared.${extension}`);
    }

    // 5. Add to the repository: the confirmation IS the approval.
    await page.getByRole('button', { name: 'Add to Question Generation Repository' }).click();
    const dialog = page.getByRole('dialog');
    await expect(
      dialog.getByText(
        'Add this prepared document as a source for question generation? The original document will remain unchanged and linked to this prepared version.',
      ),
    ).toBeVisible();
    await dialog.getByRole('button', { name: 'Add to repository' }).click();
    // The page re-renders in the version's new state: ready, and in the repository.
    await expect(page.locator('[data-version-state="READY_FOR_QUESTION_GENERATION"]')).toBeVisible({
      timeout: 120_000,
    });
    await expect(page.getByText(/In the Question Generation Repository since/)).toBeVisible();

    // 6. Generate questions now: the source and document arrive preselected.
    await page.getByRole('link', { name: 'Generate questions now' }).click();
    await page.waitForURL(/\/generate\?source=.+&document=.+/);
    const repositoryDocumentId = new URL(page.url()).searchParams.get('document') ?? '';
    const preselected = page.getByRole('checkbox', {
      name: new RegExp(`${stamp}.*Assessment-prepared v1`),
    });
    await expect(preselected).toBeChecked();
    await expect(page.getByText(/Assessment-prepared document ·/).first()).toBeVisible();
    await page.getByRole('button', { name: /check documents/i }).click();
    await expect(page.getByRole('heading', { name: /step 2/i })).toBeVisible({ timeout: 60_000 });
    await page.getByRole('button', { name: /record decision/i }).click();
    await expect(page.getByRole('heading', { name: /step 3/i })).toBeVisible({ timeout: 60_000 });
    await page.locator('select#providerId').selectOption('DETERMINISTIC_LOCAL');
    await page.getByRole('button', { name: /^generate questions$/i }).click();
    await expect(page.getByText(/accepted|rejected|insufficient/i).first()).toBeVisible({
      timeout: 180_000,
    });

    // 7. The question cites the prepared document, with lineage to the original.
    const generated = await api<{ items: { questionId: string }[] }>(
      request,
      `/api/v1/authoring/questions/review?queue=all&documentId=${repositoryDocumentId}`,
    );
    const mine = generated.items[0];
    expect(mine, 'a draft generated from the prepared document').toBeDefined();
    if (mine !== undefined) {
      await page.goto(`/review/${mine.questionId}?tab=source`);
      const lineage = page.locator('[data-prepared-lineage]');
      await expect(lineage).toContainText('Immediate source: Assessment-prepared document');
      await expect(lineage).toContainText(`derived from ${title}.md`);
      await expect(lineage).toContainText('the original remains authoritative');
    }

    // The Studio now shows the version as ready, and lists it.
    await page.goto(studioUrl);
    await expect(
      page.locator('[data-version-state="READY_FOR_QUESTION_GENERATION"]'),
    ).toBeVisible();
    await page.goto('/document-studio?view=documents');
    await expect(page.getByRole('link', { name: title })).toBeVisible();
  });
});
