// @knowzy/knowledge-source-adapters
//
// KnowledgeSourceAdapter and QuestionBankAdapter implementations.
//
// Boundary: B5 — may not import database, domain, claude-services, or
// reporting. Adapters are pure: they receive configuration and return data.
// This is the ONLY place a Graph type or a SharePoint internal field name may
// appear, and B2 keeps apps/api from importing it at all.
//
// SharePoint implementations land in Phase 7. The mock is not a stand-in for
// them: it is the substrate for the conformance suite both must pass.

export * from './contract.js';
export {
  createMockKnowledgeSourceAdapter,
  MOCK_CAPABILITIES,
  type MockAdapterOptions,
  type MockFault,
} from './mock/mock-knowledge-source.js';
export {
  fixtureDocumentId,
  loadFixtureTree,
  readFixtureContent,
  FIXTURE_BASE_DATE,
  type FixtureDocument,
  type FixtureTree,
  type FixtureSidecar,
  type FixtureAccessMap,
} from './mock/fixture-tree.js';

export const PACKAGE_NAME = '@knowzy/knowledge-source-adapters' as const;
