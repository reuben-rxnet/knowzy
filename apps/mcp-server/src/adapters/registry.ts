// Which adapter serves a source.
//
// knowledge-source-adapters.md §6, "Prohibition": the mock adapter is NEVER
// registered in `test` or `prod`. A startup assertion fails the process if it
// is, so a mock cannot silently serve production traffic. That assertion is
// `createAdapterRegistry` throwing below — the process cannot come up rather
// than coming up wrong.

import {
  createMockKnowledgeSourceAdapter,
  createMockQuestionBankAdapter,
  type KnowledgeSourceAdapter,
  type QuestionBankAdapter,
} from '@knowzy/knowledge-source-adapters';
import type { KnowzyEnv } from '@knowzy/shared-types';
import type { SourceRow } from '../tools/deps.js';

export class MockAdapterNotPermittedError extends Error {
  constructor(environment: KnowzyEnv) {
    super(
      `The mock knowledge source adapter cannot be registered in the "${environment}" environment. ` +
        'A mock serving real traffic would produce questions grounded in fixtures.',
    );
    this.name = 'MockAdapterNotPermittedError';
  }
}

export class NoAdapterRegisteredError extends Error {
  constructor(sourceType: string) {
    super(
      `No knowledge source adapter is registered for source type "${sourceType}". ` +
        'Implementing one adapter is the whole cost of adding a source type (goal G8).',
    );
    this.name = 'NoAdapterRegisteredError';
  }
}

export interface AdapterRegistryOptions {
  readonly environment: KnowzyEnv;
  /** Required to register the mock; ignored outside `local`. */
  readonly fixtureRoot?: string;
  /** Where the mock bank persists its items. Defaults to `fixtureRoot`. */
  readonly bankFixtureRoot?: string;
}

export interface AdapterRegistry {
  readonly registeredTypes: readonly string[];
  readonly forSource: (source: SourceRow) => KnowledgeSourceAdapter;
  /**
   * The Question Bank, or null.
   *
   * knowledge-source-adapters.md §1.1: two INDEPENDENT ports, with separate
   * credentials and separate permission grants. They are resolved separately
   * here for the same reason — a source adapter being available says nothing
   * about whether the bank is writable.
   */
  readonly questionBank: QuestionBankAdapter | null;
}

export const createAdapterRegistry = (options: AdapterRegistryOptions): AdapterRegistry => {
  const adapters = new Map<string, KnowledgeSourceAdapter>();

  if (options.fixtureRoot !== undefined) {
    if (options.environment !== 'local') throw new MockAdapterNotPermittedError(options.environment);
    adapters.set(
      'MOCK',
      createMockKnowledgeSourceAdapter({ fixtureRoot: options.fixtureRoot }),
    );
  }

  // SHAREPOINT lands in Phase 7. Until then a SharePoint source row resolves to
  // NoAdapterRegisteredError, which is the honest answer: the source cannot be
  // read. Registering a stand-in that returned fixture data would make a
  // misconfigured production source look like a working one.

  // The mock bank carries the same prohibition as the mock source: fixtures on
  // disk, local only, and the process refuses to construct it elsewhere.
  const questionBank =
    options.fixtureRoot === undefined
      ? null
      : createMockQuestionBankAdapter({ fixtureRoot: options.bankFixtureRoot ?? options.fixtureRoot });

  return {
    registeredTypes: [...adapters.keys()].sort(),
    questionBank,
    forSource: (source: SourceRow): KnowledgeSourceAdapter => {
      const adapter = adapters.get(source.sourceType);
      if (!adapter) throw new NoAdapterRegisteredError(source.sourceType);
      return adapter;
    },
  };
};
