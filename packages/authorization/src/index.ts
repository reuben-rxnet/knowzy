// @knowzy/authorization
//
// Policy registry and engine, permission resolution, DataScope construction, envelope signing.
//
// Boundary: Database access limited to the role and scope repositories it is injected.
//
// NOT IMPLEMENTED IN PHASE 1. This package exists in the Foundation phase so
// the boundary rules in repository-structure.md §5 are enforceable from the
// first commit — a rule that only starts applying once the code arrives is a
// rule the code will already have broken. Implementation lands in Phase 2.
//
// The placeholder exports below keep the module resolvable without asserting
// any behaviour. They are removed by the phase that implements this package.

export const PACKAGE_NAME = '@knowzy/authorization' as const;

/** The delivery phase that implements this package. */
export const IMPLEMENTED_IN = 'Phase 2' as const;
