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

/**
 * OpenAI's settings as the settings route accepts them, from the row the
 * administration read returns. The credential REFERENCE is on the row (it
 * names a secret and is not one), so a configured provider can be put back
 * exactly -- the key itself is never involved.
 */
const settingsOf = (row: Record<string, unknown>): Record<string, unknown> => {
  const out: Record<string, unknown> = { enabled: row['enabled'] === true };
  const copy = (from: string, to = from) => {
    const value = row[from];
    if (value !== null && value !== undefined) out[to] = value;
  };
  copy('displayName');
  copy('baseUrl');
  copy('modelId');
  copy('credentialReference', 'apiKeyRef');
  copy('temperature');
  copy('maxOutputTokens');
  copy('apiStyle');
  if (row['authLocation'] === 'QUERY_PARAMETER') {
    out['authLocation'] = 'QUERY_PARAMETER';
    copy('authQueryParameterName');
  } else {
    copy('authHeaderName');
  }
  const headers = row['extraHeaders'] as Record<string, string> | undefined;
  if (headers !== undefined && Object.keys(headers).length > 0) out['extraHeaders'] = headers;
  return out;
};

test.describe('administration: AI providers', () => {
  // THE SHIPPED STATE IS ESTABLISHED, NOT ASSUMED (GATEWAY-M1, 2026-09-28).
  // These assertions describe OpenAI with nothing configured. On a machine
  // where somebody has configured it for real -- the Codex gateway, since
  // 2026-09-28 -- the suite would otherwise fail, and worse, its Test
  // connection click would make a real call. So OpenAI's settings are saved,
  // cleared for the suite, and restored exactly afterwards.
  let savedOpenAI: Record<string, unknown> | null = null;

  test.beforeAll(async ({ request }) => {
    const admin = await api<{ providers: readonly Record<string, unknown>[] }>(
      request,
      '/api/v1/authoring/administration/providers',
    );
    const row = admin.providers.find((entry) => entry['providerId'] === 'OPENAI');
    const configured =
      row !== undefined &&
      (row['baseUrl'] !== null || row['modelId'] !== null || row['credentialConfigured'] === true);
    if (configured) {
      savedOpenAI = settingsOf(row);
      // An empty object REMOVES the entry: the provider back to its declared,
      // unconfigured defaults.
      await api(request, '/api/v1/authoring/administration/providers/OPENAI/settings', {
        method: 'PUT',
        body: {},
      });
    }
  });

  test.afterAll(async ({ request }) => {
    if (savedOpenAI === null) return;
    await api(request, '/api/v1/authoring/administration/providers/OPENAI/settings', {
      method: 'PUT',
      body: savedOpenAI,
    });
  });

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
    // OPENAI-CODEX-01: a generation client exists. Whether it may RUN is the
    // gate's business -- unapproved, it stays BLOCKED_BY_APPROVAL.
    expect(openai?.capabilities['supportsGeneration']).toBe(true);

    await actAs(page, IDENTITY.administrator);
    await page.goto(PAGE);
    const row = page.getByRole('row', { name: /^\s*OPENAI/ }).first();
    await expect(row.locator('[data-readiness="BLOCKED_BY_CONFIGURATION"]')).toBeVisible();
    // UX-M2: the capabilities sit behind a disclosure.
    await row.getByText('Declared capabilities').click();
    await expect(row.getByText('Generation: yes')).toBeVisible();
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

    // ANTHROPIC, not OPENAI: this asserts the RULE (an approval needs a
    // reference), and OpenAI may carry a real, recorded approval on a machine
    // that has one -- a test must not withdraw and re-record a real approval
    // to make its own assertion, which would write test noise into that
    // approval's audit history. Nobody approves Anthropic in this build.
    const row = page.getByRole('row', { name: /^\s*ANTHROPIC/ }).first();

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
    // ANTHROPIC, not OPENAI: OpenAI may be the ACTIVE provider on a machine
    // that has approved and enabled it, and the active row has no Make active
    // button at all. Nothing can make Anthropic runnable in this build.
    const makeActive = page
      .getByRole('row', { name: /^\s*ANTHROPIC/ })
      .first()
      .getByRole('button', { name: /make active/i });
    await expect(makeActive).toBeDisabled();
    await expect(makeActive).toHaveAccessibleName(/only an available provider/i);
  });

  // Since the Authoring Role Simplification the only identity without
  // authoring permissions is the Learner, who has no authoring portal access
  // at all: the page is refused, with the reason, and offers no control.
  test('a learner is refused the screen and offered no control', async ({ page }) => {
    await actAs(page, IDENTITY.learner);
    await page.goto(PAGE);
    await expect(page.getByRole('heading', { name: 'AI Providers' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^configure$/i })).toHaveCount(0);
    await expect(page.getByText(/PORTAL_ACCESS_DENIED/).first()).toBeVisible();
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

    // The Learner: since the Authoring Role Simplification the menu offers the
    // Authoring Administrator and the Learner only.
    await page
      .locator('header')
      .getByRole('button', { name: /^Learner/ })
      .first()
      .click();
    // The SHELL's acting-as label is server state, and it is the only proof
    // that the switch reached the server.
    await expect(
      page
        .locator('header')
        .getByText(/^Learner$/)
        .first(),
    ).toBeVisible({
      timeout: 30_000,
    });
    // ...and the retired identities are not offered at all.
    await actAs(page, IDENTITY.administrator);
    await page.goto(`${AUTHORING}/publish`);
    await page.locator('header button[aria-haspopup="menu"]').click();
    for (const retired of [/^Publisher/, /^Approver/, /^Author( |$)/, /second approver/]) {
      await expect(page.locator('header').getByRole('button', { name: retired })).toHaveCount(0);
    }
  });
});
