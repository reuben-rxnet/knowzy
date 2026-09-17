// @knowzy/knowledge-source-adapters
//
// KnowledgeSourceAdapter and QuestionBankAdapter implementations.
//
// Boundary: B5: may not import database, domain, claude-services, or reporting. Adapters are pure. This is the ONLY place a Graph type or a SharePoint internal field name may appear, and B2 keeps apps/api from importing it at all.
//
// NOT IMPLEMENTED IN PHASE 1. This package exists in the Foundation phase so
// the boundary rules in repository-structure.md §5 are enforceable from the
// first commit — a rule that only starts applying once the code arrives is a
// rule the code will already have broken. Implementation lands in Phase 3 (mock) and Phase 7 (SharePoint).
//
// The placeholder exports below keep the module resolvable without asserting
// any behaviour. They are removed by the phase that implements this package.

export const PACKAGE_NAME = '@knowzy/knowledge-source-adapters' as const;

/** The delivery phase that implements this package. */
export const IMPLEMENTED_IN = 'Phase 3 (mock) and Phase 7 (SharePoint)' as const;
