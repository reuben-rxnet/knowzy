// AI Document Studio, in a browser: the overview and readiness
// (docs/competencies/AI_DOCUMENT_STUDIO_ARCHITECTURE.md §10, §11.1, §11.3).
//
//   1. its own sidebar entry, between Import Questions and AI Quiz Generation;
//   2. the four views, and the availability banner, which follows the real
//      readiness: the brief's sentence while no live provider is approved
//      (even where the local test preparation can run, because that is not
//      AI), and the provider's name once CP-5 is recorded and it is ready;
//   3. recording an approval moves a provider without a client to NOT_BUILT
//      and removing it moves it back. ANTHROPIC is used and the approval is
//      REMOVED before the test ends, so the platform is left as found. This
//      suite NEVER records an approval for OpenAI: that would be a false CP-5;
//   4. a learner is refused, with the reason.

import { expect, test } from '@playwright/test';
import { actAs, api, IDENTITY } from '../support/portal';

const AUTHORING = process.env['E2E_AUTHORING_URL'] ?? 'http://localhost:3000';
const PAGE = `${AUTHORING}/document-studio`;

interface Status {
  readonly state: string;
  readonly preparation: {
    readonly liveProviderId: string | null;
    readonly testPreparationAvailable: boolean;
  };
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

  test('states which preparation is available, in the banner, and shows the four views', async ({
    page,
    request,
  }) => {
    const status = await api<Status>(request, '/api/v1/authoring/document-studio/status');
    await actAs(page, IDENTITY.administrator);
    await page.goto(PAGE);
    await expect(page.getByRole('heading', { name: 'AI Document Studio', level: 1 })).toBeVisible();
    for (const tab of ['Add document', 'My prepared documents', 'History', 'Readiness']) {
      await expect(page.getByRole('link', { name: tab, exact: true })).toBeVisible();
    }
    // The banner follows the REAL readiness, either way. With CP-5 recorded
    // and OpenAI ready it names the provider and says nothing about the test
    // preparation, which is then never used; without it, the brief's sentence.
    const banner = page.locator('[data-preparation]');
    if (status.preparation.liveProviderId === null) {
      await expect(banner).toHaveAttribute(
        'data-preparation',
        status.preparation.testPreparationAvailable ? 'TEST_ONLY' : 'NOT_ENABLED',
      );
      await expect(
        page.getByText(
          'AI document preparation is not yet enabled for this environment. Contact your administrator.',
        ),
      ).toBeVisible();
      if (status.preparation.testPreparationAvailable) {
        await expect(page.getByText(/test preparation that is not AI/)).toBeVisible();
      }
    } else {
      await expect(banner).toHaveAttribute('data-preparation', 'LIVE');
      await expect(
        page.getByText(
          `AI document preparation is available, using ${status.preparation.liveProviderId}.`,
        ),
      ).toBeVisible();
      await expect(page.getByText(/not yet enabled for this environment/)).toHaveCount(0);
    }
    await page.goto(`${PAGE}?view=readiness`);
    await expect(page.locator(`[data-studio-state="${status.state}"]`)).toBeVisible();
    for (const verb of [/transform/i, /rewrite/i]) {
      await expect(page.getByRole('button', { name: verb })).toHaveCount(0);
    }
  });

  test('recording an approval moves a provider with no client to NOT_BUILT, and removing it moves it back', async ({
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
    await page.goto(`${PAGE}?view=readiness`);
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
    await expect(page.getByRole('button', { name: 'Add document' })).toHaveCount(0);
  });
});
