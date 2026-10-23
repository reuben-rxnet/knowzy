// AI Document Studio -- the guarantees that keep it honest
// (docs/competencies/AI_DOCUMENT_STUDIO_ARCHITECTURE.md §10 Slice 2, §11 M3).
//
//   1. THE PURPOSES ARE SEPARATE, in both directions: the Studio never reads a
//      question-generation approval, and the generation path never reads a
//      restructuring approval.
//   2. LIVE PREPARATION NEEDS ITS APPROVAL. Only providers with a BUILT client
//      are registered (OpenAI, since M3), and without the DOCUMENT_RESTRUCTURE
//      approval none reads READY however configured it is.
//   3. THE TEST PREPARER IS NOT AI AND NOT PRODUCTION: outside the generation
//      provider catalogue, behind a flag whose ceiling is `local` alone.
//   4. THE ROUTES ARE THE ONES SPECIFIED, and none deletes: a prepared version
//      is never destructively deleted (§11.6).
//   5. THE OPENAI PREPARER SENDS NO TOOLS, STORES NOTHING, AND REVEALS NO KEY
//      itself (providerFetch does, in one place), and its prompt is pinned.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  evaluateRestructureReadiness,
  PREPARATION_PROMPT_SHA256,
  PREPARATION_TOOL_GRANT,
  preparationPromptHash,
  RESTRUCTURING_CLIENTS,
} from '@knowzy/claude-services';
import { FEATURE_FLAGS, resolveFlag } from '@knowzy/configuration';
import { GENERATION_PROVIDER, TEST_PREPARATION_PROVIDER } from '@knowzy/shared-types';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const codeOf = (...segments: readonly string[]): string =>
  readFileSync(join(REPO_ROOT, ...segments), 'utf8')
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
    .join('\n');

const STUDIO_FILES = [
  ['packages', 'domain', 'src', 'generation', 'control', 'document-studio.ts'],
  ['packages', 'domain', 'src', 'document-studio', 'preparation-service.ts'],
  ['packages', 'domain', 'src', 'document-studio', 'reads.ts'],
  ['packages', 'claude-services', 'src', 'restructure-readiness.ts'],
  ['packages', 'claude-services', 'src', 'document-preparation.ts'],
  ['apps', 'api', 'src', 'routes', 'document-studio.ts'],
] as const;

const GENERATION_APPROVAL_READERS = [
  ['packages', 'claude-services', 'src', 'registry.ts'],
  ['packages', 'configuration', 'src', 'generation-control-settings.ts'],
  ['packages', 'domain', 'src', 'generation', 'control', 'provider-administration.ts'],
] as const;

const APPROVAL = {
  reference: 'contract test',
  approvedByUserId: '00000000-0000-7000-8000-000000000001',
  approvedByDisplayName: 'contract',
  approvedAt: '2026-10-14T00:00:00.000Z',
};

describe('AI Document Studio: purposes are separate', () => {
  it('the Studio never reads a question-generation approval', () => {
    for (const file of STUDIO_FILES) {
      expect(codeOf(...file), file.join('/')).not.toMatch(/approvedProviders/);
    }
  });

  it('the generation path never reads a restructuring approval', () => {
    for (const file of GENERATION_APPROVAL_READERS) {
      expect(codeOf(...file), file.join('/')).not.toMatch(/purposeApprovals|DOCUMENT_RESTRUCTURE/);
    }
  });
});

describe('AI Document Studio: live preparation needs its own approval', () => {
  it('registers only OpenAI, whose client exists', () => {
    expect(RESTRUCTURING_CLIENTS).toEqual(['OPENAI']);
    expect(codeOf('packages', 'claude-services', 'src', 'document-preparation.ts')).toMatch(
      /export const createOpenAIPreparer/,
    );
  });

  it('never reads READY without the DOCUMENT_RESTRUCTURE approval, however configured', () => {
    const unapproved = evaluateRestructureReadiness({
      approvals: {},
      configured: () => true,
      evaluatedAt: '2026-10-14T00:00:00.000Z',
    });
    expect(unapproved.state).toBe('BLOCKED_BY_APPROVAL');
    expect(unapproved.providers.some((row) => row.state === 'READY')).toBe(false);
    const approved = evaluateRestructureReadiness({
      approvals: { OPENAI: APPROVAL },
      configured: () => true,
      evaluatedAt: '2026-10-14T00:00:00.000Z',
    });
    expect(approved.state).toBe('READY');
  });

  it('builds the live preparer only behind readiness, in the API', () => {
    const routes = codeOf('apps', 'api', 'src', 'routes', 'document-studio.ts');
    expect(routes).toMatch(/readyRestructureProvider\(/);
    expect(routes.match(/createOpenAIPreparer\(/g)?.length).toBe(1);
  });
});

describe('AI Document Studio: the test preparer is not AI and not production', () => {
  it('is not a generation provider', () => {
    expect((GENERATION_PROVIDER as readonly string[]).includes(TEST_PREPARATION_PROVIDER)).toBe(
      false,
    );
  });

  it('sits behind a flag whose ceiling is the local environment alone', () => {
    expect(FEATURE_FLAGS['documentStudio.testPreparation.enabled'].ceiling).toEqual(['local']);
    for (const env of ['dev', 'test', 'prod'] as const) {
      expect(resolveFlag('documentStudio.testPreparation.enabled', env, true).effective).toBe(
        false,
      );
    }
    expect(resolveFlag('documentStudio.testPreparation.enabled', 'local').effective).toBe(true);
  });

  it('treats an unknown environment as the most restrictive one', () => {
    expect(codeOf('apps', 'api', 'src', 'index.ts')).toMatch(
      /environment === 'unknown' \? 'prod' : environment/,
    );
  });
});

describe('AI Document Studio: the routes', () => {
  it('are the ones specified, and none deletes', () => {
    const routes = codeOf('apps', 'api', 'src', 'routes', 'document-studio.ts');
    const urls = [...routes.matchAll(/url: '([^']+)'/g)].map((match) => match[1]);
    expect(urls).toEqual([
      '/api/v1/authoring/document-studio/status',
      '/api/v1/authoring/document-studio/approvals/:providerId',
      '/api/v1/authoring/document-studio/mode',
      '/api/v1/authoring/document-studio/mode',
      '/api/v1/authoring/document-studio/documents',
      '/api/v1/authoring/document-studio/documents',
      '/api/v1/authoring/document-studio/documents/:id',
      '/api/v1/authoring/document-studio/documents/:id/preparations',
      '/api/v1/authoring/document-studio/history',
      '/api/v1/authoring/document-studio/candidates',
      '/api/v1/authoring/document-studio/uploads',
      '/api/v1/authoring/document-studio/versions/:id/content',
      '/api/v1/authoring/document-studio/versions/:id/restore',
      '/api/v1/authoring/document-studio/versions/:id/discard',
      '/api/v1/authoring/document-studio/versions/:id/revalidation-draft',
      '/api/v1/authoring/document-studio/versions/:id/repository',
      '/api/v1/authoring/document-studio/versions/:id/download',
    ]);
    expect(routes).not.toMatch(/method: 'DELETE'/);
    for (const url of urls) expect(url).not.toMatch(/transform|rewrite/i);
  });

  it('requires the explicit confirmation to add to the repository', () => {
    expect(codeOf('apps', 'api', 'src', 'routes', 'document-studio.ts')).toMatch(
      /confirmed: z\.literal\(true\)/,
    );
  });
});

describe('AI Document Studio: Simple mode (§12)', () => {
  const quick = (): string =>
    codeOf('apps', 'authoring-web', 'src', 'app', 'document-studio', 'quick-actions.ts');

  it('keeps preflight, decision and job, in that order, behind one click', () => {
    const code = quick();
    const preflight = code.indexOf("'/api/v1/authoring/generation/preflight'");
    const decide = code.indexOf('/decide`');
    const job = code.indexOf("'/api/v1/authoring/generation-jobs'");
    expect(preflight).toBeGreaterThan(-1);
    expect(decide).toBeGreaterThan(preflight);
    expect(job).toBeGreaterThan(decide);
  });

  it('follows only a recommendation that authorizes generation, and never regenerates', () => {
    const code = quick();
    expect(code).toMatch(
      /GENERATE_NEW: \{ scope: 'ENTIRE_DOCUMENT', reasonCode: 'NEW_KNOWLEDGE' \}/,
    );
    expect(code).not.toMatch(/'REGENERATE'|PUBLISHER_REQUESTED/);
  });

  it('generating never approves or publishes: those are their own clicks', () => {
    const code = quick();
    const generate = code.slice(
      code.indexOf('export const generateQuizAction'),
      code.indexOf('export const setStudioModeAction'),
    );
    expect(generate.length).toBeGreaterThan(0);
    expect(generate).not.toMatch(/question-bank\/publish|\/approve|\/submit|\/claim/);
  });

  it('approves only the questions a person ticked, through the real transitions', () => {
    const code = quick();
    expect(code).toMatch(/formData\s*\.getAll\('questionIds'\)/);
    expect(code).toMatch(/AUTHOR_REVIEW: 'submit'/);
    expect(code).toMatch(/SUBMITTED_FOR_APPROVAL: 'approve'/);
    const file = codeOf('apps', 'authoring-web', 'src', 'components', 'QuickQuizReview.tsx');
    const review = file.slice(
      file.indexOf('export const QuizReview'),
      file.indexOf('export const PublishQuizForm'),
    );
    expect(review.length).toBeGreaterThan(0);
    // Unticked by default, and no "select all": each approval is a decision.
    expect(review).not.toMatch(/defaultChecked|checked=|select all|selectAll/i);
  });

  it('adds to the bank without creating a quiz when that is the choice', () => {
    const code = quick();
    const bank = code.indexOf('if (bankOnly) {');
    expect(bank).toBeGreaterThan(code.indexOf("'/api/v1/authoring/question-bank/publish'"));
    expect(bank).toBeLessThan(code.indexOf("'/api/v1/authoring/assessments'"));
  });

  it('builds a quiz from the bank as a pinned random pool, through the governed sequence', () => {
    const code = quick();
    const bank = code.slice(code.indexOf('export const buildBankQuizAction'));
    // Mixed is one random pool; an even spread is TOPIC_BALANCED, and only
    // with more than one topic ticked.
    expect(bank).toMatch(/selectionStrategy: even \? 'TOPIC_BALANCED' : 'RANDOM_POOL'/);
    expect(bank).toMatch(/=== 'even' && topicIds\.length > 1/);
    // Never more than is published, and refused before anything is created.
    expect(bank.indexOf('count > available')).toBeGreaterThan(-1);
    expect(bank.indexOf('count > available')).toBeLessThan(
      bank.indexOf("'/api/v1/authoring/assessments'"),
    );
    expect(bank).toMatch(/\['submit', 'approve', 'publish'\] as const/);
  });

  it('serves question review only for a finished attempt the assessment allows', () => {
    const session = codeOf('packages', 'domain', 'src', 'assessment', 'session-service.ts');
    const review = session.slice(session.indexOf('export const readResultReview'));
    expect(review).toMatch(/learnerUserId: args\.learner\.userId/);
    expect(review).toMatch(/status === 'IN_PROGRESS'\) return \{ available: false/);
    expect(review).toMatch(/!session\.assessmentVersion\.showAnswersAfterCompletion/);
  });

  it('publishes a quiz of exactly the approved questions', () => {
    const code = quick();
    expect(code).toMatch(/selectionStrategy: 'FIXED_SET'/);
    expect(code).toMatch(/status\(id\) === 'APPROVED'/);
  });

  it('uploads into its own source, and the Originals source stays unusable for generation', () => {
    const sources = codeOf('packages', 'domain', 'src', 'document-studio', 'studio-sources.ts');
    expect(sources).toMatch(/STUDIO_ORIGINALS = \{[^}]*usableForGeneration: false,/);
    expect(sources).toMatch(/STUDIO_QUIZ = \{[^}]*usableForGeneration: true,/);
  });

  it('shows the question types it cannot generate as disabled, not as working controls', () => {
    const form = codeOf('apps', 'authoring-web', 'src', 'components', 'QuickQuiz.tsx');
    expect(form).toMatch(/value: 'MULTIPLE_CHOICE', available: false/);
    expect(form).toMatch(/value: 'YES_NO', available: false/);
    expect(form).toMatch(/disabled=\{!type\.available\}/);
  });
});

describe('AI Document Studio: the OpenAI preparer', () => {
  const source = codeOf('packages', 'claude-services', 'src', 'document-preparation.ts');

  it('sends no tools and asks the provider to store nothing', () => {
    expect(PREPARATION_TOOL_GRANT).toEqual([]);
    expect(source).toMatch(/tools: PREPARATION_TOOL_GRANT/);
    expect(source).toMatch(/store: false/);
  });

  it('never reveals a key itself: providerFetch does', () => {
    expect(source).not.toMatch(/\.reveal\(/);
    expect(source).toMatch(/providerFetch\(/);
  });

  it('pins its prompt', () => {
    expect(preparationPromptHash()).toBe(PREPARATION_PROMPT_SHA256);
  });
});
