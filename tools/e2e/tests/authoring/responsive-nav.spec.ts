import { expect, test } from '@playwright/test';
import { PHONE, TABLET, describeResponsiveNav } from '../support/responsive-nav';

describeResponsiveNav({
  navName: 'Authoring sections',
  start: '/',
  target: { path: '/sources', label: 'Knowledge Sources' },
});

// The screens the mobile review found overflowing (UX-M1): the AI Providers
// table's screen-reader labels escaped their scroll box, and the reporting
// dashboard's cards refused to shrink below their content.
for (const path of ['/administration/providers', '/reports', '/governance/ai-usage']) {
  for (const size of [PHONE, TABLET]) {
    test(`${path} does not scroll sideways at ${size.width}px`, async ({ page }) => {
      await page.setViewportSize(size);
      await page.goto(path);
      const overflow = Number(
        await page.evaluate('document.documentElement.scrollWidth - window.innerWidth'),
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
}
