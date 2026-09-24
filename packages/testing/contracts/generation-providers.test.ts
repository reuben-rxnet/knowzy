// Provider framework gates — MULTI_PROVIDER_GENERATION_ARCHITECTURE.md §1, §9.
//
// These assert the two properties that make a provider registry safe rather
// than merely flexible: capabilities are declared honestly, and a provider
// choice cannot reach anything downstream of the draft.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PROVIDER_CATALOGUE,
  createDeterministicProvider,
  isGroundingSafe,
} from '@knowzy/claude-services';
import { GENERATION_EXECUTION_MODE, GENERATION_PROVIDER } from '@knowzy/shared-types';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const codeOf = (...segments: readonly string[]): string =>
  readFileSync(join(REPO_ROOT, ...segments), 'utf8')
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
    .join('\n');

describe('the provider catalogue is complete and honest', () => {
  it('declares capabilities for every provider in the enum', () => {
    // A provider in the enum but absent from the catalogue could not produce a
    // refusal that explains itself, which is the whole point of separating
    // declaration from registration.
    for (const providerId of GENERATION_PROVIDER) {
      expect(PROVIDER_CATALOGUE[providerId], providerId).toBeDefined();
    }
    expect(Object.keys(PROVIDER_CATALOGUE).sort()).toEqual([...GENERATION_PROVIDER].sort());
  });

  it('grants no provider any tools', () => {
    // `framing.ts` grants none, so an injected "call this tool" has nothing to
    // call. Typed `false`, asserted here so a widening is caught.
    for (const providerId of GENERATION_PROVIDER) {
      expect(PROVIDER_CATALOGUE[providerId].grantsTools, providerId).toBe(false);
    }
  });

  it('declares only known execution modes', () => {
    const known = new Set<string>(GENERATION_EXECUTION_MODE);
    for (const providerId of GENERATION_PROVIDER) {
      const modes = PROVIDER_CATALOGUE[providerId].supportedExecutionModes;
      expect(modes.length, providerId).toBeGreaterThan(0);
      for (const mode of modes) expect(known.has(mode), `${providerId} -> ${mode}`).toBe(true);
    }
  });

  it('keeps Anthropic platform-managed only', () => {
    // Not a simplification. Anthropic has no on-behalf-of flow and a claude.ai
    // subscription is not an API credential, so a USER_MANAGED Anthropic run
    // cannot be delivered as the phrase implies. Architecture §0.1.
    expect(PROVIDER_CATALOGUE.ANTHROPIC.supportedExecutionModes).toEqual(['PLATFORM_MANAGED']);
  });

  it('marks Copilot NOT grounding-safe, so it is refused rather than shipped', () => {
    // Copilot grounds its answers in Microsoft Graph by design, which is the
    // opposite of this platform's guarantee. Declared false so the refusal
    // names the real reason instead of pretending the provider is unfinished.
    expect(PROVIDER_CATALOGUE.MICROSOFT_COPILOT.retrievalFree).toBe(false);
    expect(isGroundingSafe(PROVIDER_CATALOGUE.MICROSOFT_COPILOT)).toBe(false);
  });

  it('reports cost only where a cost is observable', () => {
    // A per-seat licence has no marginal per-call cost, so claiming one would
    // be the fabrication no-fabricated-metrics.test.ts exists to prevent.
    expect(PROVIDER_CATALOGUE.MICROSOFT_COPILOT.reportsCost).toBe(false);
    // The deterministic generator's cost is genuinely zero, which is a fact
    // rather than an absence.
    expect(PROVIDER_CATALOGUE.DETERMINISTIC_LOCAL.reportsCost).toBe(true);
  });

  it('does not claim the deterministic generator reports real token usage', async () => {
    // It estimates from prompt length and says so in its own comment. A
    // comparison of tokens per accepted question across an estimated arm and a
    // reported one is meaningless unless the difference is visible.
    expect(PROVIDER_CATALOGUE.DETERMINISTIC_LOCAL.reportsTokenUsage).toBe(false);

    const provider = createDeterministicProvider();
    const result = await provider.generate(
      {
        sections: [
          {
            sectionKey: 'a'.repeat(64),
            label: 'Escalation',
            text: `A refund above five hundred euros must be approved by the duty manager. ${'Context. '.repeat(20)}`,
          },
        ],
        doNotDuplicate: [],
        requestedQuestionCount: 1,
        domainName: 'Support Operations',
        topicName: 'Escalation and Billing',
      },
      { mode: 'PLATFORM_MANAGED', onBehalfOfUserId: null, correlationId: 'c-test' },
    );
    expect(result.providerId).toBe('DETERMINISTIC_LOCAL');
    expect(result.tokenUsageReported).toBe(false);
  });
});

describe('provider selection cannot bypass governance', () => {
  const service = codeOf('packages', 'domain', 'src', 'generation', 'generation-service.ts');

  it('runs evidence verification regardless of provider', () => {
    // The gate chain is model-agnostic and must stay that way: there is one
    // verifyEvidence call and it is not inside any provider branch.
    expect(service).toContain('verifyEvidence(');
    expect(service).not.toMatch(/if\s*\(\s*provider\.providerId[^)]*\)\s*\{[^}]*verifyEvidence/s);
  });

  it('runs the integrity and duplicate gates regardless of provider', () => {
    expect(service).toContain('checkIntegrity(');
    expect(service).toContain('assessDuplicate(');
  });

  it('never branches a threshold on the provider', () => {
    // A provider needing a relaxed threshold has failed the comparison; the
    // threshold has not failed the provider.
    expect(service).not.toMatch(/providerId\s*===\s*'ANTHROPIC'/);
    expect(service).not.toMatch(/providerId\s*===\s*'MICROSOFT_COPILOT'/);
  });

  it('records the provider that actually ran, not the one configured', () => {
    // `providerId` is destructured from the CALL'S RESULT, so a provider that
    // returned a different identity than the profile requested is recorded
    // honestly. The equality assertion belongs with the Anthropic client
    // (implementation plan 3.1); this asserts the value's origin.
    expect(service).toMatch(/providerId,\s*\n/);
    // Updated 2026-09-24: the call moved behind the control layer, so the
    // provenance comes from `controlled.result` rather than from a direct
    // `provider.generate(`. Same property, one indirection later.
    expect(service).toContain('= controlled.result;');
    expect(service).toContain('await invokeWithControls(');
  });

  it('puts EVERY generation call through the control layer', () => {
    // A ceiling that applies only to the providers that cost money is a
    // ceiling that has never run, so the service must have no direct provider
    // call left...
    expect(service).not.toContain('await provider.generate(');
    // ...and the control layer must be a REQUIRED argument. `control?:` would
    // make every budget optional, and the caller most likely to omit it is a
    // future one wiring a provider that bills per token.
    expect(service).toMatch(/readonly control:\s*\{/);
  });
});

describe('the registry refuses rather than substituting', () => {
  const registry = codeOf('apps', 'api', 'src', 'generation', 'provider-registry.ts');

  it('registers only the deterministic provider', () => {
    expect(registry).toContain("factories.set('DETERMINISTIC_LOCAL'");
    for (const providerId of ['ANTHROPIC', 'MICROSOFT_COPILOT', 'AZURE_OPENAI', 'GEMINI']) {
      expect(registry).not.toContain(`factories.set('${providerId}'`);
    }
  });

  it('has no fallback path', () => {
    // The failure mode this guards: a silent downgrade to another provider or
    // another mode would make the job's recorded provenance false.
    expect(registry).not.toContain('?? createDeterministicProvider()');
    expect(registry).not.toMatch(/catch\s*\{[^}]*factories\.get/s);
  });

  it('raises a distinct, named refusal for each failure', () => {
    for (const code of [
      'PROVIDER_NOT_GROUNDING_SAFE',
      'PROVIDER_MODE_NOT_SUPPORTED',
      'USER_ENTITLEMENT_UNAVAILABLE',
      'PROVIDER_NOT_REGISTERED',
      'PROVIDER_CREDENTIAL_UNAVAILABLE',
    ]) {
      expect(registry, code).toContain(code);
    }
  });

  it('checks grounding safety before availability', () => {
    // "This provider cannot ground a question" stays true once the provider is
    // built, so it is the more useful answer and must come first.
    expect(registry.indexOf('isGroundingSafe')).toBeLessThan(
      registry.indexOf('factories.get(args.providerId)'),
    );
  });
});
