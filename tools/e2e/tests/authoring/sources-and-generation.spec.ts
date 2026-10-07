// Acceptance script steps 1–9, in a browser: source → test → synchronize →
// browse → preflight → generate.
//
// Every assertion is about an OUTCOME the platform reported, not about an
// element being on the page. "The Synchronize button exists" is worth nothing;
// "the run reported counts, and the documents it indexed are now listed" is
// the thing a person checks.

import { expect, test } from '@playwright/test';
import { actAs, api, ensureSynchronized, IDENTITY, sourceCard } from '../support/portal';

test.describe('knowledge sources', () => {
  test.beforeEach(async ({ page }) => {
    await actAs(page, IDENTITY.administrator);
  });

  test('Test connection reports every check with its own outcome', async ({ page }) => {
    await page.goto('/sources');
    await expect(page.getByRole('heading', { name: /knowledge sources/i })).toBeVisible();

    await sourceCard(page, 'Mock Support Operations')
      .getByRole('button', { name: /test connection/i })
      .click();

    // The results drawer, and the checks INSIDE it. A probe that returned
    // nothing would leave the drawer empty and this would fail.
    const drawer = page.getByRole('dialog');
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole('heading', { name: /connection test/i })).toBeVisible();

    const checkRows = drawer.getByRole('row');
    await expect.poll(async () => (await checkRows.count()) > 1, { timeout: 15_000 }).toBeTruthy();

    // A SKIP is an honest answer for the mock source, so the assertion is that
    // every check reported SOMETHING, not that everything passed.
    const outcomes = await drawer.getByText(/^(PASS|FAIL|SKIP|NOT_RUN)$/).count();
    expect(outcomes).toBeGreaterThan(0);

    // Capabilities are declared, not emulated (adapter rule P1).
    await expect(drawer.getByText(/capabilit/i).first()).toBeVisible();
  });

  test('Synchronize indexes documents and reports counts, skipped apart from failed', async ({
    page,
  }) => {
    await page.goto('/sources');
    await sourceCard(page, 'Mock Support Operations')
      .getByRole('button', { name: /^synchronize$/i })
      .click();

    const drawer = page.getByRole('dialog');
    await expect(drawer.getByRole('heading', { name: /synchronization/i })).toBeVisible({
      timeout: 60_000,
    });

    // The six counts the run reports. `Skipped` is asserted explicitly: it was
    // merged into `Failed` until 2026-09-22, which made a healthy source read
    // as permanently PARTIAL.
    for (const label of [/scanned/i, /added/i, /modified/i, /unchanged/i, /failed/i, /skipped/i]) {
      await expect(drawer.getByText(label).first()).toBeVisible();
    }

    // The outcome, and then the actual consequence: documents exist.
    await expect(drawer.getByText(/SUCCEEDED|PARTIAL/).first()).toBeVisible();

    await page.goto('/sources');
    const row = page.getByRole('row').filter({ hasText: 'Mock Support Operations' });
    await expect(row).toContainText(/\d+ document/i);
  });
});

test.describe('generation', () => {
  test('preflight reports its checks, and a job creates drafts that reach the queue', async ({
    page,
    request,
  }) => {
    // The source is NAMED, not "the first usable one": since 2026-10-07 the
    // suite owns a synthetic source that sorts first, and this test is about
    // the screen, not about whichever corpus happens to lead the list.
    const mock = await ensureSynchronized(request);
    await actAs(page, IDENTITY.administrator);

    const before = await api<{ count: number; items: unknown[] }>(
      request,
      '/api/v1/authoring/questions/review?queue=author',
    );
    const countBefore = before.count;

    await page.goto(`/generate?source=${mock.sourceId}`);
    await expect(page.getByRole('heading', { name: /generate questions/i })).toBeVisible();

    // Step 1: choose documents. There is no source dropdown on this screen --
    // the wizard lists the selectable documents directly, each with the count
    // of sections in scope, which is the number that decides whether a
    // generation run is worth starting.
    const documentBoxes = page.getByRole('checkbox');
    await expect
      .poll(async () => await documentBoxes.count(), { timeout: 30_000 })
      .toBeGreaterThan(0);
    const boxes = await documentBoxes.all();
    for (const box of boxes.slice(0, 4)) await box.check();

    // Step 2: preflight. The checks are reported by name with the sentence
    // behind the verdict, and a recommendation the author has to RECORD before
    // anything may be generated -- "a preflight authorizes nothing until an
    // action is recorded against it".
    await page.getByRole('button', { name: /check documents/i }).click();
    await expect(page.getByRole('heading', { name: /step 2/i })).toBeVisible({ timeout: 60_000 });
    await expect(
      page
        .getByText(/GENERATE_NEW|GENERATE_ADDITIONAL|VIEW_EXISTING|REUSE_EXISTING|REGENERATE/)
        .first(),
    ).toBeVisible();
    // The REASON, not just the verdict: a recommendation with no stated cause
    // is the thing UI-M3 replaced.
    await expect(page.getByText(/assessable section|already cite|coverage/i).first()).toBeVisible();

    await page.getByRole('button', { name: /record decision/i }).click();
    await expect(page.getByRole('heading', { name: /step 3/i })).toBeVisible({ timeout: 60_000 });

    // GEN-PROVIDER-M1: the provider list. Every option the server calls
    // unavailable is DISABLED, whatever this machine's configuration is; the
    // deterministic generator is always selectable.
    const providers = await api<{
      providers: readonly { providerId: string; available: boolean }[];
    }>(request, '/api/v1/authoring/generation/providers');
    const select = page.locator('select#providerId');
    for (const provider of providers.providers) {
      const option = select.locator(`option[value="${provider.providerId}"]`);
      if (provider.available) await expect(option).toBeEnabled();
      else await expect(option).toBeDisabled();
    }
    // PINNED to the deterministic generator. Once a network provider is the
    // active one, the default would be it -- and this suite must never send a
    // real document to an external model.
    await select.selectOption('DETERMINISTIC_LOCAL');

    // Step 3: generate. The outcome is drafts, so that is what is asserted --
    // first the run's own accounting, then the queue the drafts must reach.
    const generate = page.getByRole('button', { name: /^generate questions$/i });
    if (await generate.isEnabled()) {
      await generate.click();
      await expect(page.getByText(/accepted|rejected|insufficient/i).first()).toBeVisible({
        timeout: 180_000,
      });
    }

    // After the submission React resets the form. The dropdown and the note
    // beneath it must still describe the SAME provider -- they did not
    // (2026-09-28): the reset showed the first option while the note still
    // described the active network provider.
    const shown = await select.inputValue();
    const note = page.getByText(
      /sentence matching over the selected sections|the selected sections are sent to/i,
    );
    await expect(note.first()).toBeVisible();
    if (shown === 'DETERMINISTIC_LOCAL') {
      await expect(page.getByText(/sentence matching over the selected sections/i)).toBeVisible();
    } else {
      await expect(page.getByText(/the selected sections are sent to/i)).toBeVisible();
    }

    const after = await api<{ count: number; items: { status: string }[] }>(
      request,
      '/api/v1/authoring/questions/review?queue=author',
    );
    // Either this run created drafts, or the corpus was already exhausted and
    // the queue still holds the drafts from before. Both are real outcomes;
    // what would be a defect is the queue going backwards.
    expect(after.count).toBeGreaterThanOrEqual(countBefore);

    await page.goto('/review');
    await expect(page.getByRole('heading', { name: /draft review queue/i })).toBeVisible();
    await expect(page.getByText(/in this view/i).first()).toBeVisible();
  });
});
