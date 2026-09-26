// The provider registry: the states, and the order they are decided in.
//
// The order IS the policy (see `decideState`), so it is asserted directly: a
// provider that can never ground a question must not be reported as merely
// unapproved, because that sends somebody to get an approval for a use the
// provider cannot satisfy.

import { describe, expect, it } from 'vitest';
import { createGeneratorRegistry, ProviderRefusedError } from './registry.js';
import { createDeterministicProvider } from './provider.js';

const registry = (overrides: Partial<Parameters<typeof createGeneratorRegistry>[0]> = {}) =>
  createGeneratorRegistry({
    activeProvider: 'DETERMINISTIC_LOCAL',
    approvedProviders: ['DETERMINISTIC_LOCAL'],
    ...overrides,
  });

describe('state resolution', () => {
  it('the deterministic provider is AVAILABLE with nothing configured', () => {
    // The zero-credential path. It is registered in every environment, forever.
    expect(registry().assess('DETERMINISTIC_LOCAL').state).toBe('AVAILABLE');
  });

  it('a provider with no client is UNAVAILABLE, and the reason says why', () => {
    const assessment = registry({ approvedProviders: ['DETERMINISTIC_LOCAL', 'OPENAI'] }).assess(
      'OPENAI',
    );
    expect(assessment.state).toBe('UNAVAILABLE');
    expect(assessment.reason).toContain('implemented in this build');
    expect(assessment.registered).toBe(false);
  });

  it('an unapproved provider is BLOCKED_BY_APPROVAL, even with a client', () => {
    // This is how a data-processing approval becomes a control rather than a
    // promise: a credential is not enough.
    const assessment = registry({
      factories: { OPENAI: (modelId) => ({ ...createDeterministicProvider(), modelId }) },
      enabled: { OPENAI: true },
    }).assess('OPENAI');
    expect(assessment.state).toBe('BLOCKED_BY_APPROVAL');
    expect(assessment.approved).toBe(false);
    expect(assessment.reason).toContain('llm.approvedProviders');
  });

  it('a provider that retrieves its own context is BLOCKED_BY_CAPABILITY FIRST', () => {
    // Approved, and still blocked — and blocked by capability rather than by
    // approval, because no approval can make it grounding-safe.
    const assessment = registry({
      approvedProviders: ['DETERMINISTIC_LOCAL', 'MICROSOFT_COPILOT'],
      factories: {
        MICROSOFT_COPILOT: (modelId) => ({ ...createDeterministicProvider(), modelId }),
      },
    }).assess('MICROSOFT_COPILOT');
    expect(assessment.state).toBe('BLOCKED_BY_CAPABILITY');
    expect(assessment.groundingSafe).toBe(false);
  });

  it('a registered, approved provider with an unresolvable credential is BLOCKED_BY_CONFIGURATION', () => {
    // `enabled` is set, because the administrator's own decision is checked
    // FIRST within the configuration step: without it the reason would be
    // "nobody enabled this", which is true but not what this test is about.
    const assessment = registry({
      approvedProviders: ['DETERMINISTIC_LOCAL', 'ANTHROPIC'],
      factories: { ANTHROPIC: (modelId) => ({ ...createDeterministicProvider(), modelId }) },
      enabled: { ANTHROPIC: true },
      credentialPresent: { ANTHROPIC: false },
    }).assess('ANTHROPIC');
    expect(assessment.state).toBe('BLOCKED_BY_CONFIGURATION');
    expect(assessment.reason).toContain('credential');
  });

  it('a provider NOBODY ENABLED is BLOCKED_BY_CONFIGURATION, even fully credentialled', () => {
    // The gate that exists so a credential appearing in the environment cannot
    // start a provider billing. "Not decided" is not "on".
    const assessment = registry({
      approvedProviders: ['DETERMINISTIC_LOCAL', 'ANTHROPIC'],
      factories: { ANTHROPIC: (modelId) => ({ ...createDeterministicProvider(), modelId }) },
      credentialPresent: { ANTHROPIC: true },
    }).assess('ANTHROPIC');
    expect(assessment.state).toBe('BLOCKED_BY_CONFIGURATION');
    expect(assessment.reason).toContain('not been enabled');
  });

  it('an EXPLICITLY disabled provider says so, rather than blaming its credential', () => {
    const assessment = registry({
      approvedProviders: ['DETERMINISTIC_LOCAL', 'ANTHROPIC'],
      factories: { ANTHROPIC: (modelId) => ({ ...createDeterministicProvider(), modelId }) },
      enabled: { ANTHROPIC: false },
      credentialPresent: { ANTHROPIC: false },
    }).assess('ANTHROPIC');
    expect(assessment.state).toBe('BLOCKED_BY_CONFIGURATION');
    expect(assessment.reason).toContain('disabled');
  });

  it('the deterministic provider CANNOT be disabled', () => {
    // It is the floor: there is no configuration in which the platform has no
    // generator at all, so `enabled: false` is ignored for this one alone.
    expect(
      registry({ enabled: { DETERMINISTIC_LOCAL: false } }).assess('DETERMINISTIC_LOCAL').state,
    ).toBe('AVAILABLE');
  });

  it('describes EVERY declared provider, including the unusable ones', () => {
    // The unusable ones are the point: a page that hides them cannot explain
    // why the platform will not use them.
    const described = registry().describe();
    expect(described.length).toBeGreaterThanOrEqual(6);
    expect(described.map((row) => row.providerId)).toContain('MICROSOFT_COPILOT');
    expect(described.every((row) => row.reason.length > 0)).toBe(true);
  });

  it('claims no provider version until one has actually reported it', () => {
    expect(registry().assess('ANTHROPIC').providerVersion).toBeNull();
  });
});

describe('forJob', () => {
  it('returns the deterministic provider for a platform-managed job', () => {
    const provider = registry().forJob({
      executionMode: 'PLATFORM_MANAGED',
      modelId: 'knowzy-deterministic-local-1',
    });
    expect(provider.providerId).toBe('DETERMINISTIC_LOCAL');
  });

  it('refuses an unsupported execution mode without substituting one', () => {
    let thrown: unknown;
    try {
      registry().forJob({ executionMode: 'USER_MANAGED', modelId: 'x' });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ProviderRefusedError);
    expect((thrown as ProviderRefusedError).refusalReason).toBe('EXECUTION_MODE_UNSUPPORTED');
    expect((thrown as ProviderRefusedError).code).toBe('PROVIDER_MODE_NOT_SUPPORTED');
  });

  it('refuses an unapproved provider with the approval code, not a generic one', () => {
    let thrown: unknown;
    try {
      registry({ activeProvider: 'OPENAI' }).forJob({
        executionMode: 'PLATFORM_MANAGED',
        modelId: 'gpt-5-codex',
      });
    } catch (error) {
      thrown = error;
    }
    expect((thrown as ProviderRefusedError).code).toBe('PROVIDER_NOT_APPROVED');
  });

  it('NEVER falls back to another provider', () => {
    // The whole reason the registry exists. A substitution would make the
    // provenance recorded on the job false.
    const result = (() => {
      try {
        return registry({ activeProvider: 'GEMINI' }).forJob({
          executionMode: 'PLATFORM_MANAGED',
          modelId: 'gemini-2',
        });
      } catch (error) {
        return error;
      }
    })();
    expect(result).toBeInstanceOf(ProviderRefusedError);
  });

  it('cannot have the deterministic provider displaced by a passed factory', () => {
    // architecture.md §9.0 rule 5: it stays registered in every environment,
    // forever. Merged UNDER the caller's factories so this is structural.
    const custom = registry({
      factories: { ANTHROPIC: (modelId) => ({ ...createDeterministicProvider(), modelId }) },
    });
    expect(custom.assess('DETERMINISTIC_LOCAL').registered).toBe(true);
  });
});
