// @knowzy/domain
//
// Domain services: generation, review and approval, publishing, assessment, session, scoring, recommendation, recognition.
//
// Boundary: B3: may not import any Graph, SharePoint, or adapter type, transitively. Domain services speak adapter interfaces only. C6: use the injected Clock, never new Date().
//
// NOT IMPLEMENTED IN PHASE 1. This package exists in the Foundation phase so
// the boundary rules in repository-structure.md §5 are enforceable from the
// first commit — a rule that only starts applying once the code arrives is a
// rule the code will already have broken. Implementation lands in Phases 3-9.
//
// The placeholder exports below keep the module resolvable without asserting
// any behaviour. They are removed by the phase that implements this package.

export const PACKAGE_NAME = '@knowzy/domain' as const;

/** The delivery phase that implements this package. */
export const IMPLEMENTED_IN = 'Phases 3-9' as const;
