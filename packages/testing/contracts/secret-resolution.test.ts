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
  it('calls reveal() only in the shared provider request builder', () => {
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
    // ONE since GATEWAY-M1 (it was two after OPENAI-CODEX-01, and the two had
    // drifted apart). Test connection and generation both send through
    // `providerFetch`, which reveals the key into the configured header OR
    // query parameter. A second file is a second place a key can escape, and
    // should be a decision taken here, not an accident.
    expect(callers.sort()).toEqual(['packages/claude-services/src/provider-request.ts']);
  });
});

describe('GATEWAY-M1: one request builder, and the key never leaves it', () => {
  const source = readFileSync(
    join(ROOT, 'packages/claude-services/src/provider-request.ts'),
    'utf8',
  );
  const readiness = readFileSync(join(ROOT, 'packages/claude-services/src/openai.ts'), 'utf8');
  const generation = readFileSync(
    join(ROOT, 'packages/claude-services/src/openai-generation.ts'),
    'utf8',
  );

  it('refuses redirects for every request it sends', () => {
    expect(source).toContain("redirect: 'error'");
  });

  it('logs nothing and returns only the Response -- never the URL it built', () => {
    for (const forbidden of ['console.', 'logger', 'process.stdout', 'process.stderr']) {
      expect(source, forbidden).not.toContain(forbidden);
    }
    // The signature: providerFetch resolves to a Response, nothing else.
    expect(source).toMatch(/export const providerFetch = \([\s\S]*?\): Promise<Response> =>/);
  });

  it('is the only way either client reaches a provider', () => {
    expect(readiness).toContain('providerFetch(');
    expect(generation).toContain('providerFetch(');
    for (const client of [readiness, generation]) {
      expect(client).not.toMatch(/\(args\.fetch \?\? fetch\)\(/);
      expect(client).not.toMatch(/(^|[^A-Za-z])doFetch\(/);
    }
  });

  it('keeps Test connection to GET', () => {
    expect(readiness).toContain("method: 'GET'");
    expect(readiness).not.toContain("method: 'POST'");
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

  it('sends through the shared builder, which refuses redirects', () => {
    expect(source).toContain('providerFetch(');
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
