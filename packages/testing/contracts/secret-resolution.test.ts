// P-5 and OPENAI-CODEX-00 as build gates.
//
// Four properties that would otherwise be comments, each of which a future
// change could break without any behavioural test noticing:
//
//   1. OPENAI-CODEX-00 ENDS BEFORE GENERATION. The readiness client names no
//      endpoint that could generate: no completions, no responses, no chat.
//   2. A SECRET IS REVEALED IN ONE PLACE. `reveal()` is called by production
//      code only in the readiness client's Authorization header. A second call
//      site is a second place a key can escape, and it should be a decision.
//   3. NO AUDIT KEY CAN CARRY A SECRET. The allow-list entries for the secret
//      actions name fingerprints and sources, never a reference or a value.
//   4. THE STORE CANNOT BE COMMITTED OR SHIPPED. `.secrets/` is in .gitignore
//      and .dockerignore -- `COPY . .` in an image build would otherwise
//      carry it.

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..', '..', '..');

const productionSources = (): readonly string[] => {
  const out: string[] = [];
  for (const top of ['packages', 'apps']) {
    for (const entry of readdirSync(join(ROOT, top), { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !/\.(ts|tsx)$/.test(entry.name)) continue;
      const path = join(entry.parentPath, entry.name);
      const rel = relative(ROOT, path).replace(/\\/g, '/');
      if (/node_modules|\/dist\/|\.next\/|\.test\.|\/test\/|contracts\//.test(rel)) continue;
      out.push(rel);
    }
  }
  return out;
};

describe('OPENAI-CODEX-00 ends before generation', () => {
  const source = readFileSync(join(ROOT, 'packages/claude-services/src/openai.ts'), 'utf8');

  it('names no endpoint that could generate', () => {
    for (const forbidden of [
      '/chat/completions',
      '/completions',
      '/responses',
      '/embeddings',
      "method: 'POST'",
    ]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });

  it('calls only the two metadata paths', () => {
    const paths = [...source.matchAll(/get\(`?'?(\/[^`')]*)/g)].map((match) => match[1]);
    expect(paths.every((path) => path?.startsWith('/models'))).toBe(true);
    expect(paths.length).toBeGreaterThanOrEqual(2);
  });
});

describe('a secret is revealed in exactly one place', () => {
  it('calls reveal() only in the readiness client', () => {
    // A file can vanish between listing and reading: boundaries.test.ts plants
    // and removes a temporary violation file while the contract project runs.
    const read = (file: string): string => {
      try {
        return readFileSync(join(ROOT, file), 'utf8');
      } catch {
        return '';
      }
    };
    const callers = productionSources().filter((file) => /\.reveal\(\)/.test(read(file)));
    // TWO since OPENAI-CODEX-01: the readiness probe's Authorization header,
    // and the generation client's auth header. A third is a third place a key
    // can escape, and should be a decision taken here, not an accident.
    expect(callers.sort()).toEqual([
      'packages/claude-services/src/openai-generation.ts',
      'packages/claude-services/src/openai.ts',
    ]);
  });
});

describe('OPENAI-CODEX-01 generates through one endpoint, with no tools', () => {
  const source = readFileSync(
    join(ROOT, 'packages/claude-services/src/openai-generation.ts'),
    'utf8',
  );

  it('posts only to /responses or /chat/completions', () => {
    const paths = [...source.matchAll(/'(\/[a-z/_]+)'/g)].map((match) => match[1]);
    expect(paths.filter((path) => path !== undefined).sort()).toEqual([
      '/chat/completions',
      '/responses',
    ]);
    for (const forbidden of ['/embeddings', '/files', '/assistants', '/threads', '/fine_tuning']) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });

  it('grants no tools, stores nothing at the provider, and frames with the shared prompt', () => {
    expect(source).toContain('tools: GENERATION_TOOL_GRANT');
    expect(source).toContain('store: false');
    expect(source).toContain('frameGenerationPrompt(generateArgs)');
  });

  it('refuses redirects, like the readiness probe', () => {
    expect(source).toContain("redirect: 'error'");
  });
});

describe('no audit key can carry a secret', () => {
  const allowList = readFileSync(join(ROOT, 'packages/observability/src/audit.ts'), 'utf8');

  it('declares every P-5 action, with fingerprints and sources only', () => {
    for (const action of [
      'SECRET_REFERENCE_CREATED',
      'SECRET_REFERENCE_UPDATED',
      'SECRET_VALIDATED',
      'PROVIDER_ENABLED',
      'PROVIDER_DISABLED',
    ]) {
      const start = allowList.indexOf(`'ADMIN.CONFIGURATION.${action}'`);
      expect(start, action).toBeGreaterThan(-1);
      const entry = allowList.slice(start, allowList.indexOf(']', start));
      for (const forbidden of ['apiKeyRef', "'reference'", "'value'", "'secret'", "'apiKey'"]) {
        expect(entry, `${action} declares ${forbidden}`).not.toContain(forbidden);
      }
    }
  });
});

describe('the local secure store cannot be committed or shipped', () => {
  it.each(['.gitignore', '.dockerignore'])('%s ignores .secrets/', (file) => {
    expect(readFileSync(join(ROOT, file), 'utf8')).toMatch(/^\.secrets\/$/m);
  });
});
