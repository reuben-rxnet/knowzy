// The adapter conformance suite — knowledge-source-adapters.md §8.
//
// "One executable suite, run against every registered adapter with its own
// fixtures. This is the test that makes G8 verifiable instead of aspirational."
//
// Suite rule 1 is the reason this file is a suite and not a set of mock tests:
// **the suite is the contract**. A behaviour asserted here is normative for
// every adapter; a behaviour absent here is not guaranteed to any consumer. So
// the SharePoint adapter in Phase 7 will be handed this same function, and the
// groups it cannot yet satisfy are the work it has left.
//
// Groups whose subject matter does not exist yet (section lineage needs
// versioned fixtures; bank assertions need the other port; end-to-end needs the
// full pipeline) are declared as `todo` rather than omitted, so the suite
// states what it does not yet assert instead of looking complete.

import { describe, expect, it } from 'vitest';
import type {
  AdapterContext,
  BankContext,
  BankItemWrite,
  ExtractedContent,
  KnowledgeSourceAdapter,
  QuestionBankAdapter,
  SourceItem,
  SyncEvent,
} from '@knowzy/knowledge-source-adapters';

export interface ConformanceSubject {
  readonly name: string;
  readonly adapter: KnowledgeSourceAdapter;
  /** A fresh context per call, so one test cannot leak state into another. */
  readonly context: (overrides?: Partial<AdapterContext>) => AdapterContext;
  /** A document the fixture set declares accessible. */
  readonly allowedDocumentPath: string;
  /** A document the fixture set declares DENIED. */
  readonly deniedDocumentPath: string;
  /** A document with no heading structure, to exercise the X4 fallback. */
  readonly unstructuredDocumentPath: string;
  /** Resolves a fixture-relative path to the adapter's document id. */
  readonly documentId: (relativePath: string) => string;
}

const collect = async (events: AsyncIterable<SyncEvent>): Promise<SyncEvent[]> => {
  const out: SyncEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
};

const lastCheckpoint = (events: readonly SyncEvent[]): string | undefined => {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (event?.type === 'STATE_CHECKPOINT') return event.state;
  }
  return undefined;
};

const drainListing = async (
  subject: ConformanceSubject,
  containerId: string,
): Promise<SourceItem[]> => {
  const items: SourceItem[] = [];
  let cursor: string | undefined;
  let guard = 0;

  do {
    const page = await subject.adapter.listItems(subject.context(), {
      containerId,
      recursive: true,
      pageSize: 2,
      ...(cursor === undefined ? {} : { cursor }),
    });
    items.push(...page.items);
    cursor = page.nextCursor;
    guard += 1;
    expect(guard).toBeLessThan(100);
  } while (cursor !== undefined);

  return items;
};

export const runAdapterConformanceSuite = (subject: ConformanceSubject): void => {
  describe(`adapter conformance: ${subject.name}`, () => {
    // ------------------------------------------------------ capability honesty
    describe('capability honesty', () => {
      it('declares writeCapable as the literal false', () => {
        expect(subject.adapter.capabilities.writeCapable).toBe(false);
      });

      it('declares only document types it can actually extract', async () => {
        const declared = subject.adapter.capabilities.supportedDocumentTypes;
        expect(declared.length).toBeGreaterThan(0);

        const content = await subject.adapter.extractContent(
          subject.context(),
          subject.documentId(subject.allowedDocumentPath),
          {},
        );
        expect(content.status).toBe('EXTRACTED');
      });

      it('reports its capabilities from testConnection, not from a separate guess', async () => {
        const result = await subject.adapter.testConnection(subject.context());
        expect(result.capabilities).toEqual(subject.adapter.capabilities);
      });

      it('labels a capability it lacks as SKIP rather than PASS', async () => {
        const result = await subject.adapter.testConnection(subject.context());
        if (!subject.adapter.capabilities.supportsLiveSearch) {
          const check = result.checks.find((c) => c.name === 'Live search');
          expect(check?.outcome).toBe('SKIP');
          expect(check?.detail).toMatch(/does not support live search/i);
        }
      });

      it('never reports ALLOWED when it cannot check permissions', async () => {
        if (subject.adapter.capabilities.supportsPermissionCheck) return;
        const decision = await subject.adapter.getEffectiveAccess(
          subject.context(),
          subject.documentId(subject.allowedDocumentPath),
        );
        expect(decision.decision).toBe('UNKNOWN');
      });

      it('runs a full sync when it cannot do incremental', async () => {
        if (subject.adapter.capabilities.supportsIncrementalSync) return;
        const events = await collect(
          subject.adapter.synchronize(subject.context(), { mode: 'INCREMENTAL' }),
        );
        expect(events.some((e) => e.type === 'ITEM_DISCOVERED')).toBe(true);
      });
    });

    // ------------------------------------------------------------- navigation
    describe('navigation', () => {
      it('lists containers with a name and a count', async () => {
        const containers = await subject.adapter.listContainers(subject.context());
        expect(containers.length).toBeGreaterThan(0);
        for (const container of containers) {
          expect(container.containerName.length).toBeGreaterThan(0);
        }
      });

      it('traverses folders one level at a time', async () => {
        const containers = await subject.adapter.listContainers(subject.context());
        const containerId = containers[0]?.containerId ?? '';
        const top = await subject.adapter.listItems(subject.context(), { containerId });
        const folder = top.items.find((item) => item.kind === 'FOLDER');

        if (folder) {
          const inner = await subject.adapter.listItems(subject.context(), {
            containerId,
            folderPath: folder.folderPath,
          });
          expect(inner.items.length).toBeGreaterThan(0);
        }
      });

      it('completes pagination with a stable total', async () => {
        const containers = await subject.adapter.listContainers(subject.context());
        const containerId = containers[0]?.containerId ?? '';
        const first = await subject.adapter.listItems(subject.context(), {
          containerId,
          recursive: true,
          pageSize: 2,
        });
        const all = await drainListing(subject, containerId);
        expect(first.totalCount).toBe(all.length);
        expect(new Set(all.map((i) => `${i.folderPath}/${i.name}`)).size).toBe(all.length);
      });

      it('returns an empty page for an unknown folder rather than an error', async () => {
        const containers = await subject.adapter.listContainers(subject.context());
        const page = await subject.adapter.listItems(subject.context(), {
          containerId: containers[0]?.containerId ?? '',
          folderPath: 'no-such-folder',
        });
        expect(page.items).toEqual([]);
      });

      it('rejects traversal outside the configured tree', async () => {
        const containers = await subject.adapter.listContainers(subject.context());
        const containerId = containers[0]?.containerId ?? '';

        // Asserted against a REAL container, so the test cannot pass merely
        // because the container name was also nonsense.
        for (const folderPath of ['..', '../..', '../../etc', '/etc', 'Network/../../secrets']) {
          const page = await subject.adapter.listItems(subject.context(), {
            containerId,
            folderPath,
            recursive: true,
          });
          expect(page.items).toEqual([]);
        }

        for (const badContainer of ['..', '../Policies', '/etc']) {
          const page = await subject.adapter.listItems(subject.context(), {
            containerId: badContainer,
            recursive: true,
          });
          expect(page.items).toEqual([]);
        }
      });

      it('returns null for a document id it does not have', async () => {
        const document = await subject.adapter.getDocument(subject.context(), 'not-a-real-id');
        expect(document).toBeNull();
      });
    });

    // ------------------------------------------------------------ determinism
    describe('determinism', () => {
      it('produces identical ids, hashes, keys, and offsets across runs', async () => {
        const id = subject.documentId(subject.allowedDocumentPath);
        const first = await subject.adapter.extractContent(subject.context(), id, {});
        const second = await subject.adapter.extractContent(subject.context(), id, {});
        expect(JSON.stringify(second)).toBe(JSON.stringify(first));
      });

      it('derives the document id from the path, not from the filesystem', async () => {
        const id = subject.documentId(subject.allowedDocumentPath);
        const document = await subject.adapter.getDocument(subject.context(), id);
        expect(document?.sourceDocumentId).toBe(id);
      });

      it('lists items in a stable order', async () => {
        const containers = await subject.adapter.listContainers(subject.context());
        const containerId = containers[0]?.containerId ?? '';
        const a = await drainListing(subject, containerId);
        const b = await drainListing(subject, containerId);
        expect(b.map((i) => i.name)).toEqual(a.map((i) => i.name));
      });
    });

    // ----------------------------------------------- extraction invariants
    describe('extraction invariants', () => {
      const extracted = async (path: string): Promise<ExtractedContent> =>
        subject.adapter.extractContent(subject.context(), subject.documentId(path), {});

      it('X2 — every section offset round-trips against the returned text', async () => {
        for (const path of [subject.allowedDocumentPath, subject.unstructuredDocumentPath]) {
          const content = await extracted(path);
          expect(content.status).toBe('EXTRACTED');
          expect(content.sections.length).toBeGreaterThan(0);
          for (const section of content.sections) {
            expect(content.normalizedText?.slice(section.startOffset, section.endOffset)).toBe(
              section.text,
            );
          }
        }
      });

      it('X3 — sections are ordered and do not overlap', async () => {
        const content = await extracted(subject.allowedDocumentPath);
        let previousEnd = -1;
        content.sections.forEach((section, index) => {
          expect(section.ordinal).toBe(index + 1);
          expect(section.startOffset).toBeGreaterThan(previousEnd);
          expect(section.endOffset).toBeGreaterThan(section.startOffset);
          previousEnd = section.endOffset;
        });
      });

      it('X4 — a document without headings gets honest labels, not invented ones', async () => {
        const content = await extracted(subject.unstructuredDocumentPath);
        expect(content.sections.length).toBeGreaterThan(0);
        for (const section of content.sections) {
          expect(section.heading).toBeUndefined();
          expect(section.label.length).toBeGreaterThan(0);
        }
      });

      it('X7 — the content hash is present and stable for extracted content', async () => {
        const content = await extracted(subject.allowedDocumentPath);
        expect(content.contentHash).toMatch(/^[0-9a-f]{64}$/);
        const again = await extracted(subject.allowedDocumentPath);
        expect(again.contentHash).toBe(content.contentHash);
      });

      it('reports a char count that matches the text it returned', async () => {
        const content = await extracted(subject.allowedDocumentPath);
        expect(content.charCount).toBe(content.normalizedText?.length);
      });
    });

    // --------------------------------------------------- unsupported handling
    describe('unsupported handling', () => {
      it('returns no text with a non-EXTRACTED status', async () => {
        const content = await subject.adapter.extractContent(
          subject.context({
            limits: { maxBytes: 10, maxCharsPerDocument: 200_000, pageSize: 50 },
          }),
          subject.documentId(subject.allowedDocumentPath),
          {},
        );
        expect(content.status).toBe('TOO_LARGE');
        expect(content.normalizedText).toBeUndefined();
        expect(content.sections).toEqual([]);
        expect(content.reason).toBeTruthy();
      });

      it('applies the size cap before extracting, not after', async () => {
        const content = await subject.adapter.extractContent(
          subject.context({
            limits: { maxBytes: 10, maxCharsPerDocument: 200_000, pageSize: 50 },
          }),
          subject.documentId(subject.allowedDocumentPath),
          {},
        );
        expect(content.charCount).toBe(0);
      });

      it('throws a typed not-found error rather than returning empty content', async () => {
        await expect(
          subject.adapter.extractContent(subject.context(), 'not-a-real-id', {}),
        ).rejects.toThrow();
      });
    });

    // -------------------------------------------------------------- truncation
    describe('truncation', () => {
      it('sets truncated and ends at a section boundary', async () => {
        const content = await subject.adapter.extractContent(
          subject.context(),
          subject.documentId(subject.allowedDocumentPath),
          { maxChars: 500 },
        );
        expect(content.truncated).toBe(true);
        expect(content.reason).toBeTruthy();

        const last = content.sections[content.sections.length - 1];
        expect(last?.endOffset).toBe(content.normalizedText?.length);
      });

      it('does not report truncation for a document within the cap', async () => {
        const content = await subject.adapter.extractContent(
          subject.context(),
          subject.documentId(subject.allowedDocumentPath),
          { maxChars: 500_000 },
        );
        expect(content.truncated).toBe(false);
      });
    });

    // --------------------------------------------------------- change detection
    describe('change detection', () => {
      it('discovers every configured item on a full run', async () => {
        const events = await collect(
          subject.adapter.synchronize(subject.context(), { mode: 'FULL' }),
        );
        const discovered = events.filter((e) => e.type === 'ITEM_DISCOVERED');
        expect(discovered.length).toBeGreaterThan(0);

        const completed = events[events.length - 1];
        expect(completed?.type).toBe('RUN_COMPLETED');
        if (completed?.type === 'RUN_COMPLETED') {
          expect(completed.discovered).toBe(discovered.length);
        }
      });

      it('emits a checkpoint the platform can persist and replay', async () => {
        const first = await collect(
          subject.adapter.synchronize(subject.context(), { mode: 'FULL' }),
        );
        const state = lastCheckpoint(first);
        expect(state).toBeTruthy();

        const second = await collect(
          subject.adapter.synchronize(subject.context(), { mode: 'INCREMENTAL', state }),
        );
        // Nothing changed between the runs, so an incremental run must report
        // no work rather than re-discovering everything.
        expect(second.filter((e) => e.type === 'ITEM_DISCOVERED')).toEqual([]);
        expect(second.filter((e) => e.type === 'ITEM_MODIFIED')).toEqual([]);
      });

      it('reports a document absent from the previous run as deleted', async () => {
        const state = JSON.stringify({ 'id-that-no-longer-exists': '1.0' });
        const events = await collect(
          subject.adapter.synchronize(subject.context(), { mode: 'INCREMENTAL', state }),
        );
        expect(
          events.some(
            (e) => e.type === 'ITEM_DELETED' && e.sourceDocumentId === 'id-that-no-longer-exists',
          ),
        ).toBe(true);
      });

      it('reports a changed sourceVersion as modified', async () => {
        const full = await collect(subject.adapter.synchronize(subject.context(), { mode: 'FULL' }));
        const state = lastCheckpoint(full) ?? '{}';
        const stale = JSON.stringify(
          Object.fromEntries(
            Object.keys(JSON.parse(state) as Record<string, string>).map((id) => [id, 'stale']),
          ),
        );
        const events = await collect(
          subject.adapter.synchronize(subject.context(), { mode: 'INCREMENTAL', state: stale }),
        );
        expect(events.filter((e) => e.type === 'ITEM_MODIFIED').length).toBeGreaterThan(0);
      });

      it.todo('a metadata-only change yields a new sourceVersion with an unchanged hash');
    });

    // ---------------------------------------------------------------- permission
    describe('permission', () => {
      it('answers a denied document with DENIED and a stated reason', async () => {
        const decision = await subject.adapter.getEffectiveAccess(
          subject.context(),
          subject.documentId(subject.deniedDocumentPath),
        );
        expect(decision.decision).toBe('DENIED');
        expect(decision.summary).toBeTruthy();
        expect(decision.enforcement).not.toBe('NONE');
      });

      it('excludes a denied document from listing', async () => {
        const containers = await subject.adapter.listContainers(subject.context());
        const names: string[] = [];
        for (const container of containers) {
          names.push(...(await drainListing(subject, container.containerId)).map((i) => i.name));
        }
        const deniedName = subject.deniedDocumentPath.split('/').pop() ?? '';
        expect(names).not.toContain(deniedName);
      });

      it('excludes a denied document from search', async () => {
        const page = await subject.adapter.searchDocuments(subject.context(), {
          text: 'remuneration',
        });
        const deniedName = subject.deniedDocumentPath.split('/').pop() ?? '';
        expect(page.items.map((h) => h.document.name)).not.toContain(deniedName);
      });

      it('refuses extraction of a denied document', async () => {
        await expect(
          subject.adapter.extractContent(
            subject.context(),
            subject.documentId(subject.deniedDocumentPath),
            {},
          ),
        ).rejects.toThrow(/DENIED/i);
      });

      it('answers an unknown document id with DENIED, never with a maybe', async () => {
        const decision = await subject.adapter.getEffectiveAccess(
          subject.context(),
          'not-a-real-id',
        );
        expect(decision.decision).toBe('DENIED');
      });
    });

    // ---------------------------------------------------------------- resilience
    describe('resilience', () => {
      it('stops on an aborted signal rather than completing in the background', async () => {
        const controller = new AbortController();
        controller.abort();
        await expect(
          subject.adapter.listContainers(subject.context({ signal: controller.signal })),
        ).rejects.toThrow(/abort/i);
      });

      it('falls back to a full run when the checkpoint is unreadable', async () => {
        const events = await collect(
          subject.adapter.synchronize(subject.context(), {
            mode: 'INCREMENTAL',
            state: 'not-json-at-all',
          }),
        );
        expect(events.filter((e) => e.type === 'ITEM_DISCOVERED').length).toBeGreaterThan(0);
        expect(events[events.length - 1]?.type).toBe('RUN_COMPLETED');
      });

      it.todo('an injected 429 honours Retry-After');
      it.todo('repeated failures open the circuit');
    });

    // ------------------------------------------------------------------ leakage
    describe('leakage', () => {
      it('returns a bounded snippet from search, never the whole document', async () => {
        const page = await subject.adapter.searchDocuments(subject.context(), { text: 'refund' });
        expect(page.items.length).toBeGreaterThan(0);
        for (const hit of page.items) {
          if (hit.snippet === undefined) continue;
          expect(hit.snippet.length).toBeLessThan(400);
        }
      });

      it('never echoes a credential into its output', async () => {
        const result = await subject.adapter.testConnection(subject.context());
        const serialized = JSON.stringify(result);
        expect(serialized).not.toMatch(/secret|password|bearer |eyJ/i);
      });
    });

    // ----------------------------------------------- declared, not yet asserted
    describe('groups pending later milestones', () => {
      it.todo('section lineage across document versions (needs versioned fixtures)');
      it.todo('failure isolation across a ten-document extraction');
      it.todo('end-to-end: approved, published, assessable, scoreable question');
    });
  });
};

/**
 * The bank half of the conformance suite — §8, the "Bank (bank adapters only)"
 * group: "operationKey reuse creates one item; stale ifMatch returns a
 * conditional failure; retire sets inactive without deleting; NO DELETE METHOD
 * EXISTS."
 *
 * Separate from the source suite because §1.1 makes these two INDEPENDENT
 * ports — an adapter implements one or the other, never both.
 */
export interface BankConformanceSubject {
  readonly name: string;
  readonly bank: QuestionBankAdapter;
  readonly context: () => BankContext;
  readonly sampleItem: (questionId: string) => BankItemWrite;
}

export const runBankConformanceSuite = (subject: BankConformanceSubject): void => {
  describe(`bank conformance: ${subject.name}`, () => {
    it('declares whether it supports conditional updates', () => {
      // false is a legal answer, and it means publishing is REFUSED for that
      // bank rather than falling back to a blind overwrite.
      expect(typeof subject.bank.capabilities.supportsConditionalUpdate).toBe('boolean');
    });

    it('exposes NO delete method (G7)', () => {
      for (const name of ['deleteItem', 'delete', 'remove', 'purge', 'destroy']) {
        expect(name in subject.bank, name).toBe(false);
      }
    });

    it('creates one item for a reused operation key', async () => {
      const ctx = subject.context();
      const item = subject.sampleItem('KNZ-CONF-2026-000100');
      const first = await subject.bank.createItem(ctx, item, 'conf-key-1');
      const replay = await subject.bank.createItem(ctx, item, 'conf-key-1');
      expect(replay.itemId).toBe(first.itemId);
      expect(replay.outcome).toBe('ALREADY_CURRENT');

      const page = await subject.bank.queryItems(ctx, {});
      expect(page.items.filter((row) => row.questionId === item.questionId)).toHaveLength(1);
    });

    it('creates one item even for a DIFFERENT key with the same QuestionID', async () => {
      const ctx = subject.context();
      const item = subject.sampleItem('KNZ-CONF-2026-000101');
      const first = await subject.bank.createItem(ctx, item, 'conf-key-a');
      const second = await subject.bank.createItem(ctx, item, 'conf-key-b');
      expect(second.itemId).toBe(first.itemId);
    });

    it('returns a conditional failure on a stale ifMatch', async () => {
      const ctx = subject.context();
      const created = await subject.bank.createItem(
        ctx,
        subject.sampleItem('KNZ-CONF-2026-000102'),
        'conf-key-etag-1',
      );
      await subject.bank.updateItem(ctx, created.itemId, { version: 2 }, created.eTag, 'conf-key-etag-2');
      await expect(
        subject.bank.updateItem(ctx, created.itemId, { version: 3 }, created.eTag, 'conf-key-etag-3'),
      ).rejects.toThrow();
    });

    it('retires by setting inactive, without deleting', async () => {
      const ctx = subject.context();
      const item = subject.sampleItem('KNZ-CONF-2026-000103');
      const created = await subject.bank.createItem(ctx, item, 'conf-key-retire-1');
      await subject.bank.retireItem(
        ctx,
        created.itemId,
        created.eTag,
        'Retired by the conformance suite.',
        'conf-key-retire-2',
      );

      const found = await subject.bank.findByQuestionId(ctx, item.questionId);
      expect(found).not.toBeNull();
      expect(found?.isActive).toBe(false);
      expect(found?.status).toBe('Retired');
    });

    it('records the operation key on every write result', async () => {
      const ctx = subject.context();
      const result = await subject.bank.createItem(
        ctx,
        subject.sampleItem('KNZ-CONF-2026-000104'),
        'conf-key-record',
      );
      expect(result.operationKey).toBe('conf-key-record');
      expect(result.fieldsWritten.length).toBeGreaterThan(0);
    });
  });
};
