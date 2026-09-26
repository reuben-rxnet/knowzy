// The Filing tab, in a browser.
//
// A question is filed on FOUR axes, and this screen is where the difference
// between them is enforced in front of a reviewer:
//
//   DOMAIN and TOPIC are read-only. The domain code is inside the published
//   identifier `KNZ-{CODE}-{YYYY}-{SEQ}`, which lives in a SharePoint list
//   outside this platform, and the topic is what the preflight authorized.
//   Neither has a control on this screen, and that absence is the assertion.
//
//   DEPARTMENT and ROLE are editable while the question is still with its
//   author, and READ-ONLY afterwards, because a question is approved AS FILED.
//
// The badge in the header is also checked here, for a small reason with a
// history: its first version tested `=== null` and printed the word
// "undefined" twice on screen for a question whose API response simply had no
// such key. An absent value and a null value must render identically.

import { expect, test } from '@playwright/test';
import { actAs, api, generateDraft, IDENTITY } from '../support/portal';

const AUTHORING = process.env['E2E_AUTHORING_URL'] ?? 'http://localhost:3000';

interface Taxonomy {
  readonly departments: readonly { departmentId: string; code: string; name: string }[];
  readonly jobRoles: readonly { jobRoleId: string; code: string; name: string }[];
}

test.describe('question filing', () => {
  test('shows four axes, two of them fixed at generation', async ({ page, request }) => {
    const questionId = await generateDraft(request);

    await actAs(page, IDENTITY.administrator);
    await page.goto(`${AUTHORING}/review/${questionId}?tab=filing`);

    await expect(page.getByRole('heading', { name: /how this question is filed/i })).toBeVisible();

    // All four axes are named, and the two immutable ones say why.
    for (const axis of ['Domain', 'Topic', 'Department', 'Role']) {
      await expect(page.getByText(axis, { exact: true }).first()).toBeVisible();
    }
    await expect(page.getByText(/fixed at generation/i).first()).toBeVisible();
    await expect(page.getByText(/KNZ-/).first()).toBeVisible();

    // NO control for the two immutable axes. The form has exactly two selects.
    const form = page.getByRole('button', { name: /save filing/i }).locator('xpath=ancestor::form');
    await expect(form.locator('select')).toHaveCount(2);
  });

  test('the header badge never renders "undefined" for an unfiled question', async ({
    page,
    request,
  }) => {
    const questionId = await generateDraft(request);
    await actAs(page, IDENTITY.administrator);
    await page.goto(`${AUTHORING}/review/${questionId}`);

    const header = page.getByRole('heading', { name: /question review/i }).locator('..');
    await expect(header).toBeVisible();
    // Whatever the filing is, the words that mean a rendering fault are absent.
    await expect(page.getByText(/undefined/).first()).toHaveCount(0);
  });

  test('re-files a draft, and the change reaches the server as a new version', async ({
    page,
    request,
  }) => {
    const questionId = await generateDraft(request);
    const taxonomy = await api<Taxonomy>(request, '/api/v1/authoring/taxonomy');
    const department = taxonomy.departments[0];
    const role = taxonomy.jobRoles[0];
    // A guard rather than a non-null assertion: the tenant genuinely may have
    // no organizational catalogue, and `test.skip` does not narrow the type.
    if (department === undefined || role === undefined) {
      test.skip(true, 'The tenant has no departments or roles to file against.');
      return;
    }

    await actAs(page, IDENTITY.administrator);
    await page.goto(`${AUTHORING}/review/${questionId}?tab=filing`);

    await page.getByLabel('Department', { exact: true }).selectOption(department.departmentId);
    await page.getByLabel('Role', { exact: true }).selectOption(role.jobRoleId);
    await page.getByRole('button', { name: /save filing/i }).click();
    await expect(page.getByText(/saved as version|nothing changed/i)).toBeVisible({
      timeout: 30_000,
    });

    // The SERVER's copy, not the screen's. A dialog that says "saved" having
    // changed nothing is the failure mode of every settings screen.
    const detail = await api<{
      department: { code: string } | null;
      jobRole: { code: string } | null;
    }>(request, `/api/v1/authoring/questions/${questionId}`);
    expect(detail.department?.code).toBe(department.code);
    expect(detail.jobRole?.code).toBe(role.code);
  });

  test('the filing is READ-ONLY once the question has been submitted', async ({
    page,
    request,
  }) => {
    // A question is approved as filed: the gates and the approval record are
    // taken at that moment, so the filing must not move underneath them.
    const questionId = await generateDraft(request);
    await api(request, `/api/v1/authoring/questions/${questionId}/claim`, { method: 'POST' });
    await api(request, `/api/v1/authoring/questions/${questionId}/submit`, { method: 'POST' });

    await actAs(page, IDENTITY.administrator);
    await page.goto(`${AUTHORING}/review/${questionId}?tab=filing`);

    // The REASON, not a missing form. An absent control reads as a bug.
    await expect(page.getByRole('heading', { name: /now read-only/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /save filing/i })).toHaveCount(0);
    await expect(page.getByText(/approved as filed/i)).toBeVisible();
  });
});
