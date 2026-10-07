// AI Document Studio overview, in a browser (Slice 2,
// docs/competencies/AI_DOCUMENT_STUDIO_ARCHITECTURE.md §10).
//
//   1. its own sidebar entry, between Import Questions and AI Quiz Generation;
//   2. the shipped state BLOCKED_BY_APPROVAL, read from the API, and the
//      "not yet implemented" banner;
//   3. NO control that runs, transforms, rewrites or prepares a document;
//   4. recording an approval moves a provider to NOT_BUILT -- never READY --
//      and removing it moves it back. ANTHROPIC is used and the approval is
//      REMOVED before the test ends, so the platform is left as found;
//   5. a learner is refused, with the reason.

import { expect, test } from '@playwright/test';
import { actAs, api, IDENTITY } from '../support/portal';

const AUTHORING = process.env['E2E_AUTHORING_URL'] ?? 'http://localhost:3000';
const PAGE = `${AUTHORING}/document-studio`;

interface Status {
  readonly state: string;
  readonly transformationImplemented: boolean;
  readonly providers: readonly { readonly providerId: string; readonly state: string | null }[];
}

test.describe('AI Document Studio', () => {
  test('is its own sidebar entry, between Import Questions and generation', async ({ page }) => {
    await actAs(page, IDENTITY.administrator);
    await page.goto(PAGE);
    const labels = await page.getByRole('navigation').first().getByRole('link').allInnerTexts();
    const order = labels.map((label) => label.split('\n')[0]?.trim() ?? '');
    const at = (name: string) => order.findIndex((label) => label === name);
    expect(at('Import Questions')).toBeGreaterThan(at('Knowledge Sources'));
    expect(at('AI Document Studio')).toBe(at('Import Questions') + 1);
    expect(at('AI Quiz Generation')).toBe(at('AI Document Studio') + 1);
  });

  test('shows the real state and offers nothing that transforms a document', async ({
    page,
    request,
  }) => {
    const status = await api<Status>(request, '/api/v1/authoring/document-studio/status');
    expect(status.transformationImplemented).toBe(false);
    expect(status.state).not.toBe('READY');

    await actAs(page, IDENTITY.administrator);
    await page.goto(PAGE);
    await expect(page.getByRole('heading', { name: 'AI Document Studio', level: 1 })).toBeVisible();
    await expect(page.getByText('Transformation capability not yet implemented')).toBeVisible();
    await expect(page.locator(`[data-studio-state="${status.state}"]`)).toBeVisible();
    for (const verb of [/^run/i, /transform/i, /rewrite/i, /^prepare/i]) {
      await expect(page.getByRole('button', { name: verb })).toHaveCount(0);
    }
  });

  test('recording an approval moves a provider to NOT_BUILT, and removing it moves it back', async ({
    page,
    request,
  }) => {
    const before = await api<Status>(request, '/api/v1/authoring/document-studio/status');
    const anthropic = before.providers.find((row) => row.providerId === 'ANTHROPIC');
    test.skip(
      anthropic?.state !== 'BLOCKED_BY_APPROVAL',
      'Asserts the shipped state for ANTHROPIC.',
    );

    await actAs(page, IDENTITY.administrator);
    await page.goto(PAGE);
    const row = page.getByRole('row', { name: /^\s*ANTHROPIC/ });
    await row.getByRole('button', { name: 'Record approval' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Approval reference').fill('E2E-CP5-TEST');
    await dialog.getByRole('button', { name: 'Record approval' }).click();
    await expect(row.locator('[data-provider-state="NOT_BUILT"]')).toBeVisible({ timeout: 30_000 });
    await expect(row.getByText(/E2E-CP5-TEST/)).toBeVisible();

    await row.getByRole('button', { name: 'Remove approval' }).click();
    await expect(row.locator('[data-provider-state="BLOCKED_BY_APPROVAL"]')).toBeVisible({
      timeout: 30_000,
    });
    const after = await api<Status>(request, '/api/v1/authoring/document-studio/status');
    expect(after.providers.find((r) => r.providerId === 'ANTHROPIC')?.state).toBe(
      'BLOCKED_BY_APPROVAL',
    );
  });

  test('a learner is refused, with the reason', async ({ page }) => {
    await actAs(page, IDENTITY.learner);
    await page.goto(PAGE);
    await expect(page.getByText(/PORTAL_ACCESS_DENIED/).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Record approval' })).toHaveCount(0);
  });
});
