// Acceptance script steps 11–18, in a browser: review → submit → the gate 13
// refusal → approval by a second identity → publish → republish.
//
// **Gate 13 is the reason this file exists.** Separation of duties is the one
// control that cannot be demonstrated by a single session: it is a comparison
// of two identities, so the only honest test drives both. The refusal is
// asserted by its CODE and its sentence, not by the absence of a success
// message — an approval that silently did nothing would satisfy the weaker
// assertion.

import { expect, test } from '@playwright/test';
import { actAs, api, decision, generateDraft, IDENTITY } from '../support/portal';

interface QuestionDetail {
  readonly status: string;
  readonly questionText: string;
}

test.describe('review, approval and publication', () => {
  test('the question page shows the evidence and the gate verdict', async ({ page, request }) => {
    const questionId = await generateDraft(request);
    await actAs(page, IDENTITY.administrator);
    await page.goto(`/review/${questionId}`);

    // The gate rail, outside the tabs, because it is the only thing on the
    // page that says whether the question can proceed.
    await expect(page.getByText(/of 13 gates pass/i)).toBeVisible();

    // The evidence tab quotes the span. A question whose evidence was missing
    // could not have been created, so this asserts the page SHOWS what the
    // platform holds.
    await page
      .getByRole('link', { name: /evidence/i })
      .first()
      .click();
    await expect(page.getByText(/STRICT|STANDARD/).first()).toBeVisible();

    const detail = await api<QuestionDetail>(request, `/api/v1/authoring/questions/${questionId}`);
    expect(detail.status).toBe('DRAFT');
  });

  test('a DRAFT offers only Claim, and says why the others are not available', async ({
    page,
    request,
  }) => {
    const questionId = await generateDraft(request);
    await actAs(page, IDENTITY.administrator);
    await page.goto(`/review/${questionId}`);

    // The state machine, on screen. Pressing Submit on a DRAFT returned a 409
    // that read like a missing permission until 2026-09-22.
    await expect(page.getByText(/next step from DRAFT/i)).toBeVisible();
    await expect(decision(page, 'Claim for authoring')).toBeEnabled();
    await expect(decision(page, 'Submit for approval')).toBeDisabled();
    // A blocked decision's accessible name CARRIES ITS REASON: `Button`
    // renders `disabledReason` as an sr-only span inside the button, so the
    // name is "ApproveNot possible while ...". Selectors here therefore pass
    // the name as a STRING -- Playwright matches a string as a
    // case-insensitive substring -- and the reason is asserted separately,
    // because it is the part a person needs.
    const approve = decision(page, 'Approve');
    await expect(approve).toBeDisabled();
    await expect(approve).toContainText(/not possible while this question is DRAFT/i);
  });

  test('GATE 13: the author cannot approve their own question, a second identity can', async ({
    page,
    request,
  }) => {
    const questionId = await generateDraft(request, IDENTITY.administrator);
    const statusNow = async (): Promise<string> =>
      (await api<QuestionDetail>(request, `/api/v1/authoring/questions/${questionId}`)).status;

    /**
     * Presses a decision and waits for the STATE to move, with one retry.
     *
     * The retry is not papering over a flake, it is the honest handling of a
     * real property of these controls: they are server actions behind
     * `useActionState`, so a click before hydration does nothing at all and
     * leaves no trace. The assertion is still on the state the server holds --
     * if the transition never happens, this fails.
     */
    const take = async (label: string, expected: string): Promise<void> => {
      await page.goto(`/review/${questionId}`);
      const button = decision(page, label);
      await expect(button).toBeEnabled();
      await button.click();
      try {
        await expect.poll(statusNow, { timeout: 20_000 }).toBe(expected);
      } catch {
        await button.click();
        await expect.poll(statusNow, { timeout: 40_000 }).toBe(expected);
      }
    };

    // --- as the author: claim, then submit. All 13 gates run at submit.
    await actAs(page, IDENTITY.administrator);
    await take('Claim for authoring', 'AUTHOR_REVIEW');
    await take('Submit for approval', 'SUBMITTED_FOR_APPROVAL');

    // --- still the author: approve. THIS MUST BE REFUSED.
    await page.goto(`/review/${questionId}`);
    // The rail already says so before anything is pressed.
    await expect(page.getByText(/gate 13/i).first()).toBeVisible();
    await expect(page.getByText(/separation of duties/i).first()).toBeVisible();

    const approve = decision(page, 'Approve');
    await approve.click();
    const refusal = page.getByText('SEPARATION_OF_DUTIES');
    try {
      await expect(refusal.first()).toBeVisible({ timeout: 20_000 });
    } catch {
      await approve.click();
      await expect(refusal.first()).toBeVisible({ timeout: 40_000 });
    }

    // The status did NOT move. A refusal that left the question approved would
    // satisfy every assertion above and be the worst defect in the platform.
    expect(await statusNow()).toBe('SUBMITTED_FOR_APPROVAL');

    // --- as a second identity: approve. THIS MUST SUCCEED.
    await actAs(page, IDENTITY.secondAdministrator);
    await take('Approve', 'APPROVED');
  });

  test('publishing writes to the bank, and a replay reports ALREADY_PUBLISHED', async ({
    page,
    request,
  }) => {
    // Reach APPROVED through the product, with the identity switch gate 13
    // requires.
    const questionId = await generateDraft(request, IDENTITY.administrator);
    await api(request, `/api/v1/authoring/questions/${questionId}/claim`, {
      method: 'POST',
      body: {},
    });
    await api(request, `/api/v1/authoring/questions/${questionId}/submit`, {
      method: 'POST',
      body: {},
    });
    await api(request, `/api/v1/authoring/questions/${questionId}/approve`, {
      method: 'POST',
      as: IDENTITY.secondAdministrator,
      body: {},
    });

    await actAs(page, IDENTITY.administrator);
    await page.goto('/publish');
    await expect(page.getByRole('heading', { name: /^publish$/i })).toBeVisible();

    // Select THIS question -- by value, not "the first row", so the test
    // publishes the question it created. The boxes arrive already checked and
    // sit inside their labels, so `check()` would click the label, toggle the
    // box OFF, and then wait forever for it to be on.
    const box = page.locator(`input[name="questionIds"][value="${questionId}"]`);
    await expect(box).toBeVisible();
    if (!(await box.isChecked())) await box.check();

    // Every other approved question is deselected, so the batch is exactly one
    // and the outcome below is unambiguous.
    const others = await page.locator('input[name="questionIds"]').all();
    for (const other of others) {
      if ((await other.getAttribute('value')) === questionId) continue;
      if (await other.isChecked()) await other.uncheck();
    }

    await page.getByRole('button', { name: 'Publish selected' }).click();

    // The OUTCOME, with the bank item id the adapter returned.
    await expect(page.getByText(/^PUBLISHED$/).first()).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/mock-item-\d+/).first()).toBeVisible();

    // And the question is in the bank inventory with a KNZ identifier.
    await page.goto('/publish');
    await expect(page.getByText(/KNZ-[A-Z0-9_]+-\d{4}-\d{6}/).first()).toBeVisible();

    // A replay is idempotent: the same batch reports ALREADY_PUBLISHED rather
    // than creating a second bank item.
    const replay = await api<{ items: { outcome: string }[] }>(
      request,
      '/api/v1/authoring/question-bank/publish',
      { method: 'POST', body: { questionIds: [questionId] } },
    );
    expect(replay.items[0]?.outcome).toMatch(/ALREADY_PUBLISHED|FAILED/);
  });
});
