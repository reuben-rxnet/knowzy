// Registry completeness — repository-structure.md §5.3 G3–G6, and the
// read-only guarantee in access-control.md §2 rule 4.
//
// These are the assertions that make a catalogue a contract rather than a list.

import { describe, expect, it } from 'vitest';
import {
  AUDIT_ACTIONS,
  AUDIT_FAMILIES,
  AUDIT_FAMILY_KEYS,
  ERROR_CATEGORIES,
  ERROR_CODES,
  ERROR_REGISTRY,
  PERMISSION_KEYS,
  ROLE_DEFINITIONS,
  ROLE_DEFINITION_BY_KEY,
  ROLE_KEYS,
  WRITE_PERMISSION_KEYS,
  auditCategoryOf,
  auditFamilyOf,
  permissionFamily,
  type PermissionKey,
} from '@knowzy/shared-types';
import {
  CONFIG_KEYS,
  CONFIG_KEY_LIST,
  FEATURE_FLAGS,
  FEATURE_FLAG_KEYS,
  ceilingPermits,
} from '@knowzy/configuration';

// ---------------------------------------------------------------------------
// G3 — every error code has exactly one category, status, and default message
// ---------------------------------------------------------------------------

describe('error code registry (G3)', () => {
  it('declares every code exactly once with a category, status, and message', () => {
    expect(ERROR_CODES.length).toBeGreaterThan(0);
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);

    for (const code of ERROR_CODES) {
      const d = ERROR_REGISTRY[code];
      expect(ERROR_CATEGORIES, code).toContain(d.category);
      expect(d.status, code).toBeGreaterThanOrEqual(200);
      expect(d.status, code).toBeLessThan(600);
      expect(d.message.trim().length, code).toBeGreaterThan(0);
      expect(typeof d.retryable, code).toBe('boolean');
    }
  });

  it('uses SCREAMING_SNAKE_CASE codes (E1)', () => {
    for (const code of ERROR_CODES) {
      expect(code, code).toMatch(/^[A-Z][A-Z0-9_]*$/);
    }
  });

  it('carries no dynamic content in a code (E7)', () => {
    for (const code of ERROR_CODES) {
      expect(code, code).not.toMatch(/\{|\}|\$/);
    }
  });

  it('maps each category to a plausible status class (E2)', () => {
    const expected: Record<string, number[]> = {
      AUTHENTICATION: [401],
      AUTHORIZATION: [403],
      NOT_FOUND: [404],
      VALIDATION: [400, 422],
      CONFLICT: [409],
      CONFIGURATION: [422, 503],
      THROTTLED: [429],
      // DEPENDENCY_DEGRADED is a 200 carrying a degradation marker (§5.2).
      UPSTREAM: [200, 502, 503, 504],
      INTERNAL: [500],
    };
    for (const code of ERROR_CODES) {
      const d = ERROR_REGISTRY[code];
      expect(expected[d.category], `${code} (${d.category})`).toContain(d.status);
    }
  });

  it('marks throttled and upstream codes retryable, and authorization codes not', () => {
    for (const code of ERROR_CODES) {
      const d = ERROR_REGISTRY[code];
      if (d.category === 'THROTTLED') expect(d.retryable, code).toBe(true);
      if (d.category === 'AUTHORIZATION') expect(d.retryable, code).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Permission and role catalogue — access-control.md §2, §4.1
// ---------------------------------------------------------------------------

describe('permission and role catalogue', () => {
  it('declares a closed, unique permission union (§4.3 P6)', () => {
    expect(new Set(PERMISSION_KEYS).size).toBe(PERMISSION_KEYS.length);
    for (const key of PERMISSION_KEYS) {
      expect(key, key).toMatch(/^[a-z][a-z.]*[a-z]$/);
      expect(permissionFamily(key).length, key).toBeGreaterThan(0);
    }
  });

  it('grants every role only declared permissions', () => {
    const declared = new Set<string>(PERMISSION_KEYS);
    for (const role of ROLE_DEFINITIONS) {
      for (const permission of role.permissions) {
        expect(declared.has(permission), `${role.key} -> ${permission}`).toBe(true);
      }
    }
  });

  it('defines every role key exactly once', () => {
    expect(new Set(ROLE_KEYS).size).toBe(ROLE_KEYS.length);
    expect(ROLE_DEFINITIONS).toHaveLength(ROLE_KEYS.length);
    for (const key of ROLE_KEYS) {
      expect(ROLE_DEFINITION_BY_KEY[key].key).toBe(key);
    }
  });

  it('keeps AUDITOR read-only: the set contains no write key (§2 rule 4)', () => {
    const auditor = ROLE_DEFINITION_BY_KEY.AUDITOR;
    const writeKeys = new Set<PermissionKey>(WRITE_PERMISSION_KEYS);
    const offenders = auditor.permissions.filter((p) => writeKeys.has(p));
    expect(offenders).toEqual([]);
  });

  it('grants no role both question.approve and question.publish by default (§2 rule 3)', () => {
    for (const role of ROLE_DEFINITIONS) {
      const hasApprove = role.permissions.includes('question.approve');
      const hasPublish = role.permissions.includes('question.publish');
      expect(hasApprove && hasPublish, role.key).toBe(false);
    }
  });

  it('makes LEARNER the only LIVE-scoped role, with own-scoped permissions only (§2 rule 5)', () => {
    const live = ROLE_DEFINITIONS.filter((r) => r.portalScope === 'LIVE');
    expect(live.map((r) => r.key)).toEqual(['LEARNER']);

    for (const permission of ROLE_DEFINITION_BY_KEY.LEARNER.permissions) {
      expect(permission, permission).toMatch(/^learning\./);
    }
    // learning.result.team is a MANAGER capability, not a learner one.
    expect(ROLE_DEFINITION_BY_KEY.LEARNER.permissions).not.toContain('learning.result.team');
  });

  it('gives every authoring role the shell permission it needs to reach a route', () => {
    for (const role of ROLE_DEFINITIONS) {
      if (role.portalScope === 'LIVE') continue;
      expect(role.permissions, role.key).toContain('authoring.dashboard.view');
    }
  });
});

// ---------------------------------------------------------------------------
// Audit taxonomy — audit-model.md §2
// ---------------------------------------------------------------------------

describe('audit taxonomy', () => {
  it('declares 28 families across five prefixes', () => {
    expect(AUDIT_FAMILY_KEYS).toHaveLength(28);
    const prefixes = new Set(AUDIT_FAMILY_KEYS.map((f) => f.split('.')[0]));
    expect([...prefixes].sort()).toEqual([
      'ADMIN',
      'AUTHORING',
      'LEARNING',
      'PLATFORM',
      'REPORT',
    ]);
  });

  it('derives family and category from an action consistently', () => {
    for (const action of AUDIT_ACTIONS) {
      const family = auditFamilyOf(action);
      expect(AUDIT_FAMILY_KEYS, action).toContain(family);
      expect(action.startsWith(`${family}.`), action).toBe(true);
      expect(auditCategoryOf(action), action).toBe(family.split('.')[0]);
    }
  });

  it('declares every action exactly once', () => {
    expect(new Set(AUDIT_ACTIONS).size).toBe(AUDIT_ACTIONS.length);
  });

  it('gives every family at least one action', () => {
    for (const family of AUDIT_FAMILY_KEYS) {
      expect(AUDIT_FAMILIES[family].length, family).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Configuration and flags — environment-and-configuration.md §3.2, §6.2
// ---------------------------------------------------------------------------

describe('configuration catalogue (P1, P2)', () => {
  it('declares every key with a description, layers, scopes, and a valid default', () => {
    expect(CONFIG_KEY_LIST.length).toBeGreaterThan(0);
    for (const key of CONFIG_KEY_LIST) {
      const d = CONFIG_KEYS[key];
      expect(d.key, key).toBe(key);
      expect(d.description.trim().length, key).toBeGreaterThan(0);
      expect(d.layers.length, key).toBeGreaterThan(0);
      expect(d.scopes.length, key).toBeGreaterThan(0);
      // P2: a default that fails its own schema is a code defect, and startup
      // check 9 treats it as fatal.
      expect(d.schema.safeParse(d.defaultValue).success, key).toBe(true);
    }
  });

  it('always permits the CODE_DEFAULT layer, so every key resolves', () => {
    for (const key of CONFIG_KEY_LIST) {
      expect(CONFIG_KEYS[key].layers, key).toContain('CODE_DEFAULT');
    }
  });

  it('keeps the duplicate flag threshold below the block threshold', () => {
    // A flag threshold above the block threshold would make the flag band
    // empty, silently disabling reviewer disposition.
    expect(CONFIG_KEYS['duplicate.flagThreshold'].defaultValue).toBeLessThan(
      CONFIG_KEYS['duplicate.blockThreshold'].defaultValue,
    );
  });

  it('ships contiguous proficiency bands covering 0–100 exactly (I11)', () => {
    const bands = [...CONFIG_KEYS['proficiency.thresholds'].defaultValue].sort(
      (a, b) => a.minInclusive - b.minInclusive,
    );
    expect(bands[0]?.minInclusive).toBe(0);
    for (let i = 1; i < bands.length; i += 1) {
      expect(bands[i]?.minInclusive, `band ${i}`).toBe(bands[i - 1]?.maxExclusive);
    }
    // The top band must include 100 itself, which is why its upper bound is
    // exclusive at just above 100.
    expect(bands[bands.length - 1]?.maxExclusive).toBeGreaterThan(100);
  });
});

describe('feature flag catalogue (F1, F6)', () => {
  it('declares every flag with an owner and a described off-state', () => {
    for (const key of FEATURE_FLAG_KEYS) {
      const d = FEATURE_FLAGS[key];
      expect(d.key, key).toBe(key);
      expect(d.owner.trim().length, key).toBeGreaterThan(0);
      // F1: a flag whose off-state behaviour is undefined is not permitted.
      expect(d.whenOff.trim().length, key).toBeGreaterThan(10);
    }
  });

  it('keeps unimplemented features unreachable in every environment (F6)', () => {
    const notImplemented = FEATURE_FLAG_KEYS.filter((k) => FEATURE_FLAGS[k].ceiling === 'none');
    expect(notImplemented.length).toBeGreaterThan(0);
    for (const key of notImplemented) {
      for (const env of ['local', 'dev', 'test', 'prod'] as const) {
        expect(ceilingPermits(key, env), `${key} in ${env}`).toBe(false);
      }
    }
  });

  it('defaults SharePoint writes off and forbids them in dev (V3)', () => {
    expect(FEATURE_FLAGS['sharepoint.write.enabled'].defaultEnabled).toBe(false);
    expect(ceilingPermits('sharepoint.write.enabled', 'local')).toBe(false);
    expect(ceilingPermits('sharepoint.write.enabled', 'dev')).toBe(false);
    expect(ceilingPermits('sharepoint.write.enabled', 'prod')).toBe(true);
  });

  it('defaults break-glass and two-person admin grants off', () => {
    expect(FEATURE_FLAGS['approval.breakGlass.enabled'].defaultEnabled).toBe(false);
    expect(FEATURE_FLAGS['access.requireTwoPersonAdminGrant'].defaultEnabled).toBe(false);
  });
});
