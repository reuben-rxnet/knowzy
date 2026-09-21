// @knowzy/testing
//
// Fixtures, factories, the adapter conformance suite, and the leakage suite.
//
// Boundary: Contains no production code.
//
// NOT IMPLEMENTED IN PHASE 1. This package exists in the Foundation phase so
// the boundary rules in repository-structure.md §5 are enforceable from the
// first commit — a rule that only starts applying once the code arrives is a
// rule the code will already have broken. Implementation lands in Phases 1-11.
//
// The placeholder exports below keep the module resolvable without asserting
// any behaviour. They are removed by the phase that implements this package.

export const PACKAGE_NAME = '@knowzy/testing' as const;

// The dependency-audit gate: the rules that decide whether a high or critical
// advisory blocks the build, and the register of documented exceptions it
// reads. Exported from here rather than left as a loose module so the file is
// part of this package's surface and dependency-cruiser does not report it as
// an orphan. The I/O half lives in scripts/audit-gate.ts.
export {
  advisoriesFromNpmAudit,
  evaluateAudit,
  parseExceptionRegister,
  type AuditAdvisory,
  type ExceptionRegister,
  type GateVerdict,
  type SecurityException,
  type Severity,
} from './audit-exceptions.js';

/** The delivery phase that implements this package. */
export const IMPLEMENTED_IN = 'Phases 1-11' as const;
