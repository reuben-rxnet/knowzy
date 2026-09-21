// The dependency-audit gate, and the exception register it reads.
//
// security.md §14 says a `high` or `critical` dependency finding fails the
// pipeline, and §15 G-DEP requires a clean scan. This module is the DEVIATION
// from that rule and its containment in one place: a high or critical advisory
// still fails the build UNLESS it is named in docs/SECURITY-EXCEPTIONS.md by a
// dated, reasoned, expiring entry.
//
// Three things keep an exception register from becoming a place where problems
// go to be forgotten, and all three are enforced below rather than promised:
//
//   1. An advisory nobody has written down BLOCKS. Silence is never consent.
//   2. An exception past its review date BLOCKS. The entry expires, not the
//      vulnerability.
//   3. An exception that no longer matches anything BLOCKS. A register that
//      keeps entries for advisories that have since been fixed stops being a
//      description of the tree and starts being decoration.
//
// The logic here is pure: advisories in, verdict out. The runner in
// scripts/audit-gate.ts does the I/O, so this can be unit-tested without npm,
// a network, or a lockfile.

export type Severity = 'critical' | 'high' | 'moderate' | 'low' | 'info';

/** One advisory, as the gate needs to see it. */
export interface AuditAdvisory {
  /** GitHub advisory id, e.g. `GHSA-ggr8-5vv4-36mx`. The stable key. */
  readonly ghsa: string;
  /**
   * The severity the gate decides on: the HIGHER of the advisory's own
   * severity and the severity npm rolls the package up to.
   *
   * The two differ often — npm reports GHSA-qx2v-qp2m-jg93 as moderate while
   * rolling `postcss` up to high — and `npm audit --audit-level=high`, the
   * command this gate replaces, blocks on the rollup. Deciding on the
   * advisory alone would make this gate quieter than the rule in
   * security.md §14, which is the one thing it must not be.
   */
  readonly severity: Severity;
  /** What npm called the advisory itself, for the build output. */
  readonly advisorySeverity: Severity;
  /** What npm rolled the package up to. */
  readonly packageSeverity: Severity;
  /** The package the advisory is against, e.g. `postcss`. */
  readonly packageName: string;
  readonly title: string;
}

export interface SecurityException {
  /** Register id, e.g. `EX-001`. Quoted in the build output. */
  readonly id: string;
  /** Every advisory this entry covers. */
  readonly advisories: readonly string[];
  readonly packages: readonly string[];
  /** ISO date. On and after this date the entry no longer suppresses. */
  readonly expires: string;
  readonly classification: string;
  readonly reachability: 'not-reachable' | 'reachable';
  readonly reason: string;
}

export interface ExceptionRegister {
  readonly version: number;
  readonly exceptions: readonly SecurityException[];
}

export interface GateVerdict {
  readonly ok: boolean;
  /** Advisories that fail the build, each with why. */
  readonly blocking: readonly {
    readonly ghsa: string;
    readonly packageName: string;
    readonly severity: string;
    readonly reason: 'undeclared' | 'expired' | 'reachable';
    readonly detail: string;
  }[];
  /** Advisories suppressed by a live exception, reported rather than hidden. */
  readonly suppressed: readonly {
    readonly ghsa: string;
    readonly packageName: string;
    readonly exceptionId: string;
    readonly expires: string;
  }[];
  /** Register entries that match nothing in the current tree. */
  readonly staleExceptions: readonly {
    readonly id: string;
    readonly advisories: readonly string[];
  }[];
}

/** Severities that fail the build. Mirrors `npm audit --audit-level=high`. */
const BLOCKING_SEVERITIES: ReadonlySet<string> = new Set(['high', 'critical']);

const SEVERITY_RANK: Readonly<Record<string, number>> = {
  info: 0,
  low: 1,
  moderate: 2,
  high: 3,
  critical: 4,
};

const higherOf = (left: Severity, right: Severity): Severity =>
  (SEVERITY_RANK[left] ?? 0) >= (SEVERITY_RANK[right] ?? 0) ? left : right;

const MARKER = '<!-- knowzy:security-exceptions -->';

/**
 * Reads the register out of the Markdown document that explains it.
 *
 * The register lives inside docs/SECURITY-EXCEPTIONS.md rather than beside it
 * as a JSON file, because two files would drift: the prose would say one thing
 * and the machine-readable list another, and only one of them would fail a
 * build. The marker comment above the fenced block is what this looks for, so
 * the document can be reorganized around it.
 */
export const parseExceptionRegister = (markdown: string): ExceptionRegister => {
  const markerAt = markdown.indexOf(MARKER);
  if (markerAt === -1) {
    throw new Error(
      `docs/SECURITY-EXCEPTIONS.md does not contain the ${MARKER} marker, so the audit gate cannot read the register. An unreadable register is treated as a failure, never as an empty one.`,
    );
  }

  const fenceStart = markdown.indexOf('```json', markerAt);
  if (fenceStart === -1) {
    throw new Error('No ```json block follows the security-exceptions marker.');
  }
  const bodyStart = markdown.indexOf('\n', fenceStart) + 1;
  const fenceEnd = markdown.indexOf('```', bodyStart);
  if (fenceEnd === -1) throw new Error('The security-exceptions JSON block is not closed.');

  const parsed: unknown = JSON.parse(markdown.slice(bodyStart, fenceEnd));
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !Array.isArray((parsed as ExceptionRegister).exceptions)
  ) {
    throw new Error('The security-exceptions block must be an object with an `exceptions` array.');
  }
  return parsed as ExceptionRegister;
};

/**
 * Decides whether the audit passes.
 *
 * `now` is a parameter rather than read from the clock so the expiry rule is
 * testable — an expiry that can only be observed by waiting is an expiry
 * nobody verifies.
 */
export const evaluateAudit = ({
  advisories,
  register,
  now,
}: {
  readonly advisories: readonly AuditAdvisory[];
  readonly register: ExceptionRegister;
  readonly now: Date;
}): GateVerdict => {
  const blocking: {
    ghsa: string;
    packageName: string;
    severity: string;
    reason: 'undeclared' | 'expired' | 'reachable';
    detail: string;
  }[] = [];
  const suppressed: {
    ghsa: string;
    packageName: string;
    exceptionId: string;
    expires: string;
  }[] = [];
  const matched = new Set<string>();

  const relevant = advisories.filter((advisory) => BLOCKING_SEVERITIES.has(advisory.severity));

  for (const advisory of relevant) {
    const exception = register.exceptions.find((candidate) =>
      candidate.advisories.includes(advisory.ghsa),
    );

    if (exception === undefined) {
      blocking.push({
        ghsa: advisory.ghsa,
        packageName: advisory.packageName,
        severity: advisory.severity,
        reason: 'undeclared',
        detail: `${advisory.title} — no entry in docs/SECURITY-EXCEPTIONS.md covers this advisory.`,
      });
      continue;
    }

    matched.add(exception.id);

    // An exception for something that IS reachable is not an exception, it is a
    // note attached to a live vulnerability. Refused whatever the date says.
    if (exception.reachability === 'reachable') {
      blocking.push({
        ghsa: advisory.ghsa,
        packageName: advisory.packageName,
        severity: advisory.severity,
        reason: 'reachable',
        detail: `${exception.id} declares this advisory REACHABLE. A reachable vulnerability cannot be excepted; it has to be fixed or the code path removed.`,
      });
      continue;
    }

    const expiry = Date.parse(`${exception.expires}T00:00:00Z`);
    if (Number.isNaN(expiry)) {
      blocking.push({
        ghsa: advisory.ghsa,
        packageName: advisory.packageName,
        severity: advisory.severity,
        reason: 'expired',
        detail: `${exception.id} has an unparseable expiry (${exception.expires}).`,
      });
      continue;
    }
    if (now.getTime() >= expiry) {
      blocking.push({
        ghsa: advisory.ghsa,
        packageName: advisory.packageName,
        severity: advisory.severity,
        reason: 'expired',
        detail: `${exception.id} expired on ${exception.expires}. Re-assess the advisory and either fix it or extend the entry with a fresh reason.`,
      });
      continue;
    }

    suppressed.push({
      ghsa: advisory.ghsa,
      packageName: advisory.packageName,
      exceptionId: exception.id,
      expires: exception.expires,
    });
  }

  const staleExceptions = register.exceptions
    .filter((exception) => !matched.has(exception.id))
    .map((exception) => ({ id: exception.id, advisories: exception.advisories }));

  return {
    // A stale entry fails too: the register is meant to describe the tree, and
    // an entry that matches nothing means the tree moved and nobody looked.
    ok: blocking.length === 0 && staleExceptions.length === 0,
    blocking,
    suppressed,
    staleExceptions,
  };
};

/** Pulls high and critical advisories out of `npm audit --json` output. */
export const advisoriesFromNpmAudit = (auditJson: unknown): readonly AuditAdvisory[] => {
  const root = auditJson as {
    vulnerabilities?: Record<string, { severity?: string; via?: unknown[] }>;
  };
  const out = new Map<string, AuditAdvisory>();

  for (const [packageName, entry] of Object.entries(root.vulnerabilities ?? {})) {
    for (const via of entry.via ?? []) {
      if (typeof via !== 'object' || via === null) continue;
      const source = via as { url?: string; title?: string; severity?: string };
      const ghsa = /GHSA-[a-z0-9-]+/i.exec(source.url ?? '')?.[0];
      if (ghsa === undefined) continue;

      const advisorySeverity = (source.severity ?? 'moderate') as Severity;
      const packageSeverity = (entry.severity ?? 'moderate') as Severity;
      // Keyed by advisory AND package: one advisory can reach the tree through
      // several packages, and each path is its own thing to decide about.
      const key = `${ghsa}:${packageName}`;
      if (!out.has(key)) {
        out.set(key, {
          ghsa,
          severity: higherOf(advisorySeverity, packageSeverity),
          advisorySeverity,
          packageSeverity,
          packageName,
          title: source.title ?? ghsa,
        });
      }
    }
  }

  return [...out.values()];
};
