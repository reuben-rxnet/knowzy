// Browser end-to-end configuration.
//
// What this suite is for: `docs/initial-end-to-end-proof.md` §3 defines a
// 36-step acceptance script, and until now the equivalent had only ever been
// run by hand. Nothing drove the UI, so a broken screen was found by a person.
//
// Two deliberate choices.
//
// **It runs against the RUNNING STACK, not a mocked one.** `baseURL` points at
// the compose stack's authoring portal, and the learner portal is a second
// project. A mocked API would test the components; this tests the product,
// including the server actions, the policy checks and the gate chain.
//
// **The browser is the system browser when the CDN is unreachable.** Playwright
// normally downloads its own Chromium, and on this network
// `cdn.playwright.dev` times out. `E2E_BROWSER_CHANNEL=chrome` (or `msedge`)
// drives the installed browser instead, which needs no download. Unset, the
// bundled Chromium is used, which is what CI should do.

import { defineConfig, devices } from '@playwright/test';

const AUTHORING = process.env['E2E_AUTHORING_URL'] ?? 'http://localhost:3000';
const LEARNER = process.env['E2E_LEARNER_URL'] ?? 'http://localhost:3001';
const SYNC = process.env['E2E_SYNC_URL'] ?? 'http://localhost:3002';
const channel = process.env['E2E_BROWSER_CHANNEL'];

export default defineConfig({
  testDir: './tests',
  // One worker, and this is not a performance oversight: the suite drives one
  // shared database through the real workflow, and two workers approving
  // questions at once would produce failures that have nothing to do with the
  // code. The integration suites are serialized for the same reason.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  // Per TEST, not per assertion (assertions keep 15 seconds). 180 seconds
  // since 2026-10-14: on the local stack a test that synchronizes, generates
  // and navigates spends its time on real work plus dev-server compilation,
  // and 90 seconds was being exceeded by navigations that then succeeded.
  timeout: 180_000,
  expect: { timeout: 15_000 },
  reporter: process.env['CI'] ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: AUTHORING,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    ...(channel === undefined ? {} : { channel }),
  },
  projects: [
    {
      name: 'authoring',
      testMatch: /authoring\/.*\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: AUTHORING, ...(channel ? { channel } : {}) },
    },
    {
      name: 'sync',
      testMatch: /sync\/.*\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: SYNC, ...(channel ? { channel } : {}) },
    },
    {
      name: 'learner',
      testMatch: /learner\/.*\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: LEARNER, ...(channel ? { channel } : {}) },
    },
  ],
});
