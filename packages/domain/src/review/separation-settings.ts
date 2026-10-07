// Separation-of-duties SETTINGS, read from platform configuration.
//
// workflows.md §3.4 always declared these policies as configuration, but until
// the Authoring Role Simplification (2026-10-07, access-control.md §2.0)
// nothing read them: every caller used the code defaults. This is the one
// reader, used by the API and the MCP server alike, so a question and a
// competency version are judged by the same switchboard.
//
// The CODE DEFAULTS STAY STRICT. A fresh environment with no row separates
// authoring from approval; the platform's decision to permit self-approval is
// a configuration row, written once by the seed and recorded in
// configuration_change, and reversing it is one configuration write.
//
// Platform scope only. The keys also declare DOMAIN scope, but no
// per-domain value has ever been written and resolving one here would be a
// second decision about precedence that nobody has taken.

import type { PrismaClient } from '@knowzy/database';
import { DEFAULT_SEPARATION_POLICIES, type SeparationPolicies } from './separation-of-duties.js';

export interface CompetencySeparation {
  /** True: whoever drew up or edited a framework version may approve it. */
  readonly versionEditorMayApprove: boolean;
  /** True: whoever proposed or edited a role target may approve it. */
  readonly targetEditorMayApprove: boolean;
}

export const STRICT_COMPETENCY_SEPARATION: CompetencySeparation = {
  versionEditorMayApprove: false,
  targetEditorMayApprove: false,
};

export interface SeparationSettings {
  readonly policies: SeparationPolicies;
  readonly competency: CompetencySeparation;
}

const KEYS = {
  authorMayApproveOwn: 'approval.authorMayApproveOwn',
  editorMayApproveOwn: 'approval.editorMayApproveOwn',
  approverMayPublishOwn: 'approval.approverMayPublishOwn',
  smeMayApprove: 'approval.smeMayApprove',
  versionEditorMayApprove: 'approval.competencyVersionEditorMayApprove',
  targetEditorMayApprove: 'approval.competencyTargetEditorMayApprove',
} as const;

/** Pure: resolve the rows into settings, falling back to the strict defaults. */
export const resolveSeparationSettings = (
  rows: readonly { readonly key: string; readonly value: unknown }[],
): SeparationSettings => {
  const valueOf = (key: string, fallback: boolean): boolean => {
    const value = rows.find((row) => row.key === key)?.value;
    // Only a real boolean counts. A malformed row falls back to the default
    // rather than to "permitted" -- a typo must not switch a control off.
    return typeof value === 'boolean' ? value : fallback;
  };
  return {
    policies: {
      ...DEFAULT_SEPARATION_POLICIES,
      authorMayApproveOwn: valueOf(
        KEYS.authorMayApproveOwn,
        DEFAULT_SEPARATION_POLICIES.authorMayApproveOwn,
      ),
      editorMayApproveOwn: valueOf(
        KEYS.editorMayApproveOwn,
        DEFAULT_SEPARATION_POLICIES.editorMayApproveOwn,
      ),
      approverMayPublishOwn: valueOf(
        KEYS.approverMayPublishOwn,
        DEFAULT_SEPARATION_POLICIES.approverMayPublishOwn,
      ),
      smeMayApprove: valueOf(KEYS.smeMayApprove, DEFAULT_SEPARATION_POLICIES.smeMayApprove),
    },
    competency: {
      versionEditorMayApprove: valueOf(
        KEYS.versionEditorMayApprove,
        STRICT_COMPETENCY_SEPARATION.versionEditorMayApprove,
      ),
      targetEditorMayApprove: valueOf(
        KEYS.targetEditorMayApprove,
        STRICT_COMPETENCY_SEPARATION.targetEditorMayApprove,
      ),
    },
  };
};

/** Read the platform-scope rows and resolve them. One query per call. */
export const loadSeparationSettings = async (prisma: PrismaClient): Promise<SeparationSettings> => {
  const rows = await prisma.applicationConfiguration.findMany({
    where: { key: { in: Object.values(KEYS) }, scope: 'PLATFORM', scopeId: null },
    select: { key: true, value: true },
  });
  return resolveSeparationSettings(rows);
};
