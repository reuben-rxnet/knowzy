// Loads the repository .env for the integration project.
//
// Without this, `npm run test:integration` finds no DATABASE_URL and the suites
// SKIP themselves. A skipped test reads identically to a passing one in the
// summary, which is the worst possible failure mode for the suite that proves
// the audit/state transaction coupling (exit criterion 5). Vitest does not put
// .env into process.env on its own — Vite only exposes VITE_-prefixed values to
// import.meta.env — so it is loaded explicitly here.
//
// Existing environment variables always win, so CI (which sets DATABASE_URL
// directly) is unaffected.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const envPath = resolve(__dirname, '.env');

if (existsSync(envPath)) {
  for (const rawLine of readFileSync(envPath, 'utf8').split('\n')) {
    const line = rawLine.replace(/\r$/, '').trim();
    if (line.length === 0 || line.startsWith('#')) continue;

    const eq = line.indexOf('=');
    if (eq <= 0) continue;

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (process.env[key] === undefined) process.env[key] = value;
  }
}

if (!process.env['DATABASE_URL']) {
  // Loud rather than silent. The suites still skip, but the reason is visible.
  process.stderr.write(
    '\n[integration] DATABASE_URL is not set and no .env supplied one.\n' +
      '[integration] Database-backed suites will SKIP, not pass.\n' +
      '[integration] Start one with: docker compose -f infrastructure/compose/docker-compose.yml up -d postgres\n\n',
  );
}
