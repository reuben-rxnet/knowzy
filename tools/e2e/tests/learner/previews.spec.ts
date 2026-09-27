// LIVE-PREVIEW-M1: the four learner preview pages.
//
// What a preview must NEVER do is pass for the real thing, so the assertions
// are about that, not about layout:
//
//   * the sidebar reaches it and labels it "Preview";
//   * the page opens with the preview notice;
//   * every illustrative block is fenced and tagged on screen;
//   * NOTHING inside a frame is actionable: no link, and every button and
//     form control disabled;
//   * the real sections are tagged Live and carry real data.

import { expect, test, type Page } from '@playwright/test';

const PAGES = [
  { path: '/my-learnings', nav: 'My Learnings', heading: 'My Learnings' },
  { path: '/discover', nav: 'Discover', heading: 'Discover' },
  { path: '/knowledge-library', nav: 'Knowledge Library', heading: 'Knowledge Library' },
  { path: '/help', nav: 'Help & Support', heading: 'Help & Support' },
] as const;

/** Every dashed frame on the page, found by its visible tag. */
const frames = (page: Page) =>
  page
    .locator('main section')
    .filter({ has: page.getByText(/^Illustrative example — not (real|your) data$/) });

test.describe('learner preview pages', () => {
  for (const entry of PAGES) {
    test(`${entry.nav}: reachable, labelled, and nothing in a frame is active`, async ({
      page,
    }) => {
      await page.goto('/');
      const nav = page.getByRole('navigation', { name: 'Learning sections' });
      const link = nav.getByRole('link', { name: new RegExp(`^${entry.nav}`) });
      await expect(link).toContainText('Preview');
      await link.click();

      await expect(page).toHaveURL(new RegExp(`${entry.path}$`));
      await expect(page.getByRole('heading', { level: 1, name: entry.heading })).toBeVisible();
      await expect(nav.getByRole('link', { name: new RegExp(`^${entry.nav}`) })).toHaveAttribute(
        'aria-current',
        'page',
      );

      // The notice comes first and says what it is.
      const notice = page.getByRole('note', { name: 'Preview' });
      await expect(notice).toBeVisible();

      const fenced = frames(page);
      const count = await fenced.count();
      expect(count, 'a preview page has illustrative frames').toBeGreaterThan(0);

      for (let index = 0; index < count; index += 1) {
        const frame = fenced.nth(index);
        await expect(frame.getByRole('link')).toHaveCount(0);
        for (const button of await frame.getByRole('button').all()) {
          await expect(button).toBeDisabled();
        }
        for (const control of await frame.locator('input, select, textarea').all()) {
          await expect(control).toBeDisabled();
        }
      }

      // Every page carries at least one real section, tagged as such.
      await expect(page.getByText('Live — from this release').first()).toBeVisible();
    });
  }

  test('Badges and My Progress are still not links', async ({ page }) => {
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Learning sections' });
    await expect(nav.getByRole('link', { name: /^Badges/ })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: /^My Progress/ })).toHaveCount(0);
  });

  test('no badge design is presented as earned', async ({ page }) => {
    await page.goto('/my-learnings');
    const art = page.getByRole('img', { name: /^Badge design: / });
    const total = await art.count();
    expect(total).toBeGreaterThan(0);
    for (let index = 0; index < total; index += 1) {
      await expect(art.nth(index)).toHaveAttribute('alt', /Not earned\.$/);
    }
  });

  test('the real sections agree with the learner API', async ({ page, request }) => {
    const api = process.env['E2E_API_URL'] ?? 'http://localhost:8080';
    const response = await request.get(`${api}/api/v1/learning/assessments`, {
      headers: { 'x-knowzy-subject': 'learner@local.invalid' },
    });
    expect(response.ok(), await response.text()).toBe(true);
    const body = (await response.json()) as { count: number; assessments: { domain: string }[] };

    await page.goto('/my-learnings');
    const available = page.getByText('Assessments available to you').locator('..');
    await expect(available).toContainText(String(body.count));

    await page.goto('/discover');
    for (const domain of new Set(body.assessments.map((item) => item.domain))) {
      await expect(page.getByText(domain, { exact: true }).first()).toBeVisible();
    }
  });

  test('help names no support address, number or hours', async ({ page }) => {
    await page.goto('/help');
    const text = await page.locator('main').innerText();
    expect(text).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
    expect(text).not.toMatch(/\+?\d[\d\s()-]{7,}\d/);
    expect(text).not.toMatch(/\b\d{1,2}(:\d{2})?\s?(AM|PM)\b/i);
    expect(text).not.toMatch(/All Systems Operational/i);
  });
});
