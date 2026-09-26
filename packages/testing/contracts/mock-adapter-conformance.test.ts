// Runs the conformance suite against MockKnowledgeSourceAdapter.
//
// knowledge-source-adapters.md §8 rule 2: the suite runs in CI for the mock on
// every commit, and for the SharePoint adapter against recorded Graph fixtures,
// so it needs no tenant credentials and cannot be skipped for lack of them.
// This file is the first half of that; Phase 7 adds the second, calling the
// same `runAdapterConformanceSuite` with its own subject.

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  createMockKnowledgeSourceAdapter,
  createMockQuestionBankAdapter,
  fixtureDocumentId,
  MOCK_CAPABILITIES,
  type AdapterContext,
  type BankContext,
  type BankItemWrite,
} from '@knowzy/knowledge-source-adapters';
import { systemClock } from '@knowzy/observability';
import { runAdapterConformanceSuite, runBankConformanceSuite } from './adapter-conformance.js';

const FIXTURE_ROOT = fileURLToPath(new URL('../../../fixtures/knowledge', import.meta.url));
const SOURCE_KEY = 'support-operations';

const adapter = createMockKnowledgeSourceAdapter({ fixtureRoot: FIXTURE_ROOT });

const context = (overrides: Partial<AdapterContext> = {}): AdapterContext => ({
  source: {
    knowledgeSourceId: '00000000-0000-0000-0000-000000000001',
    sourceKey: SOURCE_KEY,
    displayName: 'Support Operations (mock)',
    sourceType: 'MOCK',
    connection: {},
  },
  paths: [],
  credential: {
    kind: 'none',
    resolve: () => Promise.reject(new Error('The mock source requires no credential.')),
  },
  permissionMode: 'APP_ONLY_SITES_SELECTED',
  correlationId: 'conformance-run',
  limits: { maxBytes: 5_000_000, maxCharsPerDocument: 200_000, pageSize: 50 },
  clock: systemClock,
  signal: new AbortController().signal,
  ...overrides,
});

runAdapterConformanceSuite({
  name: 'MockKnowledgeSourceAdapter',
  adapter,
  context,
  allowedDocumentPath: 'SOPs/Network/incident-escalation.md',
  deniedDocumentPath: 'Policies/board-remuneration.md',
  unstructuredDocumentPath: 'Policies/acceptable-use.txt',
  documentId: fixtureDocumentId,
});

// The bank half of the suite. §1.1: two INDEPENDENT ports, so the bank gets its
// own subject rather than being bolted onto the source adapter's.
runBankConformanceSuite({
  name: 'MockQuestionBankAdapter',
  // A temp directory, so the suite never reads or writes the committed
  // fixtures/bank state a developer may be looking at.
  bank: createMockQuestionBankAdapter({
    fixtureRoot: mkdtempSync(join(tmpdir(), 'knowzy-conf-bank-')),
  }),
  context: (): BankContext => ({
    targetSiteId: 'conformance-site',
    targetListId: 'conformance-list',
    correlationId: 'bank-conformance',
    actorUserId: '00000000-0000-0000-0000-00000000000a',
    signal: new AbortController().signal,
  }),
  sampleItem: (questionId: string): BankItemWrite => ({
    questionId,
    internalQuestionId: '00000000-0000-0000-0000-00000000000b',
    questionType: 'MULTIPLE_CHOICE_4',
    questionText: 'Within how long must a severity one incident reach the duty manager?',
    optionA: 'Fifteen minutes',
    optionB: 'One hour',
    optionC: 'One business day',
    optionD: 'End of shift',
    correctAnswer: 'A',
    explanation: 'The procedure sets a fifteen-minute limit.',
    domain: 'Support Operations',
    domainCode: 'CONF',
    topic: 'Escalation',
    sourceDocumentName: 'incident-escalation.md',
    sourceUrl: 'mock://SOPs/Network/incident-escalation.md',
    sourceDocumentId: 'doc-1',
    sourceSectionKey: 'section-1',
    supportingEvidence: 'the duty manager within fifteen minutes',
    sourceContentHash: 'hash',
    sourceVersion: '3.0',
    confidenceIndicator: 0.77,
    generationJobId: null,
    generatorModel: null,
    promptVersion: null,
    status: 'Approved',
    isActive: true,
    isPublished: true,
    version: 1,
    approvedBy: null,
    approvalDate: null,
    publishedBy: null,
    publishedDate: null,
    correlationId: 'bank-conformance',
  }),
});

// Mock-specific behaviour: things the contract does not require of every
// adapter, but which the mock must get right to be a usable substrate.
describe('MockKnowledgeSourceAdapter specifics', () => {
  it('declares live search false so the indexed-vs-live labelling path is exercised', () => {
    expect(MOCK_CAPABILITIES.supportsLiveSearch).toBe(false);
    expect(MOCK_CAPABILITIES.supportsPermissionCheck).toBe(true);
  });

  it('reads timestamps from the sidecar, never from the filesystem', async () => {
    const document = await adapter.getDocument(
      context(),
      fixtureDocumentId('SOPs/Network/incident-escalation.md'),
    );
    expect(document?.sourceModifiedAt?.toISOString()).toBe('2025-06-02T11:30:00.000Z');
    expect(document?.sourceVersion).toBe('3.0');
  });

  it('falls back to the fixed base date when a document has no sidecar', async () => {
    const document = await adapter.getDocument(
      context(),
      fixtureDocumentId('Policies/acceptable-use.txt'),
    );
    expect(document?.sourceModifiedAt?.toISOString()).toBe('2025-01-01T00:00:00.000Z');
  });

  it('surfaces only the metadata columns the fixture captured', async () => {
    const document = await adapter.getDocument(
      context(),
      fixtureDocumentId('SOPs/Billing/refunds-and-chargebacks.md'),
    );
    expect(document?.sourceMetadata).toEqual({
      Owner: 'Billing Operations',
      ReviewCycle: 'Semi-annual',
      Classification: 'Internal',
    });
  });

  it('honours a configured path, which is what makes source configuration mean anything', async () => {
    const scoped = context({
      paths: [{ containerId: 'SOPs', folderPath: 'Billing', recursive: true }],
    });
    const events = [];
    for await (const event of adapter.synchronize(scoped, { mode: 'FULL' })) events.push(event);

    const discovered = events.filter((e) => e.type === 'ITEM_DISCOVERED');
    expect(discovered).toHaveLength(1);
    expect(discovered[0]?.type === 'ITEM_DISCOVERED' && discovered[0].item.name).toBe(
      'refunds-and-chargebacks.md',
    );
  });

  it('filters by file type when the path configuration asks it to', async () => {
    const scoped = context({
      paths: [{ containerId: 'Policies', recursive: true, includeFileTypes: ['html'] }],
    });
    const page = await adapter.listItems(scoped, { containerId: 'Policies', recursive: true });
    expect(page.items.map((i) => i.name)).toEqual(['data-handling.html']);
  });

  it('injects a deterministic extraction failure without failing the run', async () => {
    const faulted = createMockKnowledgeSourceAdapter({
      fixtureRoot: FIXTURE_ROOT,
      faults: [{ relativePath: 'SOPs/Network/incident-escalation.md', kind: 'EXTRACTION_FAILED' }],
    });
    const content = await faulted.extractContent(
      context(),
      fixtureDocumentId('SOPs/Network/incident-escalation.md'),
      {},
    );
    expect(content.status).toBe('FAILED');
    expect(content.normalizedText).toBeUndefined();
    expect(content.sections).toEqual([]);

    // The other documents still extract: one bad document does not poison the run.
    const other = await faulted.extractContent(
      context(),
      fixtureDocumentId('SOPs/Billing/refunds-and-chargebacks.md'),
      {},
    );
    expect(other.status).toBe('EXTRACTED');
  });

  it('runs the real HTML extractor, discarding script and style content', async () => {
    const content = await adapter.extractContent(
      context(),
      fixtureDocumentId('Policies/data-handling.html'),
      {},
    );
    expect(content.status).toBe('EXTRACTED');
    expect(content.normalizedText).not.toContain('window.analytics');
    expect(content.normalizedText).not.toContain('#c00');
    expect(content.normalizedText).not.toContain('All policies');
    expect(content.sections.map((s) => s.heading)).toContain('Access on a Need Basis');
  });

  it('segments an unstructured document into honestly labelled windows', async () => {
    const content = await adapter.extractContent(
      context(),
      fixtureDocumentId('Policies/acceptable-use.txt'),
      {},
    );
    expect(content.sections.length).toBeGreaterThan(1);
    for (const section of content.sections) {
      expect(section.label).toMatch(/^Segment \d+ of \d+$/);
    }
  });

  it('passes a connection test against the committed fixtures', async () => {
    const result = await adapter.testConnection(context());
    expect(result.ok).toBe(true);
    expect(result.checks.find((c) => c.name === 'Fixture tree readable')?.outcome).toBe('PASS');
  });

  it('fails a connection test with an actionable reason for an unknown source key', async () => {
    const result = await adapter.testConnection(
      context({
        source: {
          knowledgeSourceId: '00000000-0000-0000-0000-000000000002',
          sourceKey: 'no-such-source',
          displayName: 'Missing',
          sourceType: 'MOCK',
          connection: {},
        },
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.checks.find((c) => c.outcome === 'FAIL')?.detail).toContain('no-such-source');
  });

  it('fails a connection test when the configured paths match nothing', async () => {
    const result = await adapter.testConnection(
      context({ paths: [{ containerId: 'Nope', recursive: true }] }),
    );
    expect(result.ok).toBe(false);
    expect(result.checks.find((c) => c.name === 'Configured paths resolve')?.outcome).toBe('FAIL');
  });
});
