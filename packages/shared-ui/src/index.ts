// @knowzy/shared-ui
//
// Design system: Radix primitives, Tailwind tokens, one component per concern.
//
// Boundary: B6: may import nothing but @knowzy/shared-types. No business logic, no data fetching, no API client.
//
// NOT IMPLEMENTED IN PHASE 1. This package exists in the Foundation phase so
// the boundary rules in repository-structure.md §5 are enforceable from the
// first commit — a rule that only starts applying once the code arrives is a
// rule the code will already have broken. Implementation lands in Phase 5 (review workspace) and Phase 6 (quiz runner).
//
// The placeholder exports below keep the module resolvable without asserting
// any behaviour. They are removed by the phase that implements this package.

export const PACKAGE_NAME = '@knowzy/shared-ui' as const;

/** The delivery phase that implements this package. */
export const IMPLEMENTED_IN = 'Phase 5 (review workspace) and Phase 6 (quiz runner)' as const;
