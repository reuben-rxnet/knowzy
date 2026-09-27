// Shared assertions for the responsive navigation (UX-M1), run against both
// portals. The rules are the same everywhere, so the checks are too.

import { expect, test, type Page } from '@playwright/test';

export const PHONE = { width: 390, height: 844 };
export const TABLET = { width: 820, height: 1180 };
export const DESKTOP = { width: 1440, height: 900 };

export const describeResponsiveNav = (options: {
  readonly navName: string;
  readonly start: string;
  /** A second page to reach from the drawer, and its sidebar label. */
  readonly target: { readonly path: string; readonly label: string };
}) => {
  const { navName, start, target } = options;
  const toggle = (page: Page) =>
    page.getByRole('banner').getByRole('button', { name: 'Open navigation' });
  const drawer = (page: Page) => page.getByRole('dialog', { name: 'Navigation' });

  test.describe(`responsive navigation (${navName})`, () => {
    test('desktop: the sidebar is shown and there is no menu button', async ({ page }) => {
      await page.setViewportSize(DESKTOP);
      await page.goto(start);
      await expect(page.getByRole('navigation', { name: navName })).toBeVisible();
      await expect(toggle(page)).toBeHidden();
    });

    test('tablet: a collapsed rail, every entry named, the current one marked', async ({
      page,
    }) => {
      await page.setViewportSize(TABLET);
      await page.goto(target.path);
      const rail = page.getByRole('navigation', { name: navName });
      await expect(rail).toBeVisible();
      const box = await rail.boundingBox();
      expect(box?.width ?? 0, 'the rail is collapsed').toBeLessThan(100);
      await expect(
        rail.getByRole('link', { name: new RegExp(`^${target.label}`) }),
      ).toHaveAttribute('aria-current', 'page');
      // The full list is still one tap away.
      await expect(toggle(page)).toBeVisible();
    });

    test('phone: the drawer opens, traps focus, marks the page, and closes', async ({ page }) => {
      await page.setViewportSize(PHONE);
      await page.goto(start);
      await expect(page.getByRole('navigation', { name: navName })).toBeHidden();

      const button = toggle(page);
      await expect(button).toHaveAttribute('aria-expanded', 'false');
      await button.click();
      const panel = drawer(page);
      await expect(panel).toBeVisible();
      await expect(button).toHaveAttribute('aria-expanded', 'true');

      // Focus lands on the current page's link, inside the drawer.
      const current = panel.locator('a[aria-current="page"]');
      await expect(current).toBeFocused();

      // Tab cycles inside the drawer rather than escaping to the page.
      for (let index = 0; index < 20; index += 1) await page.keyboard.press('Tab');
      await expect(panel.locator(':focus')).toHaveCount(1);

      // Escape closes it and returns focus to the toggle.
      await page.keyboard.press('Escape');
      await expect(panel).toBeHidden();
      await expect(button).toBeFocused();

      // And it navigates.
      await button.click();
      await drawer(page)
        .getByRole('link', { name: new RegExp(`^${target.label}`) })
        .click();
      await expect(page).toHaveURL(new RegExp(`${target.path}$`));
      await expect(drawer(page)).toBeHidden();
    });

    for (const size of [PHONE, TABLET, DESKTOP]) {
      test(`no sideways scroll at ${size.width}px`, async ({ page }) => {
        await page.setViewportSize(size);
        await page.goto(target.path);
        const overflow = Number(
          await page.evaluate('document.documentElement.scrollWidth - window.innerWidth'),
        );
        expect(overflow).toBeLessThanOrEqual(0);
      });
    }
  });
};
