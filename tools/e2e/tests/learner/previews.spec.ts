// LIVE-PREVIEW-M1 and M2: the six learner preview pages.
//
// What a preview must NEVER do is pass for the real thing, so the assertions
// are about that, not about layout:
//
//   * the sidebar reaches it and labels it "Preview";
//   * the page opens with the preview notice;
//   * every illustrative block is fenced and tagged on screen;
//   * NOTHING inside a frame is actionable: no link, and every button and
//     form control disabled;
//   * a real section, where the page has one, is tagged Live.

import { expect, test, type Page } from '@playwright/test';

const PAGES = [
  { path: '/my-learnings', nav: 'My Learnings', live: true },
  { path: '/discover', nav: 'Discover', live: true },
  { path: '/badges', nav: 'Badges', live: false },
  { path: '/knowledge-library', nav: 'Knowledge Library', live: true },
  { path: '/my-progress', nav: 'My Progress', live: true },
  { path: '/help', nav: 'Help & Support', live: true },
] as const;

/** Every dashed frame on the page, found by its visible tag. */
const frames = (page: Page) =>
  page.locator('main section').filter({ has: page.getByText(/^Illustrative example — /) });

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
      await expect(page.getByRole('heading', { level: 1, name: entry.nav })).toBeVisible();
      await expect(nav.getByRole('link', { name: new RegExp(`^${entry.nav}`) })).toHaveAttribute(
        'aria-current',
        'page',
      );

      // The notice comes first and says what it is.
      await expect(page.getByRole('note', { name: 'Preview' })).toBeVisible();

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

      const live = page.getByText('Live — from this release');
      if (entry.live) await expect(live.first()).toBeVisible();
      // Badges has no live section: nothing is awarded, and a Live tag on a
      // zero would still be a claim.
      else await expect(live).toHaveCount(0);
    });
  }

  test('every learner destination opens something, and none reads "Needs backend"', async ({
    page,
  }) => {
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Learning sections' });
    await expect(nav.getByText('Needs backend')).toHaveCount(0);
    const hrefs = await nav
      .getByRole('link')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''));
    expect(hrefs).toHaveLength(8);
    for (const href of new Set(hrefs)) {
      const response = await page.goto(href);
      expect(response?.status(), href).toBe(200);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    }
  });

  test('no badge design is presented as earned', async ({ page }) => {
    for (const path of ['/my-learnings', '/badges']) {
      await page.goto(path);
      const art = page.getByRole('img', { name: /^Badge design: / });
      const total = await art.count();
      expect(total, path).toBeGreaterThan(0);
      for (let index = 0; index < total; index += 1) {
        await expect(art.nth(index)).toHaveAttribute('alt', /Not earned\.$/);
      }
    }
    // The "recently earned" example carries no date: nothing has been awarded.
    const recent = page.locator('section', { hasText: 'Recently earned badges' });
    expect(await recent.innerText()).not.toMatch(/\b20\d\d\b|\b\d{1,2}\s\w{3}\b/);
  });

  test('the real sections agree with the learner API', async ({ page, request }) => {
    const api = process.env['E2E_API_URL'] ?? 'http://localhost:8080';
    const response = await request.get(`${api}/api/v1/learning/assessments`, {
      headers: { 'x-knowzy-subject': 'learner@local.invalid' },
    });
    expect(response.ok(), await response.text()).toBe(true);
    const body = (await response.json()) as {
      count: number;
      assessments: { domain: string; attemptsUsed: number; inProgressSession: unknown }[];
    };

    await page.goto('/my-learnings');
    const available = page.getByText('Assessments available to you').locator('..');
    await expect(available).toContainText(String(body.count));

    await page.goto('/discover');
    for (const domain of new Set(body.assessments.map((item) => item.domain))) {
      await expect(page.getByText(domain, { exact: true }).first()).toBeVisible();
    }

    if (body.count > 0) {
      const attempted = body.assessments.filter(
        (item) => item.attemptsUsed > 0 || item.inProgressSession !== null,
      ).length;
      await page.goto('/my-progress');
      await expect(page.getByText(`${attempted} of ${body.count} attempted`)).toBeVisible();
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
