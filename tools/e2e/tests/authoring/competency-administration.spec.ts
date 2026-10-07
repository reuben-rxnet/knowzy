// Administration → Competencies, in a browser (COMPETENCY-M2,
// docs/competencies/COMPETENCY_ADMINISTRATION.md).
//
// NON-DESTRUCTIVE BY DESIGN. The development database holds the REAL imported
// framework (decision A4), and a browser test that added definitions to it
// would make its version stale, while one that approved it would take the
// framework owner's decision (CM-1) for them. So this spec writes nothing:
//
//   1. the screen states the boundary -- reference definitions, no person;
//   2. every view renders from the API, and the domains are the six kinds;
//   3. a near match and a duplicate code are REFUSED, with the reason on
//      screen -- refusals that write nothing;
//   4. role requirements say plainly that none can be approved yet;
//   5. an identity without competency.manage reads the catalogue and is
//      offered no control at all.
//
// The write paths -- versions, separated approval, targets -- are exercised
// against a throwaway framework in packages/domain/test/
// competency-administration.test.ts, where they can be cleaned up.

import { expect, test } from '@playwright/test';
import { actAs, api, IDENTITY } from '../support/portal';

const AUTHORING = process.env['E2E_AUTHORING_URL'] ?? 'http://localhost:3000';
const PAGE = `${AUTHORING}/administration/competencies`;

interface Catalogue {
  readonly frameworks: readonly {
    readonly code: string;
    readonly categories: readonly { readonly code: string; readonly name: string }[];
    readonly competencies: readonly {
      readonly code: string;
      readonly name: string;
      readonly categoryCode: string;
    }[];
  }[];
}

test.describe('administration: competencies', () => {
  test('states the boundary and renders every view', async ({ page, request }) => {
    const catalogue = await api<Catalogue>(request, '/api/v1/authoring/competencies/catalogue');
    test.skip(
      catalogue.frameworks.length === 0,
      'No framework imported: run the structure-only import first (COMPETENCY_IMPORT_PLAN.md).',
    );
    await actAs(page, IDENTITY.administrator);
    await page.goto(PAGE);
    await expect(page.getByRole('heading', { name: 'Competencies', level: 1 })).toBeVisible();
    await expect(page.getByText('Reference definitions only')).toBeVisible();
    await expect(page.getByText(/holds no information about any person/)).toBeVisible();

    // The six domains are the category kinds (decision A1).
    const domains = page.locator('table', { has: page.locator('caption', { hasText: 'Domains' }) });
    for (const name of [
      'Product knowledge',
      'Functional and domain',
      'Technical',
      'Process',
      'Agile practice',
      'Power skills',
    ]) {
      await expect(domains.getByRole('rowheader', { name, exact: true })).toBeVisible();
    }

    for (const view of [
      'Categories',
      'Competencies',
      'Aliases',
      'Framework versions',
      'Role requirements',
    ]) {
      await page
        .getByRole('navigation', { name: 'Competency administration views' })
        .getByRole('link', { name: view, exact: true })
        .click();
      await expect(
        page.locator('table caption', { hasText: view }).or(page.getByText(/No role requirement/)),
      ).toHaveCount(1);
    }
  });

  test('refuses a duplicate category code and a near-match competency, writing nothing', async ({
    page,
    request,
  }) => {
    const before = await api<Catalogue>(request, '/api/v1/authoring/competencies/catalogue');
    const framework = before.frameworks[0];
    const category = framework?.categories[0];
    const competency = framework?.competencies.find((row) => row.name.length >= 6);
    if (framework === undefined || category === undefined || competency === undefined) {
      test.skip(true, 'No framework imported.');
      return;
    }

    await actAs(page, IDENTITY.administrator);
    await page.goto(`${PAGE}?view=categories`);
    await page.getByRole('button', { name: 'New category' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Code').fill(category.code);
    await dialog.getByLabel('Name').fill('A name nobody uses');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog.getByText(/already exists/)).toBeVisible({ timeout: 30_000 });
    await dialog.getByRole('button', { name: 'Cancel' }).click();

    // One character changed: within edit distance 2, in the same category.
    await page.goto(
      `${PAGE}?view=competencies&category=${encodeURIComponent(competency.categoryCode)}`,
    );
    await page.getByRole('button', { name: 'New competency' }).click();
    const create = page.getByRole('dialog');
    await create.getByLabel('Name', { exact: true }).fill(`${competency.name}x`);
    await create.getByRole('button', { name: 'Save' }).click();
    await expect(create.getByText(/very close to/)).toBeVisible({ timeout: 30_000 });
    await create.getByRole('button', { name: 'Cancel' }).click();

    const after = await api<Catalogue>(request, '/api/v1/authoring/competencies/catalogue');
    expect(after.frameworks[0]?.categories).toHaveLength(framework.categories.length);
    expect(after.frameworks[0]?.competencies).toHaveLength(framework.competencies.length);
  });

  test('says no role requirement can be approved without an approved framework version', async ({
    page,
    request,
  }) => {
    const targets = await api<{ frameworks: readonly { approvedVersionLabel: string | null }[] }>(
      request,
      '/api/v1/authoring/competencies/role-targets',
    );
    test.skip(
      targets.frameworks[0] === undefined || targets.frameworks[0].approvedVersionLabel !== null,
      'Asserts the shipped state: an imported framework still in DRAFT.',
    );
    await actAs(page, IDENTITY.administrator);
    await page.goto(`${PAGE}?view=requirements`);
    await expect(page.getByText(/No requirement can be approved yet/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Propose a requirement' })).toBeVisible();
  });

  test('a learner is refused the catalogue and offered no control', async ({ page }) => {
    // Since the Authoring Role Simplification the Learner is the only
    // identity without competency.manage, and it has no authoring access.
    await actAs(page, IDENTITY.learner);
    await page.goto(`${PAGE}?view=categories`);
    await expect(page.getByText(/PORTAL_ACCESS_DENIED/).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'New category' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Edit/ })).toHaveCount(0);
    await page.goto(`${PAGE}?view=versions`);
    await expect(page.getByRole('button', { name: /Approve/ })).toHaveCount(0);
  });
});
