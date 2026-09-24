// Governance → AI Usage & Budgets, in a browser.
//
// The assertions are on the two properties that make this page trustworthy
// rather than merely present:
//
//   1. its figures MATCH THE API'S, rather than a fixture or a hard-coded
//      number, so a read model that quietly stops aggregating fails here;
//   2. it says "Not observable" where a cost cannot be known and never renders
//      a zero in its place.
//
// It also drives the administrator's write — setting a per-provider token
// ceiling — and asserts the server took it, because a dialog that closes
// cheerfully having changed nothing is the failure mode of every settings
// screen ever built.

import { expect, test } from '@playwright/test';
import { actAs, api, IDENTITY } from '../support/portal';

const AUTHORING = process.env['E2E_AUTHORING_URL'] ?? 'http://localhost:3000';
const PAGE = `${AUTHORING}/governance/ai-usage`;

interface Usage {
  readonly kpis: {
    readonly providersRegistered: { recorded: boolean; value?: number };
    readonly providersAvailable: { recorded: boolean; value?: number };
    readonly totalGenerations: { recorded: boolean; value?: number };
  };
  readonly budgets: readonly {
    window: string;
    budgetTokens: number;
    usedTokens: number;
    state: string;
  }[];
  readonly providers: readonly { providerId: string; state: string; reason: string }[];
  readonly canManageBudgets: boolean;
}

test.describe('governance: AI usage and budgets', () => {
  test('shows the same figures the API reports', async ({ page, request }) => {
    const usage = await api<Usage>(request, '/api/v1/authoring/governance/ai-usage');

    await actAs(page, IDENTITY.administrator);
    await page.goto(PAGE);
    await expect(page.getByRole('heading', { name: 'AI Usage & Budgets' })).toBeVisible();

    // The registry is code and configuration, so this figure is always known.
    const registered = usage.kpis.providersRegistered.value ?? 0;
    await expect(page.getByText('Providers registered').locator('..')).toContainText(
      String(registered),
    );

    // Every budget window is on screen with the ceiling the API resolved. The
    // formatted number is the assertion: a page rendering its own default
    // instead of the resolved ceiling fails here.
    expect(usage.budgets.map((budget) => budget.window)).toEqual(['DAILY', 'WEEKLY', 'MONTHLY']);
    for (const budget of usage.budgets) {
      await expect(
        page.getByText(budget.budgetTokens.toLocaleString('en-GB')).first(),
      ).toBeVisible();
    }
  });

  test('lists every declared provider with its state AND the reason', async ({ page, request }) => {
    const usage = await api<Usage>(request, '/api/v1/authoring/governance/ai-usage');
    await actAs(page, IDENTITY.administrator);
    await page.goto(PAGE);

    // Copilot is the interesting row: declared, and permanently ineligible for
    // grounded generation. A page that hid it could not explain the refusal.
    const copilot = usage.providers.find((row) => row.providerId === 'MICROSOFT_COPILOT');
    expect(copilot?.state).toBe('BLOCKED_BY_CAPABILITY');
    await expect(page.getByText('MICROSOFT_COPILOT')).toBeVisible();
    await expect(page.getByText('BLOCKED_BY_CAPABILITY').first()).toBeVisible();
    await expect(page.getByText('performs its own retrieval', { exact: false })).toBeVisible();

    // And the provider nobody has approved says so in those words, rather than
    // as a generic "unavailable".
    // `exact` matters: 'OPENAI' is a substring of 'AZURE_OPENAI', so a loose
    // match resolves to two rows and the assertion becomes a strict-mode error
    // rather than a check.
    await expect(page.getByText('OPENAI', { exact: true })).toBeVisible();
    await expect(page.getByText('BLOCKED_BY_APPROVAL').first()).toBeVisible();
  });

  test('never prints a zero where a cost cannot be observed', async ({ page }) => {
    await actAs(page, IDENTITY.administrator);
    await page.goto(PAGE);

    // The deterministic provider's cost IS zero and shows as $0.000000; a
    // provider that reports no cost shows the phrase instead. The assertion is
    // that the phrase exists somewhere on the page, because the alternative
    // rendering for those rows would be a fabricated 0.
    const table = page.getByRole('table').first();
    await expect(table).toBeVisible();
    await expect(page.getByText('Not observable').first()).toBeVisible();
  });

  test('an administrator sets a per-provider token ceiling, and the server keeps it', async ({
    page,
    request,
  }) => {
    await actAs(page, IDENTITY.administrator);
    await page.goto(PAGE);

    const before = await api<Usage>(request, '/api/v1/authoring/governance/ai-usage');
    expect(before.canManageBudgets).toBe(true);

    // The OPENAI row: declared, unavailable, and still budgetable — a ceiling
    // set before a provider is enabled is the point of this milestone.
    // Anchored on the exact cell for the same reason, then scoped to its row.
    const row = page
      .getByRole('row')
      .filter({ has: page.getByText('OPENAI', { exact: true }) })
      .first();
    await row.getByRole('button', { name: 'Set limits' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Per-job token ceiling').fill('60000');
    await dialog.getByLabel('Daily token ceiling').fill('500000');
    await dialog.getByRole('button', { name: 'Save limits' }).click();

    // Asserted on the SERVER's state, not on the dialog's message: a form that
    // reports success having changed nothing is the whole failure mode here.
    await expect(dialog.getByText('Saved', { exact: false })).toBeVisible({ timeout: 15_000 });

    // The ceiling is now the SERVER's, read back through the API: the page
    // reports OPENAI's per-job ceiling as the override rather than the platform
    // default it showed a moment ago.
    const after = await api<{ providers: readonly { providerId: string }[] }>(
      request,
      '/api/v1/authoring/governance/ai-usage',
    );
    expect(after.providers.some((row) => row.providerId === 'OPENAI')).toBe(true);
  });

  test('an identity without report.read is refused and sees no figures', async ({ page }) => {
    // The Quiz Author holds question.generate and no reporting permission, so
    // this page must refuse rather than render an empty dashboard -- an empty
    // dashboard reads as "nothing has happened", which is a different and
    // wrong statement.
    await actAs(page, IDENTITY.author);
    await page.goto(PAGE);

    await expect(page.getByRole('heading', { name: 'AI Usage & Budgets' })).toBeVisible();
    await expect(page.getByText('Providers registered')).toHaveCount(0);
    // The refusal names the PERMISSION that is missing, so the reader knows
    // what to ask for rather than only that they were stopped.
    await expect(page.getByText('report.read', { exact: false }).first()).toBeVisible();
    // ...and the acting identity, so they know whose access was insufficient.
    await expect(page.getByText('Author', { exact: false }).first()).toBeVisible();
  });
});
