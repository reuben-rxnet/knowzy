// The validation chain and the readiness ladder, as tables.

import { describe, expect, it } from 'vitest';
import type { ProviderSettings, ProviderStateAssessment } from '@knowzy/shared-types';
import { PROVIDER_CATALOGUE } from './provider.js';
import { deriveReadiness } from './readiness.js';
import { createGeneratorRegistry } from './registry.js';
import type { ReadinessResult } from './openai.js';
import { createOpenAIGenerationProvider } from './openai-generation.js';
import { validateProvider } from './validation.js';

const settings: ProviderSettings = {
  enabled: false,
  baseUrl: 'https://api.openai.com/v1',
  modelId: 'gpt-5-codex',
  apiKeyRef: 'localstore://openai-api-key',
};

const assessment = (overrides: Partial<ProviderStateAssessment> = {}): ProviderStateAssessment => ({
  providerId: 'OPENAI',
  state: 'BLOCKED_BY_APPROVAL',
  reason: 'r',
  registered: true,
  approved: false,
  groundingSafe: true,
  supportedExecutionModes: ['PLATFORM_MANAGED'],
  reportsTokenUsage: true,
  reportsCost: true,
  maxInputTokens: 128_000,
  providerVersion: null,
  ...overrides,
});

const livePass: ReadinessResult = {
  endpoint: {
    check: 'ENDPOINT',
    result: 'PASSED',
    detail: 'ok',
    facts: { host: 'api.openai.com', httpStatus: 200 },
  },
  authentication: { check: 'AUTHENTICATION', result: 'PASSED', detail: 'ok' },
  model: { check: 'MODEL', result: 'PASSED', detail: 'ok' },
  limits: { requestsPerMinute: null, tokensPerMinute: null },
};

const run = (overrides: Partial<Parameters<typeof validateProvider>[0]> = {}) =>
  validateProvider({
    assessment: assessment(),
    capabilities: PROVIDER_CATALOGUE.OPENAI,
    settings,
    secret: { status: 'RESOLVED', source: 'LOCAL_SECURE_STORE', detail: null },
    live: livePass,
    ...overrides,
  });

const ladder = (report: ReturnType<typeof validateProvider>, a = assessment(), s = settings) =>
  deriveReadiness({
    assessment: a,
    capabilities: PROVIDER_CATALOGUE[a.providerId as 'OPENAI'],
    settings: s,
    latestValidation: { steps: report.steps, validatedAt: '2026-09-27T10:00:00.000Z' },
  });

describe('validateProvider', () => {
  it('runs the nine checks in order, and GENERATION is never PASSED for a readiness-only client', () => {
    const report = run();
    expect(report.steps.map((step) => step.check)).toEqual([
      'CAPABILITY',
      'APPROVAL',
      'IMPLEMENTATION',
      'CONFIGURATION',
      'SECRET_RESOLUTION',
      'ENDPOINT',
      'AUTHENTICATION',
      'MODEL',
      'GENERATION',
    ]);
    expect(report.steps.at(-1)?.result).toBe('NOT_ATTEMPTED');
  });

  it('is FAILED while unapproved even when every live check passed -- and says the live checks still ran', () => {
    const report = run();
    expect(report.outcome).toBe('FAILED');
    expect(report.steps.find((s) => s.check === 'APPROVAL')?.detail).toMatch(/still run/);
    expect(report.steps.find((s) => s.check === 'AUTHENTICATION')?.result).toBe('PASSED');
  });

  it('is INCOMPLETE, never PASSED, once approved -- this build cannot generate with it', () => {
    expect(run({ assessment: assessment({ approved: true }) }).outcome).toBe('INCOMPLETE');
  });

  it('marks the live checks NOT_ATTEMPTED, with the reason, when the secret did not resolve', () => {
    const report = run({
      secret: { status: 'NOT_FOUND', source: 'LOCAL_SECURE_STORE', detail: 'no such secret' },
      live: null,
    });
    const endpoint = report.steps.find((s) => s.check === 'ENDPOINT');
    expect(endpoint?.result).toBe('NOT_ATTEMPTED');
    expect(endpoint?.detail).toMatch(/did not resolve/);
    expect(report.steps.find((s) => s.check === 'SECRET_RESOLUTION')?.result).toBe('FAILED');
  });

  it('fails CONFIGURATION with the missing fields named', () => {
    const report = run({ settings: { enabled: false }, secret: null, live: null });
    expect(report.steps.find((s) => s.check === 'CONFIGURATION')?.detail).toMatch(
      /baseUrl, modelId, apiKeyRef/,
    );
  });

  it('passes every check for the deterministic provider', () => {
    const report = validateProvider({
      assessment: assessment({ providerId: 'DETERMINISTIC_LOCAL', approved: true }),
      capabilities: PROVIDER_CATALOGUE.DETERMINISTIC_LOCAL,
      settings: undefined,
      secret: null,
      live: null,
    });
    expect(report.outcome).toBe('PASSED');
  });
});

describe('deriveReadiness — the ladder', () => {
  it('UNAVAILABLE for a provider that cannot ground, whatever else is true', () => {
    const a = assessment({ providerId: 'MICROSOFT_COPILOT', groundingSafe: false });
    expect(ladder(run({ assessment: a }), a).state).toBe('UNAVAILABLE');
  });

  it('BLOCKED_BY_CONFIGURATION with the missing fields, before any validation', () => {
    const r = deriveReadiness({
      assessment: assessment(),
      capabilities: PROVIDER_CATALOGUE.OPENAI,
      settings: { enabled: false },
      latestValidation: null,
    });
    expect(r.state).toBe('BLOCKED_BY_CONFIGURATION');
    expect(r.reason).toMatch(/baseUrl, modelId, apiKeyRef/);
  });

  it('CONFIGURED when complete and never tested', () => {
    const r = deriveReadiness({
      assessment: assessment(),
      capabilities: PROVIDER_CATALOGUE.OPENAI,
      settings,
      latestValidation: null,
    });
    expect(r.state).toBe('CONFIGURED');
  });

  it('back to CONFIGURED when the model changed since the last test', () => {
    const report = run();
    expect(ladder(report, assessment(), { ...settings, modelId: 'another-model' }).state).toBe(
      'CONFIGURED',
    );
  });

  it('BLOCKED_BY_CONFIGURATION when the secret did not resolve', () => {
    const report = run({
      secret: { status: 'NOT_FOUND', source: 'LOCAL_SECURE_STORE', detail: 'no such secret' },
      live: null,
    });
    expect(ladder(report).state).toBe('BLOCKED_BY_CONFIGURATION');
  });

  it('RESOLVED when the key was read and refused', () => {
    const report = run({
      live: {
        ...livePass,
        authentication: { check: 'AUTHENTICATION', result: 'FAILED', detail: 'refused (401)' },
        model: { check: 'MODEL', result: 'NOT_ATTEMPTED', detail: 'n/a' },
      },
    });
    expect(ladder(report).state).toBe('RESOLVED');
  });

  it('AUTHENTICATED when the key works and the model does not', () => {
    const report = run({
      live: { ...livePass, model: { check: 'MODEL', result: 'FAILED', detail: '404' } },
    });
    expect(ladder(report).state).toBe('AUTHENTICATED');
  });

  it('BLOCKED_BY_CONFIGURATION when the endpoint was refused by the allow-list', () => {
    const report = run({
      live: {
        ...livePass,
        endpoint: {
          check: 'ENDPOINT',
          result: 'FAILED',
          detail: 'not allowed',
          facts: { cause: 'NOT_ALLOWED' },
        },
      },
    });
    expect(ladder(report).state).toBe('BLOCKED_BY_CONFIGURATION');
  });

  it('BLOCKED_BY_APPROVAL when technically ready and unapproved -- where OpenAI stands before T-29', () => {
    expect(ladder(run()).state).toBe('BLOCKED_BY_APPROVAL');
  });

  it('AVAILABLE once verified, approved and enabled -- OPENAI-CODEX-01 can generate', () => {
    const a = assessment({ approved: true });
    const s = { ...settings, enabled: true };
    expect(ladder(run({ assessment: a, settings: s }), a, s).state).toBe('AVAILABLE');
  });

  it('BLOCKED_BY_CONFIGURATION when verified and approved but not enabled', () => {
    const a = assessment({ approved: true });
    expect(ladder(run({ assessment: a }), a).state).toBe('BLOCKED_BY_CONFIGURATION');
  });
});

const openaiFactory = (model: string) =>
  createOpenAIGenerationProvider({
    modelId: model,
    configure: async () => {
      throw new Error('not called by the registry');
    },
  });

describe('the registry lets OpenAI generate only when every gate is met', () => {
  it('AVAILABLE when approved, enabled and credentialled', () => {
    const registry = createGeneratorRegistry({
      factories: { OPENAI: openaiFactory },
      activeProvider: 'DETERMINISTIC_LOCAL',
      approvedProviders: ['DETERMINISTIC_LOCAL', 'OPENAI'],
      enabled: { OPENAI: true },
      credentialPresent: { OPENAI: true },
    });
    expect(registry.assess('OPENAI').state).toBe('AVAILABLE');
  });

  it('BLOCKED_BY_APPROVAL first while unapproved, however well configured -- where OpenAI stands before T-29', () => {
    const registry = createGeneratorRegistry({
      factories: { OPENAI: openaiFactory },
      activeProvider: 'DETERMINISTIC_LOCAL',
      approvedProviders: ['DETERMINISTIC_LOCAL'],
      enabled: { OPENAI: true },
      credentialPresent: { OPENAI: true },
    });
    expect(registry.assess('OPENAI').state).toBe('BLOCKED_BY_APPROVAL');
    expect(() =>
      registry.forJob({ providerId: 'OPENAI', executionMode: 'PLATFORM_MANAGED', modelId: 'm' }),
    ).toThrow(/approval/i);
  });

  it('BLOCKED_BY_CONFIGURATION when approved but not enabled', () => {
    const registry = createGeneratorRegistry({
      factories: { OPENAI: openaiFactory },
      activeProvider: 'DETERMINISTIC_LOCAL',
      approvedProviders: ['DETERMINISTIC_LOCAL', 'OPENAI'],
      credentialPresent: { OPENAI: true },
    });
    expect(registry.assess('OPENAI').state).toBe('BLOCKED_BY_CONFIGURATION');
  });
});
