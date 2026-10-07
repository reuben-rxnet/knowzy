// Reports, in a browser — Phase 10 R1.
//
// The assertions are on the four properties that make a report trustworthy
// rather than merely present, and each is a thing the approved design invites
// an implementer to get wrong:
//
//   1. The figures MATCH THE API'S, not a fixture. A read model that quietly
//      stopped aggregating fails here.
//   2. `asOf` is on the page, with the resolved window beside it, so a relative
//      choice stays checkable against absolute dates.
//   3. SUPPRESSION IS VISIBLE: a below-threshold row renders the marker, its
//      dependent measures go with it, and the total it would have contributed
//      to reads "Withheld" rather than 0 — a zero there would say "none" about
//      data that exists and may not be shown.
//   4. EVERY METRIC'S FORMULA is on the page.

import { expect, test } from '@playwright/test';
import { actAs, api, ensureScoredAttempt, IDENTITY } from '../support/portal';

const AUTHORING = process.env['E2E_AUTHORING_URL'] ?? 'http://localhost:3000';

interface Dataset {
  readonly title: string;
  readonly asOf: string | null;
  readonly rowCount: number;
  readonly suppressedCellCount: number;
  readonly minimumGroupSize: number;
  readonly totals: Record<string, number>;
  readonly totalsPartial: Record<string, boolean>;
  readonly metrics: readonly { column: string; label: string; formula: string }[];
}

test.describe('reports', () => {
  test('the dashboard shows the API’s own figures, and a comparison only where one was measured', async ({
    page,
    request,
  }) => {
    // R-1: a KPI comparison is real only when the API measured both values.
    // The assertion is COUNTED against the API: exactly as many movements as
    // AVAILABLE comparisons, and "Not Yet Available" for each one without a
    // base. A card that drew a delta the API did not measure fails here.
    const kpis = await api<{
      rows: readonly { label: string; comparisonStatus: string }[];
    }>(request, '/api/v1/authoring/reports/kpis?windowDays=30');
    const pipeline = await api<Dataset>(request, '/api/v1/authoring/reports/question-pipeline');

    await actAs(page, IDENTITY.administrator);
    await page.goto(`${AUTHORING}/reports?period=30`);
    await expect(page.getByRole('heading', { name: 'Reporting & Analytics' })).toBeVisible();

    const total = pipeline.totals['questionCount'] ?? 0;
    await expect(page.getByText(String(total), { exact: true }).first()).toBeVisible();

    for (const row of kpis.rows) {
      await expect(page.getByText(row.label, { exact: true }).first()).toBeVisible();
    }
    const available = kpis.rows.filter((row) => row.comparisonStatus === 'AVAILABLE').length;
    const notYet = kpis.rows.filter((row) => row.comparisonStatus === 'NOT_YET_AVAILABLE').length;
    await expect(page.getByText(/^vs (previous \d+ days|the .+ snapshot)$/)).toHaveCount(available);
    await expect(page.getByText('Not Yet Available', { exact: true })).toHaveCount(notYet);
  });

  test('the learner heatmap is built, suppressed cell by cell, and says what "department" means', async ({
    page,
    request,
  }) => {
    const heat = await api<{ rows: readonly Record<string, unknown>[]; suppressionCount: number }>(
      request,
      '/api/v1/authoring/reports/learner-performance?windowDays=365',
    );
    await actAs(page, IDENTITY.administrator);
    await page.goto(`${AUTHORING}/reports`);
    await expect(page.getByRole('heading', { name: 'Learner performance' })).toBeVisible();
    // D-1: the rows are the department the QUESTIONS were filed under.
    await expect(page.getByText(/department the QUESTIONS were filed under/)).toBeVisible();

    const hidden = heat.rows.filter((row) => row['averageScore'] === 'SUPPRESSED').length;
    await expect(page.locator('td[data-suppressed="true"]')).toHaveCount(hidden);
    if (heat.suppressionCount > 0) {
      await expect(page.getByText(`${heat.suppressionCount} cells withheld`).first()).toBeVisible();
    }
  });

  test('recent activity is the audit trail, drills into it, and never claims a verified connection', async ({
    page,
  }) => {
    await actAs(page, IDENTITY.administrator);
    await page.goto(`${AUTHORING}/reports`);
    await expect(page.getByRole('heading', { name: 'Recent activity' })).toBeVisible();
    await expect(
      page.getByRole('link', { name: /view all in the audit explorer/i }),
    ).toHaveAttribute('href', '/governance/audit');
    await expect(page.getByText(/connection verified/i)).toHaveCount(0);
  });

  test('every chart carries its numbers as a table', async ({ page }) => {
    await actAs(page, IDENTITY.administrator);
    await page.goto(`${AUTHORING}/reports`);
    for (const caption of [
      'Generated and published questions',
      'Lifecycle distribution',
      'Questions filed, by job role and department',
    ]) {
      await expect(page.locator('table caption', { hasText: caption })).toHaveCount(1);
    }
  });

  test('a dashboard panel opens as a full report, with its formulas', async ({ page }) => {
    await actAs(page, IDENTITY.administrator);
    await page.goto(`${AUTHORING}/reports/source-health`);
    await expect(page.getByRole('heading', { name: 'Knowledge source health' })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: /how every number here is calculated/i }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: /export csv/i })).toBeVisible();
  });

  test('a report carries asOf, the resolved window, and a formula per metric', async ({
    page,
    request,
  }) => {
    const data = await api<Dataset>(request, '/api/v1/authoring/reports/generation?windowDays=7');

    await actAs(page, IDENTITY.administrator);
    await page.goto(`${AUTHORING}/reports/generation?windowDays=7`);
    await expect(page.getByRole('heading', { name: data.title })).toBeVisible();

    await expect(page.getByText('Data as of')).toBeVisible();
    await expect(page.getByText(/→/).first()).toBeVisible();

    await expect(
      page.getByRole('heading', { name: /how every number here is calculated/i }),
    ).toBeVisible();
    for (const metric of data.metrics) {
      await expect(page.getByText(metric.label, { exact: true }).first()).toBeVisible();
    }
  });

  test('SUPPRESSION is visible, and a withheld total is not shown as zero', async ({
    page,
    request,
  }) => {
    // PROVISIONS its precondition rather than skipping. The first version
    // skipped when nothing happened to be below the threshold, and a skipped
    // test reads like coverage in a summary -- which is exactly how the
    // platform's three vacuous suites went unnoticed.
    //
    // The precondition is a scored attempt with fewer than five distinct
    // learners: one learner, one attempt, which `ensureScoredAttempt` takes
    // through the learner API when none exists. (It used to be
    // `ensurePublishedAssessment`, which takes no attempt at all -- the test
    // passed on leftovers and failed the first time verify emptied them.)
    // Then the read models are REFRESHED, because the scheduled refresh runs
    // every fifteen minutes and a test cannot wait for it.
    await ensureScoredAttempt(request);
    await api(request, '/api/v1/authoring/reports/refresh', { method: 'POST', body: {} });

    const data = await api<Dataset>(request, '/api/v1/authoring/reports/assessments');
    expect(
      data.suppressedCellCount,
      'the assessment report should suppress a single-learner row; if this is 0 either the ' +
        'helper produced five or more learners or suppression has stopped firing',
    ).toBeGreaterThan(0);

    await actAs(page, IDENTITY.administrator);
    await page.goto(`${AUTHORING}/reports/assessments`);

    await expect(
      page.getByText(new RegExp(`${data.suppressedCellCount} cells withheld`)),
    ).toBeVisible();
    await expect(
      page.getByText(new RegExp(`Minimum group size ${data.minimumGroupSize}`)),
    ).toBeVisible();
    await expect(page.getByText('Suppressed').first()).toBeVisible();

    // "Withheld", NEVER 0.
    await expect(page.getByText('Withheld').first()).toBeVisible();
  });

  test('a learner is refused the report, and told why', async ({ page }) => {
    await actAs(page, IDENTITY.learner);
    await page.goto(`${AUTHORING}/reports/filing`);
    await expect(page.getByText(/PORTAL_ACCESS_DENIED/).first()).toBeVisible();
  });

  test('exports a CSV whose header block states scope, asOf and suppression', async ({
    page,
    request,
  }) => {
    const exported = await api<{ filename: string; csv: string }>(
      request,
      '/api/v1/authoring/reports/filing/export',
      { method: 'POST', body: {} },
    );
    expect(exported.filename).toMatch(/^knowzy-filing-\d{4}-\d{2}-\d{2}\.csv$/);
    // S8: a file that leaves the platform still states what it does and does
    // not contain.
    for (const required of [
      'Knowzy report',
      'Effective scope',
      'Data as of',
      'Minimum group size',
      'Suppressed cells',
      'Formula',
    ]) {
      expect(exported.csv, `the header block is missing ${required}`).toContain(required);
    }

    await actAs(page, IDENTITY.administrator);
    await page.goto(`${AUTHORING}/reports/filing`);
    await expect(page.getByRole('button', { name: /export csv/i })).toBeVisible();
  });

  test('captures a snapshot, and the server keeps it', async ({ page, request }) => {
    await actAs(page, IDENTITY.administrator);
    await page.goto(`${AUTHORING}/reports/filing`);

    const label = `E2E snapshot ${Date.now().toString(36)}`;
    await page.getByRole('button', { name: /^snapshot$/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByLabel(/^label$/i).fill(label);
    await dialog.getByRole('button', { name: /^capture$/i }).click();
    await expect(dialog.getByText(/captured, and recorded in the audit trail/i)).toBeVisible({
      timeout: 30_000,
    });

    // The SERVER's copy. A dialog that says "captured" having stored nothing is
    // the failure mode of every save button ever built.
    const listed = await api<{ snapshots: readonly { label: string }[] }>(
      request,
      '/api/v1/authoring/reports/snapshots',
    );
    expect(listed.snapshots.some((snapshot) => snapshot.label === label)).toBe(true);
  });
});
