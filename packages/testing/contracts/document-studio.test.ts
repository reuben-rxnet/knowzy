// AI Document Studio, Slice 2 -- the guarantees that make the overview honest
// (docs/competencies/AI_DOCUMENT_STUDIO_ARCHITECTURE.md §10).
//
//   1. THE PURPOSES ARE SEPARATE, in both directions: the Studio never reads a
//      question-generation approval, and the generation path never reads a
//      restructuring approval.
//   2. NOTHING TRANSFORMS: the restructuring-client registry is empty, so READY
//      is unreachable, and the Studio's routes are a status read and an
//      approval write -- nothing that runs, transforms, rewrites or prepares.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { evaluateRestructureReadiness, RESTRUCTURING_CLIENTS } from '@knowzy/claude-services';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const codeOf = (...segments: readonly string[]): string =>
  readFileSync(join(REPO_ROOT, ...segments), 'utf8')
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
    .join('\n');

const STUDIO_FILES = [
  ['packages', 'domain', 'src', 'generation', 'control', 'document-studio.ts'],
  ['packages', 'claude-services', 'src', 'restructure-readiness.ts'],
  ['apps', 'api', 'src', 'routes', 'document-studio.ts'],
] as const;

const GENERATION_APPROVAL_READERS = [
  ['packages', 'claude-services', 'src', 'registry.ts'],
  ['packages', 'configuration', 'src', 'generation-control-settings.ts'],
  ['packages', 'domain', 'src', 'generation', 'control', 'provider-administration.ts'],
] as const;

describe('AI Document Studio: purposes are separate', () => {
  it('the Studio never reads a question-generation approval', () => {
    for (const file of STUDIO_FILES) {
      expect(codeOf(...file), file.join('/')).not.toMatch(/approvedProviders/);
    }
  });

  it('the generation path never reads a restructuring approval', () => {
    for (const file of GENERATION_APPROVAL_READERS) {
      expect(codeOf(...file), file.join('/')).not.toMatch(/purposeApprovals|DOCUMENT_RESTRUCTURE/);
    }
  });
});

describe('AI Document Studio: nothing transforms', () => {
  it('registers no restructuring client, so no provider can read READY', () => {
    expect(RESTRUCTURING_CLIENTS).toEqual([]);
    const status = evaluateRestructureReadiness({
      approvals: {
        OPENAI: {
          reference: 'contract test',
          approvedByUserId: '00000000-0000-7000-8000-000000000001',
          approvedByDisplayName: 'contract',
          approvedAt: '2026-10-07T00:00:00.000Z',
        },
      },
      configured: () => true,
      evaluatedAt: '2026-10-07T00:00:00.000Z',
    });
    expect(status.state).toBe('NOT_BUILT');
    expect(status.transformationImplemented).toBe(false);
  });

  it('exposes only a status read and an approval write', () => {
    const routes = codeOf('apps', 'api', 'src', 'routes', 'document-studio.ts');
    const urls = [...routes.matchAll(/url: '([^']+)'/g)].map((match) => match[1]);
    expect(urls).toEqual([
      '/api/v1/authoring/document-studio/status',
      '/api/v1/authoring/document-studio/approvals/:providerId',
    ]);
    for (const url of urls) expect(url).not.toMatch(/transform|rewrite|prepare|run/i);
  });
});
