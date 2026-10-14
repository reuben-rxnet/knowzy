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
    // M3 built the OpenAI client; the approval is what still blocks it.
    expect(status.transformationImplemented).toBe(true);
    expect(status.providers.find((row) => row.providerId === 'OPENAI')?.state).toBe(
      'BLOCKED_BY_APPROVAL',
    );
  });

  it('reads READY for OpenAI only once approved AND configured (M3)', () => {
    const approved = (configured: boolean) =>
      evaluateRestructureReadiness({
        approvals: { OPENAI: APPROVAL },
        configured: () => configured,
        evaluatedAt: AT,
      });
    expect(approved(false).providers.find((row) => row.providerId === 'OPENAI')?.state).toBe(
      'NOT_BUILT',
    );
    expect(approved(true).state).toBe('READY');
  });

  it('keeps an approved provider with no client at NOT_BUILT', () => {
    expect(RESTRUCTURING_CLIENTS).toEqual(['OPENAI']);
    const status = evaluateRestructureReadiness({
      approvals: { ANTHROPIC: APPROVAL, AZURE_OPENAI: APPROVAL },
      configured: () => true,
      evaluatedAt: AT,
    });
    expect(status.state).toBe('NOT_BUILT');
    expect(status.providers.some((row) => row.state === 'READY')).toBe(false);
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
