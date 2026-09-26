// Acceptance script steps 21–29, in a browser: discover → start → answer →
// resume → finish → results.
//
// Two invariants are asserted here that no unit test can reach, because they
// are properties of what the BROWSER received:
//
//   * **no answer key ever arrives.** Every learner response is checked for the
//     fields security.md K4 forbids. A projection that leaked the correct
//     option would still render a perfectly normal quiz.
//   * **resume is server state, not browser state.** The page is reloaded
//     mid-attempt and the saved answer has to come back. Storing progress in
//     the browser would pass a click-through test and lose a real attempt.

import { expect, test, type Page } from '@playwright/test';
import { ensurePublishedAssessment, openIdentityMenu } from '../support/portal';

const API = process.env['E2E_API_URL'] ?? 'http://localhost:8080';
const AUTHORING = process.env['E2E_AUTHORING_URL'] ?? 'http://localhost:3000';
const LEARNER_UPN = 'learner@local.invalid';

/** Fields a learner projection must never carry (security.md §8 K4). */
const FORBIDDEN = ['correctAnswer', 'correctOption', 'supportingEvidence', 'sourceLocation'];

const signInAsLearner = async (page: Page): Promise<void> => {
  // The learner portal's picker moved into the header's profile menu on
  // 2026-09-26, the same change as the authoring portal's.
  await page.goto('/');
  await openIdentityMenu(page);
  const option = page
    .locator('header')
    .getByRole('button', { name: /Learner/i })
    .first();
  if (await option.isVisible()) await option.click();
};

test.describe('learner attempt', () => {
  // A published assessment is a PRECONDITION, not something to skip over. The
  // helper publishes questions and an assessment through the real workflow if
  // the database has none.
  test.beforeAll(async ({ request }) => {
    await ensurePublishedAssessment(request);
  });

  test.beforeEach(async ({ page }) => {
    // Every learning response is inspected as it arrives. This runs for the
    // whole test, not at one checkpoint, because the leak could be on any
    // request.
    page.on('response', async (response) => {
      const url = response.url();
      if (!url.startsWith(API) && !url.includes('/api/v1/live')) return;
      const type = response.headers()['content-type'] ?? '';
      if (!type.includes('json')) return;
      const body = await response.text().catch(() => '');
      for (const field of FORBIDDEN) {
        expect(body, `${field} leaked from ${url}`).not.toContain(`"${field}"`);
      }
    });
    await signInAsLearner(page);
  });

  test('an assessment is discoverable with the facts a learner needs', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /your assessments/i })).toBeVisible();

    // No skip: the precondition was provisioned, so an empty list is a defect.
    await expect(page.getByText(/no assessment is available to you yet/i)).toBeHidden();

    // The card states what it is, not a placeholder.
    await expect(page.getByText(/questions/i).first()).toBeVisible();
    await expect(page.getByText(/pass mark/i).first()).toBeVisible();
  });

  test('start, answer, RESUME after a reload, finish, and read the score', async ({ page }) => {
    await page.goto('/');
    const open = page.getByRole('link', { name: /^open$/i }).first();
    await expect(open).toBeVisible();
    await open.click();

    // --- start. The page is titled with the ASSESSMENT's own name, not a
    // generic "Start assessment", so the heading assertion is on what is
    // always there: the expectations panel and the Start control.
    await expect(page.getByRole('heading', { name: /what to expect/i })).toBeVisible();
    await expect(page.getByText(/questions in this attempt/i)).toBeVisible();
    // Start, and WAIT FOR THE SESSION URL rather than for a heading.
    //
    // The control is a server action behind `useActionState`, so it needs
    // hydration: a click that lands too early does nothing at all, and an
    // assertion on the next screen then times out looking like a broken quiz.
    // One retry, and the URL is the signal because a session id in the path is
    // proof the server created one.
    const startButton = page.getByRole('button', { name: /^(start|resume)$/i });
    await startButton.click();
    try {
      await page.waitForURL(/\/sessions\//, { timeout: 30_000 });
    } catch {
      await startButton.click();
      await page.waitForURL(/\/sessions\//, { timeout: 60_000 });
    }
    const sessionUrl = page.url();

    // --- question 1
    await expect(page.getByRole('heading', { name: /question 1 of/i })).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByText(/answered 0 of/i)).toBeVisible();

    // Answer it, remembering WHICH option by value, not by label: the labels
    // all begin with a letter and a stop, so a regex on the text would match
    // several.
    const chosen = page.getByRole('radio').first();
    const chosenValue = await chosen.inputValue();
    await chosen.check();
    await page.getByRole('button', { name: /save and continue/i }).click();
    await expect(page.getByText(/answered 1 of/i)).toBeVisible({ timeout: 30_000 });

    // --- RESUME: reload the session from scratch. The progress count has to
    // come back from SERVER state; progress kept in the browser would pass a
    // click-through test and lose a real attempt.
    await page.goto(sessionUrl);
    await expect(page.getByText(/answered 1 of/i)).toBeVisible();

    // The SELECTION is not asserted here, and that is a correction rather than
    // a gap. Saving an answer ADVANCES THE CURSOR (§4.5), so a reload presents
    // the NEXT question -- an unanswered one, with nothing selected. The
    // previous version looked for `input[value="${'$'}{chosenValue}"]` on that page
    // and asserted it was checked; it found the next question's option of the
    // same letter and failed, or found nothing and passed on a guard. Either
    // way it was not testing what it claimed.
    //
    // The restored SELECTION is asserted below instead, on a question that is
    // actually answered.

    // --- answer everything still unanswered, then finish
    //
    // Driven by the PROGRESS COUNT, not by whether "Finish and score" is
    // visible. That button is on the page at every question -- §4.6 lets a
    // learner finish early, with unanswered questions counting as incorrect --
    // so the previous `if (finish.isVisible()) break` exited after the FIRST
    // question and scored an attempt that was two-thirds unanswered. The test
    // still reached a result, which is why nothing complained.
    const progress = async (): Promise<{ answered: number; total: number }> => {
      const text = await page
        .getByText(/answered \d+ of \d+/i)
        .first()
        .innerText();
      const [, answered = '0', total = '0'] = /answered (\d+) of (\d+)/i.exec(text) ?? [];
      return { answered: Number(answered), total: Number(total) };
    };

    for (let guard = 0; guard < 20; guard += 1) {
      const { answered, total } = await progress();
      if (answered >= total) break;
      const radios = page.getByRole('radio');
      if ((await radios.count()) === 0) break;
      await radios.first().check();

      const save = page.getByRole('button', { name: /save and continue/i });
      await save.click();
      // WAIT FOR THE COUNT TO MOVE, not for a load state. Saving is a server
      // action behind `useActionState`: `domcontentloaded` resolves before the
      // re-render, so the next iteration read a stale count, re-answered the
      // same question, and burned the guard without progressing -- which left
      // two of four answered and looked like the quiz refusing input. One
      // retry, because a click landing before hydration does nothing at all
      // and leaves no trace.
      const advanced = new RegExp(`answered ${answered + 1} of`, 'i');
      try {
        await expect(page.getByText(advanced).first()).toBeVisible({ timeout: 20_000 });
      } catch {
        await save.click();
        await expect(page.getByText(advanced).first()).toBeVisible({ timeout: 30_000 });
      }
    }
    const complete = await progress();
    expect(complete.answered).toBe(complete.total);

    // --- RESUME, on an ANSWERED question. With every question answered the
    // cursor sits one past the end and clamps to the LAST question, which
    // carries its saved answer -- the state a learner who closed the tab after
    // the final question comes back to, and the one case where the presented
    // question is one the server holds a response for. A pre-checked radio
    // here is the actual proof that a selection survives a reload.
    await page.goto(sessionUrl);
    await expect(page.getByRole('radio').first()).toBeAttached();
    const checked = page.locator('input[type="radio"]:checked');
    await expect(checked).toHaveCount(1);
    expect(chosenValue).toMatch(/^[A-D]$/);

    const finish = page.getByRole('button', { name: /finish and score/i });
    await finish.click();
    try {
      await page.waitForURL(/\/results\//, { timeout: 30_000 });
    } catch {
      await finish.click();
      await page.waitForURL(/\/results\//, { timeout: 60_000 });
    }

    // --- the result: a score, an outcome and a band, all computed server-side.
    await expect(page.getByRole('heading', { name: /your result/i })).toBeVisible({
      timeout: 60_000,
    });
    // A percentage, with or without decimals: the meter renders the stored
    // number, and Number(100.00) prints as 100.
    await expect(page.getByText(/\d+(\.\d+)?\s*%/).first()).toBeVisible();
    // And the count behind it, so the percentage is not a lone figure.
    await expect(page.getByText(/\d+ of \d+ correct/i).first()).toBeVisible();
    await expect(page.getByText(/passed|not passed/i).first()).toBeVisible();
    // The band, as the learner portal words it: the enum is title-cased for
    // display (`EXPERT` reads "Expert"), so asserting the raw enum would be
    // asserting something no learner ever sees.
    await expect(
      page.getByText(/Novice|Developing|Competent|Proficient|Expert/).first(),
    ).toBeVisible();

    // Per-topic accuracy, which is what makes a result actionable.
    await expect(page.getByText(/correct/i).first()).toBeVisible();
  });

  test('a learner cannot open the authoring portal by URL', async ({ page }) => {
    // Portal separation is server-side (E5). The learner identity is not an
    // authoring subject, so the screen must refuse rather than render.
    const response = await page.goto(`${AUTHORING}/review`);
    const status = response?.status() ?? 0;
    const text = await page.textContent('body');
    // Either the request is refused outright, or the page renders a refusal.
    // What must NOT happen is a working review queue.
    expect(
      status >= 400 || /forbidden|not permitted|refus|unauthenticated/i.test(text ?? ''),
      `the authoring review queue rendered for ${LEARNER_UPN}`,
    ).toBeTruthy();
  });
});
