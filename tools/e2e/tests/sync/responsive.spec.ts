// The Sync Manager has no navigation rail by design (one operational
// dashboard). On a phone its header's secondary items collapse behind one
// disclosure button, and nothing on the page may scroll sideways.

import { expect, test } from '@playwright/test';

test.describe('sync manager on small screens', () => {
  test('phone: the header collapses behind a disclosure that opens and closes', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    const more = page.getByRole('button', { name: 'Environment and settings' });
    await expect(more).toHaveAttribute('aria-expanded', 'false');
    const settings = page.getByRole('button', { name: /^Settings/ });
    await expect(settings).toBeHidden();
    await more.click();
    await expect(more).toHaveAttribute('aria-expanded', 'true');
    await expect(settings).toBeVisible();
    await expect(settings).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(more).toHaveAttribute('aria-expanded', 'false');
  });

  test('desktop: the header items are inline and there is no disclosure', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Environment and settings' })).toBeHidden();
    await expect(page.getByRole('button', { name: /^Settings/ })).toBeVisible();
  });

  for (const width of [390, 820, 1440]) {
    test(`no sideways scroll at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/');
      const overflow = Number(
        await page.evaluate('document.documentElement.scrollWidth - window.innerWidth'),
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
});
