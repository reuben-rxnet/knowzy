// Reading and writing the Document Studio mode for the suite's global setup and
// teardown, as the administrator, straight against the API.

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = process.env['E2E_API_URL'] ?? 'http://localhost:8080';
const HEADERS = { 'x-knowzy-subject': 'knowzy-administrator@local.invalid' };

/** Where the mode found at the start of a run is kept until its end. */
export const modeFile = join(
  dirname(fileURLToPath(import.meta.url)),
  'test-results',
  '.studio-mode-before',
);

export const readMode = async (): Promise<'SIMPLE' | 'FULL'> => {
  const response = await fetch(`${API}/api/v1/authoring/document-studio/mode`, {
    headers: HEADERS,
  });
  if (!response.ok) throw new Error(`Reading the Studio mode failed: ${response.status}`);
  const body = (await response.json()) as { mode: 'SIMPLE' | 'FULL' };
  return body.mode;
};

export const writeMode = async (mode: 'SIMPLE' | 'FULL'): Promise<void> => {
  const response = await fetch(`${API}/api/v1/authoring/document-studio/mode`, {
    method: 'PUT',
    headers: { ...HEADERS, 'content-type': 'application/json' },
    body: JSON.stringify({ mode }),
  });
  if (!response.ok) throw new Error(`Setting the Studio mode failed: ${response.status}`);
};
