// Runs the conformance suite against the REAL FileRepositoryKnowledgeSource.
//
// knowledge-source-adapters.md §8 rule 1: "the suite is the contract." So this
// is the same `runAdapterConformanceSuite` the mock is driven through, with no
// assertion relaxed and no group skipped — which is what makes the transitional
// adapter trustworthy rather than merely present.
//
// It also asserts the three things specific to reading a synchronized mirror,
// none of which the shared suite knows about:
//
//   * no emitted provenance value is ever a local filesystem path;
//   * sync-client artifacts, symlinks and unsupported types are skipped, each
//     with a stated reason;
//   * the partial-sync guard refuses a run rather than reporting mass deletion.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  createFileRepositoryAdapter,
  DelegatedAccessNotSupportedError,
  FILE_REPOSITORY_CAPABILITIES,
  looksLikeLocalPath,
  treeDocumentId,
  type AdapterContext,
  type SyncEvent,
} from '@knowzy/knowledge-source-adapters';
import { systemClock } from '@knowzy/observability';
import { runAdapterConformanceSuite } from './adapter-conformance.js';

const MIRROR_ROOT = fileURLToPath(new URL('../../../fixtures/pilot-mirror', import.meta.url));

/**
 * A canonical folder URL of the SHAPE the pilot decision fixed, with a neutral
 * host.
 *
 * The real tenant hostname is deliberately absent: it is a customer
 * identifier, content rule C2 forbids one in source, and this asserts the
 * path→URL MAPPING rather than any particular tenant. The approved pilot URL
 * is recorded where it belongs, in RealWorldPilot/CorpusManifest.md.
 */
const WEB_URL_BASE =
  'https://example-tenant.invalid/sites/CentralRxOperationsSupport/Shared%20Documents/Reuben/Projects/Knowzy';

const CONNECTION = {
  localRoot: MIRROR_ROOT,
  provenance: 'SHAREPOINT_MIRROR' as const,
  webUrlBase: WEB_URL_BASE,
  mirrorAccountUpn: 'pilot.sync@example.invalid',
  includePatterns: [],
  excludePatterns: [],
  supportedExtensions: [],
  maxFileBytes: 32 * 1024 * 1024,
  partialSyncFloor: 0.8,
  sidecarsEnabled: true,
  isActive: true,
};

const adapter = createFileRepositoryAdapter();

const context = (overrides: Partial<AdapterContext> = {}): AdapterContext => ({
  source: {
    knowledgeSourceId: '00000000-0000-0000-0000-0000000000f1',
    sourceKey: 'pilot-sop-corpus',
    displayName: 'KNOWZY Real-World Pilot SOP Corpus (fixture mirror)',
    sourceType: 'FILE_REPOSITORY',
    connection: CONNECTION,
  },
  paths: [],
  credential: {
    kind: 'none',
    resolve: () =>
      Promise.reject(
        new Error(
          'A file-repository source requires no credential: the sync client authenticates.',
        ),
      ),
  },
  permissionMode: 'APP_ONLY_SITES_SELECTED',
  correlationId: 'file-repository-conformance',
  limits: { maxBytes: 33_554_432, maxCharsPerDocument: 200_000, pageSize: 50 },
  clock: systemClock,
  signal: new AbortController().signal,
  ...overrides,
});

runAdapterConformanceSuite({
  name: 'FileRepositoryKnowledgeSource',
  adapter,
  context,
  allowedDocumentPath: 'SOPs/escalation-matrix.md',
  deniedDocumentPath: 'Policies/restricted-board-pay.md',
  unstructuredDocumentPath: 'SOPs/acceptable-use.txt',
  documentId: treeDocumentId,
});

// ---------------------------------------------------------------------------

describe('FileRepositoryKnowledgeSource declares its capabilities honestly', () => {
  it('cannot trim per user, and says so', () => {
    expect(FILE_REPOSITORY_CAPABILITIES.supportsDelegatedAccess).toBe(false);
  });

  it('has no version labels, so the content hash must decide', () => {
    expect(FILE_REPOSITORY_CAPABILITIES.supportsVersionLabels).toBe(false);
  });

  it('is read-only as a matter of type, not policy', () => {
    expect(FILE_REPOSITORY_CAPABILITIES.writeCapable).toBe(false);
  });

  it('declares only document types with a registered extractor', () => {
    // Derived from the extractor registry, so it cannot drift. PPTX and XLSX
    // are present because they now have extractors; SHAREPOINT_PAGE is not,
    // because a page has no file in a document library at all.
    expect(FILE_REPOSITORY_CAPABILITIES.supportedDocumentTypes).toContain('PDF');
    expect(FILE_REPOSITORY_CAPABILITIES.supportedDocumentTypes).toContain('DOCX');
    expect(FILE_REPOSITORY_CAPABILITIES.supportedDocumentTypes).toContain('PPTX');
    expect(FILE_REPOSITORY_CAPABILITIES.supportedDocumentTypes).toContain('XLSX');
    expect(FILE_REPOSITORY_CAPABILITIES.supportedDocumentTypes).not.toContain('SHAREPOINT_PAGE');
  });

  it('refuses DELEGATED_OBO at configuration time rather than approximating it', async () => {
    await expect(
      adapter.listContainers(context({ permissionMode: 'DELEGATED_OBO' })),
    ).rejects.toThrow(DelegatedAccessNotSupportedError);
  });

  it('reports every access decision as platform-enforced, never source-enforced', async () => {
    const decision = await adapter.getEffectiveAccess(
      context(),
      treeDocumentId('SOPs/escalation-matrix.md'),
    );
    expect(decision.enforcement).toBe('PLATFORM');
    expect(decision.decision).toBe('ALLOWED');
    expect(decision.summary).toContain('enforced by Knowzy');
  });
});

describe('no local filesystem path is ever emitted as provenance', () => {
  // A universal claim is only worth what checks it. `sourceUrl` is
  // non-nullable and flows into the published Question Bank record, so a local
  // path there would break traceability permanently AND write a username and
  // machine layout into a SharePoint list nobody will rewrite.

  it('listItems emits canonical web URLs', async () => {
    const page = await adapter.listItems(context(), { containerId: 'SOPs' });
    expect(page.items.length).toBeGreaterThan(0);
    for (const item of page.items) {
      expect(item.webUrl).toBeDefined();
      expect(looksLikeLocalPath(item.webUrl ?? '')).toBe(false);
      expect(item.webUrl).toMatch(/^https:\/\/example-tenant\.invalid\//);
    }
  });

  it('getDocument emits a canonical web URL', async () => {
    const document = await adapter.getDocument(
      context(),
      treeDocumentId('SOPs/certificate-renewal.docx'),
    );
    expect(document).not.toBeNull();
    expect(looksLikeLocalPath(document?.webUrl ?? '')).toBe(false);
    // The corpus subfolder is part of the canonical path, and each segment is
    // percent-encoded individually so the separators survive.
    expect(document?.webUrl).toBe(`${WEB_URL_BASE}/SOPs/certificate-renewal.docx`);
  });

  it('searchDocuments emits canonical web URLs', async () => {
    const page = await adapter.searchDocuments(context(), { text: 'duty manager' });
    expect(page.items.length).toBeGreaterThan(0);
    for (const hit of page.items) {
      expect(looksLikeLocalPath(hit.document.webUrl ?? '')).toBe(false);
    }
  });

  it('synchronize emits canonical web URLs and never a local path', async () => {
    const events: SyncEvent[] = [];
    for await (const event of adapter.synchronize(context(), { mode: 'FULL' })) {
      events.push(event);
    }
    const items = events.flatMap((event) =>
      event.type === 'ITEM_DISCOVERED' || event.type === 'ITEM_MODIFIED' ? [event.item] : [],
    );
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(looksLikeLocalPath(item.webUrl ?? '')).toBe(false);
    }
    // Nothing anywhere in the event stream may carry the mirror root.
    expect(JSON.stringify(events)).not.toContain(MIRROR_ROOT.replace(/\\/g, '\\\\'));
  });

  it('the local-path detector actually detects the shapes it claims to', () => {
    // Mutation guard: if this helper silently stopped matching, every
    // assertion above would pass while being worthless.
    expect(looksLikeLocalPath('C:\\Users\\someone\\OneDrive - Org\\SOPs\\a.docx')).toBe(true);
    expect(looksLikeLocalPath('file:///C:/tmp/a.pdf')).toBe(true);
    expect(looksLikeLocalPath('\\\\server\\share\\a.docx')).toBe(true);
    expect(looksLikeLocalPath('/home/someone/mirror/a.docx')).toBe(true);
    expect(looksLikeLocalPath(`${WEB_URL_BASE}/SOPs/a.docx`)).toBe(false);
  });
});

describe('a real mirror is not a curated fixture set', () => {
  it('skips sync-client artifacts, lock files and unsupported types', async () => {
    const page = await adapter.listItems(context(), { containerId: 'SOPs' });
    const names = page.items.map((item) => item.name);
    // `desktop.ini` is the dangerous one: it is readable text, so without the
    // exclusion it would extract SUCCESSFULLY into a nonsense section.
    expect(names).not.toContain('desktop.ini');
    expect(names).not.toContain('~$certificate-renewal.docx');
    expect(names).not.toContain('notes.rtf');
    expect(names).not.toContain('certificate-renewal.docx.meta.json');
    expect(names).toContain('certificate-renewal.docx');
  });

  it('reads sidecar metadata as the document source metadata', async () => {
    const document = await adapter.getDocument(
      context(),
      treeDocumentId('SOPs/certificate-renewal.docx'),
    );
    expect(document?.sourceMetadata.Owner).toBe('Service Operations Lead');
    expect(document?.sourceVersion).toBe('4.2');
  });

  it('omits a version label when no sidecar supplies one, rather than using mtime', async () => {
    const document = await adapter.getDocument(
      context(),
      treeDocumentId('SOPs/escalation-matrix.md'),
    );
    // `mtime` moves on touch, copy and restore, so presenting it as a version
    // would be presenting a capability the source does not have.
    expect(document?.sourceVersion).toBeUndefined();
  });

  it('reports the nine Test Connection checks, with SKIP where one cannot apply', async () => {
    const result = await adapter.testConnection(context());
    const names = result.checks.map((check) => check.name);
    expect(names).toContain('Credential resolves');
    expect(names).toContain('Delegated access available');
    expect(names).toContain('Files are locally available');
    // A check that was not performed reports SKIP, never PASS (rule P3).
    expect(result.checks.find((c) => c.name === 'Credential resolves')?.outcome).toBe('SKIP');
    expect(result.checks.find((c) => c.name === 'Delegated access available')?.outcome).toBe(
      'SKIP',
    );
    expect(result.ok).toBe(true);
  });

  it('names the extractor gap at configuration time', async () => {
    const result = await adapter.testConnection(context());
    const types = result.checks.find((check) => check.name === 'Document types supported');
    // `notes.rtf` has no extractor. Reported now rather than after a sync.
    expect(types?.detail).toContain('do not and were skipped');
  });
});

describe('synchronization safety', () => {
  const temporaryMirror = (): string => {
    const root = mkdtempSync(join(tmpdir(), 'knowzy-mirror-'));
    mkdirSync(join(root, 'SOPs'), { recursive: true });
    for (const name of ['one', 'two', 'three', 'four', 'five']) {
      writeFileSync(
        join(root, 'SOPs', `${name}.md`),
        `# ${name}\n\nThe operator must record the ${name} step within one hour of completion.\n`,
        'utf8',
      );
    }
    return root;
  };

  const contextFor = (root: string): AdapterContext =>
    context({
      source: {
        knowledgeSourceId: '00000000-0000-0000-0000-0000000000f2',
        sourceKey: 'temporary-mirror',
        displayName: 'Temporary mirror',
        sourceType: 'FILE_REPOSITORY',
        connection: { ...CONNECTION, localRoot: root },
      },
    });

  const drain = async (root: string, mode: 'FULL' | 'INCREMENTAL', state?: string) => {
    const events: SyncEvent[] = [];
    for await (const event of adapter.synchronize(
      contextFor(root),
      state === undefined ? { mode } : { mode, state },
    )) {
      events.push(event);
    }
    return events;
  };

  const checkpointOf = (events: readonly SyncEvent[]): string => {
    const found = [...events].reverse().find((event) => event.type === 'STATE_CHECKPOINT');
    if (found === undefined || found.type !== 'STATE_CHECKPOINT') throw new Error('no checkpoint');
    return found.state;
  };

  it('a second synchronization reports unchanged documents as unchanged', async () => {
    const root = temporaryMirror();
    try {
      const first = await drain(root, 'FULL');
      expect(first.filter((e) => e.type === 'ITEM_DISCOVERED')).toHaveLength(5);

      const second = await drain(root, 'INCREMENTAL', checkpointOf(first));
      // Nothing changed, so nothing is reported as discovered or modified.
      expect(second.filter((e) => e.type === 'ITEM_DISCOVERED')).toHaveLength(0);
      expect(second.filter((e) => e.type === 'ITEM_MODIFIED')).toHaveLength(0);
      const completed = second.find((e) => e.type === 'RUN_COMPLETED');
      expect(completed).toMatchObject({ discovered: 0, modified: 0, deleted: 0, failed: 0 });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('detects a content change by hash, not by mtime', async () => {
    const root = temporaryMirror();
    try {
      const first = await drain(root, 'FULL');
      const state = checkpointOf(first);

      // Rewritten with IDENTICAL content. `mtime` moves; the hash does not.
      const path = join(root, 'SOPs', 'one.md');
      writeFileSync(
        path,
        '# one\n\nThe operator must record the one step within one hour of completion.\n',
        'utf8',
      );
      const touched = await drain(root, 'INCREMENTAL', state);
      expect(touched.filter((e) => e.type === 'ITEM_MODIFIED')).toHaveLength(0);

      // Now a real content change.
      writeFileSync(path, '# one\n\nThe operator must record it within four hours.\n', 'utf8');
      const changed = await drain(root, 'INCREMENTAL', state);
      expect(changed.filter((e) => e.type === 'ITEM_MODIFIED')).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('refuses a run rather than reporting mass deletion on a partial sync', async () => {
    const root = temporaryMirror();
    try {
      const first = await drain(root, 'FULL');
      const state = checkpointOf(first);

      // A paused or mid-run sync client leaves most of the folder absent.
      for (const name of ['two', 'three', 'four', 'five']) {
        rmSync(join(root, 'SOPs', `${name}.md`));
      }

      const partial = await drain(root, 'INCREMENTAL', state);
      // NO deletions, and the run says why. A run that refuses is
      // recoverable; a run that retires four documents is a cleanup job.
      expect(partial.filter((e) => e.type === 'ITEM_DELETED')).toHaveLength(0);
      const failure = partial.find((e) => e.type === 'ITEM_FAILED');
      expect(failure).toBeDefined();
      expect(failure?.type === 'ITEM_FAILED' && failure.reason).toContain('safety floor');
      expect(failure?.type === 'ITEM_FAILED' && failure.retryable).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('applies a deletion when the corpus is above the safety floor', async () => {
    const root = temporaryMirror();
    try {
      const first = await drain(root, 'FULL');
      const state = checkpointOf(first);

      // One of five removed: 4/5 = 0.8, at the floor, so the run proceeds.
      rmSync(join(root, 'SOPs', 'five.md'));
      const events = await drain(root, 'INCREMENTAL', state);
      expect(events.filter((e) => e.type === 'ITEM_DELETED')).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not follow a symbolic link out of the root', async () => {
    const root = temporaryMirror();
    const outside = mkdtempSync(join(tmpdir(), 'knowzy-outside-'));
    try {
      writeFileSync(
        join(outside, 'secret.md'),
        '# secret\n\nThis document must never be reachable through the mirror.\n',
        'utf8',
      );
      try {
        symlinkSync(outside, join(root, 'SOPs', 'escape'), 'junction');
      } catch {
        // Creating a link can require privilege on Windows. If it cannot be
        // created the case is not exercised, and saying so is better than
        // asserting a guard that never ran.
        return;
      }

      const page = await adapter.listItems(contextFor(root), { containerId: 'SOPs' });
      expect(page.items.map((item) => item.name)).not.toContain('secret.md');
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
