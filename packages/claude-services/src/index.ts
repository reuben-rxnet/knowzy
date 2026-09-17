// @knowzy/claude-services
//
// Prompt registry and versioning, untrusted-content framing, structured output parsing, evidence verification, token accounting.
//
// Boundary: B4: may not reach a database client, transitively. The prompt layer has no data access, so it cannot widen retrieval.
//
// NOT IMPLEMENTED IN PHASE 1. This package exists in the Foundation phase so
// the boundary rules in repository-structure.md §5 are enforceable from the
// first commit — a rule that only starts applying once the code arrives is a
// rule the code will already have broken. Implementation lands in Phase 4.
//
// The placeholder exports below keep the module resolvable without asserting
// any behaviour. They are removed by the phase that implements this package.

export const PACKAGE_NAME = '@knowzy/claude-services' as const;

/** The delivery phase that implements this package. */
export const IMPLEMENTED_IN = 'Phase 4' as const;
