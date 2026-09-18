// MockQuestionBankAdapter — knowledge-source-adapters.md §6.
//
// "Persists items as JSON under fixtures/bank/, with REAL operationKey
//  uniqueness, REAL ETag semantics (a monotonic counter), and REAL 412
//  behaviour on a stale ifMatch."
//
// Those three words "real" are the specification. A mock that accepted any
// ifMatch would make the conditional-update guarantee (G8) untested, and
// idempotency (G5) is the property most likely to be wrong in production and
// least likely to be exercised by hand — so the mock enforces both for real.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  BankItemNotFoundError,
  BankPreconditionFailedError,
  type BankCapabilities,
  type BankContext,
  type BankItem,
  type BankItemWrite,
  type BankPage,
  type BankQuery,
  type QuestionBankAdapter,
} from '@knowzy/shared-types';

export const MOCK_BANK_CAPABILITIES: BankCapabilities = {
  supportsConditionalUpdate: true,
  supportsNativeVersioning: false,
  supportsIndexedFilter: true,
};

interface StoredItem {
  itemId: string;
  eTagCounter: number;
  questionId: string;
  version: number;
  isActive: boolean;
  isPublished: boolean;
  status: string;
  fields: Record<string, unknown>;
  retireComment?: string;
}

interface BankState {
  /** Monotonic, so an item id is stable and predictable across runs. */
  nextItemNumber: number;
  items: StoredItem[];
  /** operationKey → the result it produced. The idempotency record (G5). */
  operations: Record<string, { itemId: string; eTag: string; outcome: string }>;
}

const EMPTY: BankState = { nextItemNumber: 1, items: [], operations: {} };

export interface MockBankOptions {
  /** e.g. fixtures/bank. One JSON file per target list. */
  readonly fixtureRoot: string;
}

const eTagOf = (item: StoredItem): string => `"mock-etag-${item.itemId}-${item.eTagCounter}"`;

const toBankItem = (item: StoredItem): BankItem => ({
  itemId: item.itemId,
  eTag: eTagOf(item),
  questionId: item.questionId,
  version: item.version,
  isActive: item.isActive,
  isPublished: item.isPublished,
  status: item.status,
  fields: item.fields,
});

export const createMockQuestionBankAdapter = (
  options: MockBankOptions,
): QuestionBankAdapter => {
  const pathFor = (ctx: BankContext): string =>
    join(options.fixtureRoot, `${ctx.targetListId.replace(/[^\w.-]/g, '_')}.json`);

  const load = (ctx: BankContext): BankState => {
    try {
      return JSON.parse(readFileSync(pathFor(ctx), 'utf8')) as BankState;
    } catch {
      // A missing file is an empty bank, not an error: the first publish into a
      // fresh environment must work.
      return structuredClone(EMPTY);
    }
  };

  const save = (ctx: BankContext, state: BankState): void => {
    const path = pathFor(ctx);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  };

  const assertNotAborted = (ctx: BankContext): void => {
    if (ctx.signal.aborted) throw new Error('The bank operation was aborted before it completed.');
  };

  return {
    bankType: 'MOCK',
    capabilities: MOCK_BANK_CAPABILITIES,

    async findByQuestionId(ctx, questionId) {
      assertNotAborted(ctx);
      const found = load(ctx).items.find((item) => item.questionId === questionId);
      return found ? toBankItem(found) : null;
    },

    async queryItems(ctx, query: BankQuery): Promise<BankPage<BankItem>> {
      assertNotAborted(ctx);
      const all = load(ctx)
        .items.filter((item) =>
          query.domainCode === undefined
            ? true
            : item.fields['domainCode'] === query.domainCode,
        )
        .filter((item) => (query.isActive === undefined ? true : item.isActive === query.isActive))
        .sort((a, b) => a.questionId.localeCompare(b.questionId));

      const start = query.cursor === undefined ? 0 : Number.parseInt(query.cursor, 10) || 0;
      const size = query.pageSize ?? 50;
      const slice = all.slice(start, start + size);
      const end = start + slice.length;

      return {
        items: slice.map(toBankItem),
        ...(end < all.length ? { nextCursor: String(end) } : {}),
        totalCount: all.length,
      };
    },

    async createItem(ctx, item: BankItemWrite, operationKey) {
      assertNotAborted(ctx);
      const state = load(ctx);

      // Idempotency, checked FIRST. A retried create whose response was lost
      // must not produce a second item (G5).
      const replay = state.operations[operationKey];
      if (replay) {
        return {
          itemId: replay.itemId,
          eTag: replay.eTag,
          operationKey,
          outcome: 'ALREADY_CURRENT',
          fieldsWritten: [],
        };
      }

      // The pre-write existence check the workflow also performs. Belt and
      // braces on purpose: this is the one invariant a duplicate would violate
      // permanently, and the bank is the last line.
      const existing = state.items.find((row) => row.questionId === item.questionId);
      if (existing) {
        return {
          itemId: existing.itemId,
          eTag: eTagOf(existing),
          operationKey,
          outcome: 'ALREADY_CURRENT',
          fieldsWritten: [],
        };
      }

      const stored: StoredItem = {
        itemId: `mock-item-${String(state.nextItemNumber).padStart(6, '0')}`,
        eTagCounter: 1,
        questionId: item.questionId,
        version: item.version,
        isActive: item.isActive,
        isPublished: item.isPublished,
        status: item.status,
        fields: { ...item },
      };
      state.nextItemNumber += 1;
      state.items.push(stored);
      const eTag = eTagOf(stored);
      state.operations[operationKey] = { itemId: stored.itemId, eTag, outcome: 'CREATED' };
      save(ctx, state);

      return {
        itemId: stored.itemId,
        eTag,
        operationKey,
        outcome: 'CREATED',
        fieldsWritten: Object.keys(item),
      };
    },

    async updateItem(ctx, itemId, patch, ifMatch, operationKey) {
      assertNotAborted(ctx);
      const state = load(ctx);

      const replay = state.operations[operationKey];
      if (replay) {
        return {
          itemId: replay.itemId,
          eTag: replay.eTag,
          operationKey,
          outcome: 'ALREADY_CURRENT',
          fieldsWritten: [],
        };
      }

      const stored = state.items.find((row) => row.itemId === itemId);
      if (!stored) throw new BankItemNotFoundError(itemId);

      // REAL 412. A stale ifMatch means someone else wrote, and the caller must
      // re-read and re-decide — never overwrite (G8).
      const current = eTagOf(stored);
      if (ifMatch !== current) throw new BankPreconditionFailedError(itemId, current);

      Object.assign(stored.fields, patch);
      if (patch.version !== undefined) stored.version = patch.version;
      if (patch.isActive !== undefined) stored.isActive = patch.isActive;
      if (patch.isPublished !== undefined) stored.isPublished = patch.isPublished;
      if (patch.status !== undefined) stored.status = patch.status;
      stored.eTagCounter += 1;

      const eTag = eTagOf(stored);
      state.operations[operationKey] = { itemId, eTag, outcome: 'UPDATED' };
      save(ctx, state);

      return {
        itemId,
        eTag,
        operationKey,
        outcome: 'UPDATED',
        fieldsWritten: Object.keys(patch),
      };
    },

    async retireItem(ctx, itemId, ifMatch, comment, operationKey) {
      assertNotAborted(ctx);
      const state = load(ctx);

      const replay = state.operations[operationKey];
      if (replay) {
        return {
          itemId: replay.itemId,
          eTag: replay.eTag,
          operationKey,
          outcome: 'ALREADY_CURRENT',
          fieldsWritten: [],
        };
      }

      const stored = state.items.find((row) => row.itemId === itemId);
      if (!stored) throw new BankItemNotFoundError(itemId);

      const current = eTagOf(stored);
      if (ifMatch !== current) throw new BankPreconditionFailedError(itemId, current);

      // G7: the item STAYS. Retirement sets flags, and the comment is recorded
      // on the item so the reason travels with it.
      stored.isActive = false;
      stored.status = 'Retired';
      stored.retireComment = comment;
      stored.fields['isActive'] = false;
      stored.fields['status'] = 'Retired';
      stored.fields['retireComment'] = comment;
      stored.eTagCounter += 1;

      const eTag = eTagOf(stored);
      state.operations[operationKey] = { itemId, eTag, outcome: 'RETIRED' };
      save(ctx, state);

      return {
        itemId,
        eTag,
        operationKey,
        outcome: 'RETIRED',
        fieldsWritten: ['isActive', 'status', 'retireComment'],
      };
    },
  };
};
