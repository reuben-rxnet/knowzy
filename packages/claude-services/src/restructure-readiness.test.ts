import { describe, expect, it } from 'vitest';
import {
  evaluateRestructureReadiness,
  restructureCapability,
  RESTRUCTURING_CLIENTS,
} from './restructure-readiness.js';

const APPROVAL = {
  reference: 'CP-5 decision, Privacy, 2026-10-07',
  approvedByUserId: '00000000-0000-7000-8000-000000000001',
  approvedByDisplayName: 'Local Authoring Administrator',
  approvedAt: '2026-10-07T09:00:00.000Z',
};
const AT = '2026-10-07T09:00:00.000Z';

describe('evaluateRestructureReadiness', () => {
  it('reads BLOCKED_BY_APPROVAL with no restructuring approval -- the shipped state', () => {
    const status = evaluateRestructureReadiness({
      approvals: {},
      configured: () => true,
      evaluatedAt: AT,
    });
    expect(status.state).toBe('BLOCKED_BY_APPROVAL');
    expect(status.transformationImplemented).toBe(false);
    expect(status.providers.find((row) => row.providerId === 'OPENAI')?.state).toBe(
      'BLOCKED_BY_APPROVAL',
    );
  });

  it('moves to NOT_BUILT once approved, because no restructuring client exists', () => {
    const status = evaluateRestructureReadiness({
      approvals: { OPENAI: APPROVAL },
      configured: () => true,
      evaluatedAt: AT,
    });
    expect(status.state).toBe('NOT_BUILT');
    const openai = status.providers.find((row) => row.providerId === 'OPENAI');
    expect(openai?.state).toBe('NOT_BUILT');
    expect(openai?.reason).toMatch(/not yet implemented/);
  });

  it('can never read READY on this release: the client registry is empty', () => {
    expect(RESTRUCTURING_CLIENTS).toEqual([]);
    const everything = evaluateRestructureReadiness({
      approvals: { OPENAI: APPROVAL, ANTHROPIC: APPROVAL, AZURE_OPENAI: APPROVAL },
      configured: () => true,
      evaluatedAt: AT,
    });
    expect(everything.state).not.toBe('READY');
    expect(everything.providers.some((row) => row.state === 'READY')).toBe(false);
  });

  it('reaches READY only through a registered client AND configuration', () => {
    const withClient = (configured: boolean) =>
      evaluateRestructureReadiness({
        approvals: { OPENAI: APPROVAL },
        configured: () => configured,
        clients: ['OPENAI'],
        evaluatedAt: AT,
      });
    expect(withClient(false).state).toBe('NOT_BUILT');
    expect(withClient(true).state).toBe('READY');
  });

  it('lists ineligible providers with their reason and no state', () => {
    for (const providerId of ['DETERMINISTIC_LOCAL', 'MICROSOFT_COPILOT'] as const) {
      expect(restructureCapability(providerId).capable).toBe(false);
      const row = evaluateRestructureReadiness({
        approvals: { [providerId]: APPROVAL },
        configured: () => true,
        evaluatedAt: AT,
      }).providers.find((candidate) => candidate.providerId === providerId);
      expect(row?.state).toBeNull();
      expect(row?.capable).toBe(false);
    }
  });
});
