// Local-root validation — the security-relevant half of source registration.
//
// "Register a source" names a directory the service will read. Without this
// check it is a directory-traversal primitive with a form in front of it, so
// the tests here are adversarial rather than illustrative: each one is a way
// somebody would try to escape the allow-list.

import { describe, expect, it } from 'vitest';
import {
  isWithinRoot,
  requireAllowedLocalRoot,
  SourceAdminError,
} from './source-administration.js';

const ROOTS = ['/corpus', '/srv/knowzy/drop'];

describe('isWithinRoot', () => {
  it('accepts the root itself and anything under it', () => {
    expect(isWithinRoot('/corpus', '/corpus')).toBe(true);
    expect(isWithinRoot('/corpus/SOPs', '/corpus')).toBe(true);
    expect(isWithinRoot('/corpus/SOPs/2026', '/corpus')).toBe(true);
  });

  it('REFUSES a sibling whose name merely starts with the root', () => {
    // The string version of this check is the classic mistake:
    // '/corpus-secrets'.startsWith('/corpus') is true, and it must not be.
    expect(isWithinRoot('/corpus-secrets', '/corpus')).toBe(false);
    expect(isWithinRoot('/corpusx/data', '/corpus')).toBe(false);
  });

  it('refuses a parent of the root', () => {
    expect(isWithinRoot('/', '/corpus')).toBe(false);
    expect(isWithinRoot('/srv', '/srv/knowzy/drop')).toBe(false);
  });

  it('treats a trailing separator and a backslash as the same path', () => {
    expect(isWithinRoot('/corpus/SOPs/', '/corpus')).toBe(true);
    expect(isWithinRoot('C:\\data\\drop', 'C:/data')).toBe(true);
  });

  it('refuses an empty root rather than accepting everything', () => {
    // An empty root would make every candidate "inside" it, which is the
    // failure that turns an allow-list into a no-op.
    expect(isWithinRoot('/anything', '')).toBe(false);
  });
});

describe('requireAllowedLocalRoot', () => {
  it('accepts a path inside an allowed root and returns it unchanged', () => {
    expect(requireAllowedLocalRoot('/corpus/SOPs', ROOTS)).toBe('/corpus/SOPs');
  });

  it('refuses traversal outright, before any allow-list comparison', () => {
    for (const path of ['/corpus/../etc', '/corpus/SOPs/../../root', '/..']) {
      expect(() => requireAllowedLocalRoot(path, ROOTS), path).toThrow(/may not contain/);
    }
  });

  it('refuses a relative path, naming why', () => {
    expect(() => requireAllowedLocalRoot('corpus/SOPs', ROOTS)).toThrow(/must be absolute/);
    expect(() => requireAllowedLocalRoot('./drop', ROOTS)).toThrow(/must be absolute/);
  });

  it('refuses a null byte', () => {
    expect(() => requireAllowedLocalRoot('/corpus/SOPs\u0000.txt', ROOTS)).toThrow(/null byte/);
  });

  it('refuses anything outside the allow-list, and names the allowed roots', () => {
    let thrown: unknown;
    try {
      requireAllowedLocalRoot('/etc', ROOTS);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(SourceAdminError);
    expect((thrown as SourceAdminError).code).toBe('SOURCE_FORBIDDEN');
    expect((thrown as Error).message).toContain('/corpus');
  });

  it('refuses EVERYTHING when no root is configured', () => {
    // The safe default: a deployment that declares no roots cannot register a
    // local source at all. The opposite default would make an unconfigured
    // environment the most permissive one.
    let thrown: unknown;
    try {
      requireAllowedLocalRoot('/corpus/SOPs', []);
    } catch (error) {
      thrown = error;
    }
    expect((thrown as SourceAdminError).code).toBe('SOURCE_NOT_CONFIGURED');
  });

  it('refuses an empty path with a message about what is needed', () => {
    expect(() => requireAllowedLocalRoot('   ', ROOTS)).toThrow(/needs a root path/);
  });
});
