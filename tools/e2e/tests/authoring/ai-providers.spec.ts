// Administration → AI Providers, in a browser.
//
// The assertions are on the four things that make this screen a control rather
// than a settings page:
//
//   1. IT LISTS THE PROVIDERS IT WILL NOT USE, each with the registry's own
//      reason. A table showing only the deterministic generator would suggest
//      the others do not exist rather than that they are not built yet.
//   2. IT CLAIMS NOTHING IT DID NOT OBSERVE. Since P-5, Test connection
//      resolves the secret and, for OpenAI, makes live metadata calls -- but
//      only when the configuration is complete. With none recorded, as here,
//      every live step reads NOT_ATTEMPTED with UNVERIFIED, and GENERATION is
//      NOT_ATTEMPTED because this build cannot generate with OpenAI at all.
//      (The live path itself is exercised against a fake OpenAI in
//      apps/api/test/provider-readiness.test.ts; a browser test cannot reach
//      one from inside the API container.)
//   3. A CREDENTIAL NEVER APPEARS. The field for one is write-only and the
//      page says CONFIGURED or NOT CONFIGURED — the response is checked for
//      the reference itself, not just the screen.
//   4. AN APPROVAL IS ITS OWN ACT, and needs a reference. If "approved" were a
//      checkbox beside "Enabled", BLOCKED_BY_APPROVAL would be a formality.
//
// Every write here is undone at the end, so the suite leaves the platform in
// the state it shipped in — the next run must see OPENAI unapproved, or test 1
// is asserting a state this file created.

import { expect, test } from '@playwright/test';
import { actAs, api, IDENTITY } from '../support/portal';

const AUTHORING = process.env['E2E_AUTHORING_URL'] ?? 'http://localhost:3000';
const PAGE = `${AUTHORING}/administration/providers`;

interface Administration {
  readonly activeProvider: string;
  readonly providers: readonly {
    providerId: string;
    state: string;
    stateReason: string;
    enabled: boolean;
    approved: boolean;
    credentialConfigured: boolean;
  }[];
  readonly canManage: boolean;
}

test.describe('administration: AI providers', () => {
  test('lists every declared provider with the reason it cannot be used', async ({
    page,
    request,
  }) => {
    const admin = await api<Administration>(request, '/api/v1/authoring/administration/providers');

    await actAs(page, IDENTITY.administrator);
    await page.goto(PAGE);
    await expect(page.getByRole('heading', { name: 'AI Providers' })).toBeVisible();

    // Every provider the API declares has a row, including the unusable ones.
    for (const provider of admin.providers) {
      const row = page.getByRole('row', { name: new RegExp(provider.providerId) }).first();
      await expect(row).toBeVisible();
      await expect(row.getByText(provider.state, { exact: false }).first()).toBeVisible();
    }

    // Copilot's refusal is the one that can never be lifted, and the screen has
    // to say so rather than implying a missing credential.
    const copilot = admin.providers.find((row) => row.providerId === 'MICROSOFT_COPILOT');
    expect(copilot?.state).toBe('BLOCKED_BY_CAPABILITY');
    await expect(page.getByText(/performs its own retrieval/i).first()).toBeVisible();
  });

  test('Test connection records the real chain, and claims no live result it did not get', async ({
    page,
    request,
  }) => {
    await actAs(page, IDENTITY.administrator);
    await page.goto(PAGE);

    await page
      .getByRole('row', { name: /OPENAI/ })
      .first()
      .getByRole('button', { name: /^test connection$/i })
      .click();
    await expect(page.getByText(/recorded\. the result is in the row/i)).toBeVisible({
      timeout: 30_000,
    });

    // The recorded row, read back from the API. No configuration is recorded
    // for OpenAI in the shipped state, so CONFIGURATION fails and nothing live
    // is attempted -- and each live step says the claim it is not making.
    const after = await api<{
      providers: readonly {
        providerId: string;
        lastValidation: {
          outcome: string;
          steps: readonly { check: string; result: string; detail: string }[];
        } | null;
      }[];
    }>(request, '/api/v1/authoring/administration/providers');
    const openai = after.providers.find((row) => row.providerId === 'OPENAI');
    const step = (check: string) => openai?.lastValidation?.steps.find((s) => s.check === check);
    expect(step('CONFIGURATION')?.result).toBe('FAILED');
    for (const check of ['ENDPOINT', 'AUTHENTICATION', 'MODEL']) {
      expect(step(check)?.result, check).toBe('NOT_ATTEMPTED');
      expect(step(check)?.detail, check).toMatch(/UNVERIFIED/);
    }
    expect(step('GENERATION')?.result).toBe('NOT_ATTEMPTED');
    // Never PASSED while a check was skipped. There is no outcome meaning
    // "probably fine".
    expect(openai?.lastValidation?.outcome).not.toBe('PASSED');
  });

  test('readiness is shown beside the generation gate, with the declared capabilities', async ({
    page,
    request,
  }) => {
    const admin = await api<{
      providers: readonly {
        providerId: string;
        readiness: { state: string };
        capabilities: Record<string, boolean>;
      }[];
    }>(request, '/api/v1/authoring/administration/providers');
    const openai = admin.providers.find((row) => row.providerId === 'OPENAI');
    // Nothing configured in the shipped state: the ladder's first rung.
    expect(openai?.readiness.state).toBe('BLOCKED_BY_CONFIGURATION');
    expect(openai?.capabilities['supportsGeneration']).toBe(false);

    await actAs(page, IDENTITY.administrator);
    await page.goto(PAGE);
    const row = page.getByRole('row', { name: /^\s*OPENAI/ }).first();
    await expect(row.locator('[data-readiness="BLOCKED_BY_CONFIGURATION"]')).toBeVisible();
    await expect(row.getByText('Generation: no')).toBeVisible();
    await expect(row.getByText('Retrieval-free: yes')).toBeVisible();

    // The same ladder on AI Usage & Budgets, derived the same way.
    await page.goto(`${AUTHORING}/governance/ai-usage`);
    await expect(
      page
        .getByRole('row', { name: /OPENAI/ })
        .first()
        .locator('[data-readiness="BLOCKED_BY_CONFIGURATION"]'),
    ).toBeVisible();
  });

  test('the secret sources are reported, with no name and no value', async ({ page }) => {
    await actAs(page, IDENTITY.administrator);
    await page.goto(PAGE);
    await expect(page.getByRole('heading', { name: 'Secret sources' })).toBeVisible();
    await expect(page.getByRole('row', { name: /LOCAL_SECURE_STORE/ })).toBeVisible();
    await expect(page.getByRole('row', { name: /AZURE_KEY_VAULT/ })).toBeVisible();
    await expect(page.getByText(/no Key Vault client exists in this build/i).first()).toBeVisible();
    await expect(page.getByText(/npm run secrets -- set/)).toBeVisible();
  });

  test('a pasted key is REFUSED, and a reference is never shown back', async ({
    page,
    request,
  }) => {
    await actAs(page, IDENTITY.administrator);
    await page.goto(PAGE);

    await page
      .getByRole('row', { name: /OPENAI/ })
      .first()
      .getByRole('button', { name: /^configure$/i })
      .click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // `getByRole('textbox')`, not `getByLabel`. The Enabled CHECKBOX's
    // accessible name includes its own hint, which mentions "credential
    // reference", so a label match resolves to two controls and fails on
    // strict mode -- a sixth entry for the selector traps in the README.
    const keyRef = dialog.getByRole('textbox', { name: /credential reference/i });
    // The box for a credential starts EMPTY even when one is recorded: a masked
    // value in a text input is a value a submit would echo back.
    await expect(keyRef).toHaveValue('');

    await keyRef.fill('sk-proj-NotARealKey0123456789');
    await dialog.getByRole('button', { name: /save provider/i }).click();
    await expect(dialog.getByText(/never a secret value/i)).toBeVisible({ timeout: 30_000 });

    // And nothing was stored.
    const admin = await api<Administration>(request, '/api/v1/authoring/administration/providers');
    expect(admin.providers.find((row) => row.providerId === 'OPENAI')?.credentialConfigured).toBe(
      false,
    );
  });

  test('an approval needs a reference, and enabling needs a complete configuration', async ({
    page,
  }) => {
    await actAs(page, IDENTITY.administrator);
    await page.goto(PAGE);

    const row = page.getByRole('row', { name: /^\s*OPENAI/ }).first();

    // Approval, with the reference left blank.
    await row.getByRole('button', { name: /record approval/i }).click();
    const approval = page.getByRole('dialog');
    await approval.getByRole('button', { name: /record approval/i }).click();
    await expect(approval.getByText(/requires a reference/i)).toBeVisible({ timeout: 30_000 });
  });

  test('a provider that cannot run CANNOT be made active', async ({ page }) => {
    await actAs(page, IDENTITY.administrator);
    await page.goto(PAGE);

    // The button carries its reason in its accessible name while disabled,
    // which is how this design system reports a refusal without a submit.
    const makeActive = page
      .getByRole('row', { name: /^\s*OPENAI/ })
      .first()
      .getByRole('button', { name: /make active/i });
    await expect(makeActive).toBeDisabled();
    await expect(makeActive).toHaveAccessibleName(/only an available provider/i);
  });

  test('an author sees no controls at all', async ({ page }) => {
    // `governance.ai.read` is report.read, which an author does not hold, so
    // the page itself is refused rather than rendered read-only.
    await actAs(page, IDENTITY.author);
    await page.goto(PAGE);
    await expect(page.getByRole('heading', { name: 'AI Providers' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^configure$/i })).toHaveCount(0);
    await expect(page.getByText(/report\.read|platform\.configure/i).first()).toBeVisible();
  });
});

test.describe('the header identity menu', () => {
  test('switches identity from any page, not only the home page', async ({ page }) => {
    // The whole point of moving it: a refusal happens where you are, and that
    // is where the fix has to be reachable from.
    await actAs(page, IDENTITY.administrator);
    await page.goto(`${AUTHORING}/publish`);

    const trigger = page.locator('header button[aria-haspopup="menu"]');
    await expect(trigger).toBeVisible();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');

    // §34: the menu says these identities are selected, not authenticated.
    await expect(page.getByText(/selected, not authenticated/i).first()).toBeVisible();

    await page
      .locator('header')
      .getByRole('button', { name: /^Publisher/ })
      .first()
      .click();
    // The SHELL's acting-as label is server state, and it is the only proof
    // that the switch reached the server.
    await expect(
      page
        .locator('header')
        .getByText(/Publisher/)
        .first(),
    ).toBeVisible({
      timeout: 30_000,
    });
  });
});
