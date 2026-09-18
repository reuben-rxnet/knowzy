// The policy engine's four layers — access-control.md §1.
//
// Each layer is failed in isolation from a passing baseline, so a test that
// passes proves that layer is the one doing the work.

import { describe, expect, it } from 'vitest';
import type { Subject } from '@knowzy/shared-types';
import { authorize, resolveDataScope } from './engine.js';

const author = (overrides: Partial<Subject> = {}): Subject => ({
  userId: '018f3c2a-7b1e-7c4d-9a2b-5e6f7a8b9c0d',
  entraObjectId: 'local-stub-author',
  displayName: 'Local Quiz Author',
  roles: ['AUTHOR'],
  permissions: ['source.read', 'document.browse', 'question.generate', 'question.read'],
  status: 'ACTIVE',
  authoringPortalAccess: true,
  livePortalAccess: false,
  domainIds: [],
  teamIds: [],
  allowSourceIds: [],
  denySourceIds: [],
  ...overrides,
});

describe('layer 1 — authentication', () => {
  it('denies with no subject', () => {
    const d = authorize({ subject: null, policy: 'source.read', portal: 'AUTHORING' });
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe('UNAUTHENTICATED');
  });

  it('denies a suspended account on the current request (S5)', () => {
    const d = authorize({
      subject: author({ status: 'SUSPENDED' }),
      policy: 'source.read',
      portal: 'AUTHORING',
    });
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.reason).toContain('SUSPENDED');
  });

  it('denies a deprovisioned account', () => {
    const d = authorize({
      subject: author({ status: 'DEPROVISIONED' }),
      policy: 'source.read',
      portal: 'AUTHORING',
    });
    expect(d.allowed).toBe(false);
  });
});

describe('layer 2 — portal access', () => {
  it('allows the baseline author on the authoring portal', () => {
    expect(
      authorize({ subject: author(), policy: 'source.read', portal: 'AUTHORING' }).allowed,
    ).toBe(true);
  });

  it('refuses an authoring policy from the LIVE portal even with the permission', () => {
    // E5: the learner-facing surface cannot reach an authoring policy at all.
    // This is the check that makes ADR-001's separation meaningful rather than
    // cosmetic.
    const d = authorize({
      subject: author({ livePortalAccess: true, permissions: ['source.read'] }),
      policy: 'source.read',
      portal: 'LIVE',
    });
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe('PORTAL_ACCESS_DENIED');
  });

  it('refuses a subject without access to the portal it is using', () => {
    const d = authorize({
      subject: author({ authoringPortalAccess: false }),
      policy: 'source.read',
      portal: 'AUTHORING',
    });
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe('PORTAL_ACCESS_DENIED');
  });
});

describe('layer 3 — permission', () => {
  it('denies a policy whose permission the subject lacks', () => {
    const d = authorize({ subject: author(), policy: 'question.approve', portal: 'AUTHORING' });
    expect(d.allowed).toBe(false);
    if (!d.allowed) {
      expect(d.code).toBe('FORBIDDEN');
      // Names the permission to request, not whether the resource exists.
      expect(d.reason).toContain('question.approve');
    }
  });

  it('allows once the permission is held', () => {
    const approver = author({
      roles: ['APPROVER'],
      permissions: ['question.approve', 'question.read'],
    });
    expect(
      authorize({ subject: approver, policy: 'question.approve', portal: 'AUTHORING' }).allowed,
    ).toBe(true);
  });
});

describe('layer 4 — data scope', () => {
  it('treats empty sets as UNRESTRICTED, not as nothing', () => {
    // The single most consequential rule in access-control.md §5. Getting it
    // backwards silently denies everything or grants everything.
    const scope = resolveDataScope(author());
    expect(scope.domainIds).toEqual([]);
    expect(scope.teamIds).toEqual([]);
    expect(scope.sourceIds).toEqual([]);
  });

  it('carries the subject id for own-scoped resources', () => {
    const subject = author();
    expect(resolveDataScope(subject).ownSubjectId).toBe(subject.userId);
  });

  it('returns a scope on allow, so the handler can thread it to the repository (P3)', () => {
    const d = authorize({ subject: author(), policy: 'source.read', portal: 'AUTHORING' });
    expect(d.allowed).toBe(true);
    if (d.allowed) expect(d.scope.ownSubjectId).toBe(author().userId);
  });

  it('preserves an explicit DENY so the predicate can apply it first', () => {
    const denied = author({ denySourceIds: ['018f3c2a-7b1e-7c4d-9a2b-000000000001'] });
    expect(resolveDataScope(denied).denySourceIds).toHaveLength(1);
  });
});

describe('evaluation order', () => {
  it('reports authentication before permission', () => {
    // Order matters: an unauthenticated caller must not learn which permission
    // a route needs.
    const d = authorize({ subject: null, policy: 'question.approve', portal: 'AUTHORING' });
    expect(d.allowed).toBe(false);
    if (!d.allowed) {
      expect(d.code).toBe('UNAUTHENTICATED');
      expect(d.reason).not.toContain('question.approve');
    }
  });

  it('reports portal access before permission', () => {
    const d = authorize({
      subject: author({ authoringPortalAccess: false }),
      policy: 'question.approve',
      portal: 'AUTHORING',
    });
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe('PORTAL_ACCESS_DENIED');
  });
});
