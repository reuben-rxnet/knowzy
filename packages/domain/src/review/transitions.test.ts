// What the screen is allowed to offer, per state and per identity.
//
// These tests exist because of a real misreading. An identity holding all 47
// permissions pressed **Submit for approval** on a DRAFT, was told
// `STATE_TRANSITION_INVALID`, and concluded the role was missing access. It
// was not: a draft has to be CLAIMED first. The state machine knew that all
// along, and the only reason the screen offered the press was that nobody had
// asked it what was reachable.
//
// So the property under test is narrow and worth guarding: what comes back is
// derived from `TRANSITIONS`, it separates a STATE block from a PERMISSION
// block, and it never invents a transition that is not declared.

import { describe, expect, it } from 'vitest';
import { TRANSITIONS, availableTransitions } from './transitions.js';

const ALL = TRANSITIONS.map((rule) => rule.permission).filter(
  (permission): permission is NonNullable<typeof permission> => permission !== null,
);

describe('availableTransitions', () => {
  it('offers only CLAIM from DRAFT, whatever the caller holds', () => {
    // The exact case that was misread. A DRAFT reaches one state, and it is
    // not SUBMITTED_FOR_APPROVAL.
    const available = availableTransitions('DRAFT', ALL);
    expect(available.map((entry) => entry.to)).toEqual(['AUTHOR_REVIEW']);
    expect(available.every((entry) => entry.permitted)).toBe(true);
  });

  it('does not offer APPROVED from DRAFT even to an identity holding every permission', () => {
    expect(availableTransitions('DRAFT', ALL).some((entry) => entry.to === 'APPROVED')).toBe(false);
  });

  it('separates a permission block from a state block', () => {
    // SUBMITTED_FOR_APPROVAL can reach APPROVED, so the transition is
    // DECLARED and appears — but unpermitted for a caller without
    // question.approve. The two blocks need different responses from the
    // person reading them: one is an order of operations, the other is an
    // identity that cannot take the decision at all.
    const readOnly = availableTransitions('SUBMITTED_FOR_APPROVAL', ['question.read']);
    const approve = readOnly.find((entry) => entry.to === 'APPROVED');
    expect(approve).toBeDefined();
    expect(approve?.permitted).toBe(false);
    expect(approve?.permission).toBe('question.approve');
  });

  it('marks a platform transition permitted with no permission at all', () => {
    // GENERATED -> DRAFT is performed by the platform, not a user, and carries
    // a null permission. An empty permission set must not turn that into a
    // refusal the screen reports against somebody's identity.
    const automatic = availableTransitions('GENERATED', []);
    expect(automatic).toHaveLength(1);
    expect(automatic[0]?.permission).toBeNull();
    expect(automatic[0]?.permitted).toBe(true);
  });

  it('returns nothing from a terminal state', () => {
    expect(availableTransitions('ARCHIVED', ALL)).toEqual([]);
  });

  it('is exactly the declared table, for every state', () => {
    // The guard that keeps this derived rather than restated: add a transition
    // and the screen gains it without a second edit; hardcode one here and
    // this fails.
    for (const rule of TRANSITIONS) {
      const available = availableTransitions(rule.from, ALL);
      expect(
        available.map((entry) => entry.to),
        `from ${rule.from}`,
      ).toEqual(TRANSITIONS.filter((candidate) => candidate.from === rule.from).map((c) => c.to));
    }
  });

  it('carries the comment requirement, so a screen cannot ask for the wrong thing', () => {
    const rejecting = availableTransitions('SUBMITTED_FOR_APPROVAL', ALL).find(
      (entry) => entry.to === 'REJECTED',
    );
    expect(rejecting?.commentRequired).toBe(true);
    const claiming = availableTransitions('DRAFT', ALL).find(
      (entry) => entry.to === 'AUTHOR_REVIEW',
    );
    expect(claiming?.commentRequired).toBe(false);
  });
});
