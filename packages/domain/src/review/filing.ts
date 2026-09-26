// Re-filing a draft question's DEPARTMENT and ROLE.
//
// Four axes file a question -- domain, topic, department, role -- and only two
// of them may be changed after generation. The split is not a convenience:
//
//   * DOMAIN is inside the published identifier, `KNZ-{DOMAIN_CODE}-{YYYY}-
//     {SEQ}`, which lives in a SharePoint list outside this platform and is
//     what a year of reports grouped by. A question whose id says SUPPORT_OPS
//     while its domain says RX_NET is a record that disagrees with itself.
//   * TOPIC is the identity of the section-coverage model within a domain, and
//     the generation job recorded its choice with the preflight that authorized
//     it. Moving it later would silently restate what was checked.
//   * DEPARTMENT and ROLE are labels for filing and reporting. They are
//     nullable, they are not in any identifier, they are not a security
//     boundary, and they are exactly the two fields a reviewer notices are
//     wrong -- the generation screen chooses them per JOB, so one wrong choice
//     mis-files a whole batch.
//
// So this exists, and changing a domain or a topic does not. Anything that
// wants to move a question between domains must create a new question, which is
// what the platform already refuses to shortcut.
//
// The window is the same one an edit has: DRAFT, AUTHOR_REVIEW,
// CHANGES_REQUESTED. After submission the filing is read-only, because an
// approver approves a question AS FILED -- gate evaluation and the approval
// record are taken at that moment, and letting the filing move underneath an
// approved question would make the approval a statement about something else.

import {
  createAuditWriter,
  transactWithAudit,
  type PrismaClient,
  type TransactionClient,
} from '@knowzy/database';
import type { Clock } from '@knowzy/observability';
import { resolveOrgFiling } from '../taxonomy/org-taxonomy-service.js';
import type { ActorContext } from './review-service.js';
import { QuestionNotFoundError } from './review-service.js';
import { NotEditableError } from './versioning.js';

/** The same window an edit has. Kept here as its own constant so that widening
 *  one does not silently widen the other. */
const REFILEABLE_STATUSES = new Set(['DRAFT', 'AUTHOR_REVIEW', 'CHANGES_REQUESTED']);

export class FilingNotPermittedError extends Error {
  readonly code = 'FORBIDDEN';
  constructor() {
    super('Changing a question’s filing requires the permission "question.edit".');
    this.name = 'FilingNotPermittedError';
  }
}

export interface SetFilingArgs {
  readonly prisma: PrismaClient;
  readonly clock: Clock;
  readonly questionId: string;
  readonly actor: ActorContext;
  /**
   * The new filing. `null` CLEARS an axis; absent leaves it alone.
   *
   * Two different gestures, deliberately -- the same distinction the provider
   * limit form makes. A screen that sent `null` for "unchanged" would silently
   * unfile the axis the reviewer did not touch.
   */
  readonly filing: {
    readonly departmentId?: string | null;
    readonly jobRoleId?: string | null;
  };
}

export interface SetFilingResult {
  readonly questionId: string;
  readonly version: number;
  readonly changedFields: readonly string[];
  readonly departmentId: string | null;
  readonly jobRoleId: string | null;
}

export const setQuestionFiling = async (args: SetFilingArgs): Promise<SetFilingResult> => {
  const { prisma, clock, actor } = args;

  if (!actor.permissions.includes('question.edit')) throw new FilingNotPermittedError();

  const row = await prisma.draftQuestion.findUnique({
    where: { id: args.questionId },
    select: {
      id: true,
      status: true,
      version: true,
      domainId: true,
      sourceId: true,
      questionText: true,
      answerPayload: true,
      explanation: true,
      supportingEvidence: true,
      departmentId: true,
      jobRoleId: true,
      department: { select: { code: true } },
      jobRole: { select: { code: true } },
    },
  });
  if (!row) throw new QuestionNotFoundError(args.questionId);
  if (!REFILEABLE_STATUSES.has(row.status)) throw new NotEditableError(row.status);

  // Absent means unchanged, so the CURRENT value is what gets re-resolved --
  // which also re-checks it. That is deliberate: a department deactivated since
  // the job ran should not be silently carried forward by an unrelated edit to
  // the role.
  const requested = {
    departmentId:
      args.filing.departmentId === undefined ? row.departmentId : args.filing.departmentId,
    jobRoleId: args.filing.jobRoleId === undefined ? row.jobRoleId : args.filing.jobRoleId,
  };
  const resolved = await resolveOrgFiling({ prisma, clock }, requested);

  const changedFields: string[] = [];
  if (resolved.departmentId !== row.departmentId) changedFields.push('departmentId');
  if (resolved.jobRoleId !== row.jobRoleId) changedFields.push('jobRoleId');

  if (changedFields.length === 0) {
    // No version and no audit row for a no-op. A version history full of
    // identical versions hides the real changes, and an audit trail of
    // non-events is one nobody reads.
    return {
      questionId: args.questionId,
      version: row.version,
      changedFields: [],
      departmentId: row.departmentId,
      jobRoleId: row.jobRoleId,
    };
  }

  const nextVersion = row.version + 1;
  const payload = row.answerPayload as {
    kind?: string;
    options: Record<'A' | 'B' | 'C' | 'D', string>;
    correctOption: string;
  };

  // The codes, for the audit row and the snapshot. Codes rather than ids: an
  // auditor reading a seven-year store cannot resolve a uuid against a
  // catalogue that has since been re-curated, and the code is what a report
  // grouped by.
  const codes = await codesFor(prisma, resolved);

  const result = await transactWithAudit({
    prisma,
    auditWriter: createAuditWriter({ clock }),
    action: 'AUTHORING.QUESTION.FILING_CHANGED',
    work: async (tx: TransactionClient) => {
      await tx.draftQuestion.update({
        where: { id: args.questionId },
        data: {
          version: nextVersion,
          departmentId: resolved.departmentId,
          jobRoleId: resolved.jobRoleId,
          modifiedByUserId: actor.userId,
          // Lineage columns are absent on purpose (I15), and so is
          // `duplicateDisposition`: re-filing changes no text, so a reviewer's
          // judgement that this question is distinct from another still holds.
        },
      });

      await tx.draftQuestionVersion.create({
        data: {
          questionId: args.questionId,
          version: nextVersion,
          changeKind: 'EDITED',
          // A snapshot is the whole question as of that version, so the
          // content travels with it even though none of it changed --
          // otherwise a reader reconstructing version N finds a hole.
          snapshot: {
            questionText: row.questionText,
            options: payload.options,
            correctOption: payload.correctOption,
            explanation: row.explanation,
            supportingEvidence: row.supportingEvidence,
            departmentCode: codes.departmentCode,
            jobRoleCode: codes.jobRoleCode,
          },
          diff: {
            fields: changedFields.map((field) => ({
              field,
              previous:
                field === 'departmentId' ? (row.department?.code ?? '') : (row.jobRole?.code ?? ''),
              next:
                field === 'departmentId' ? (codes.departmentCode ?? '') : (codes.jobRoleCode ?? ''),
            })),
          },
          // FALSE, and that is the honest value. Re-filing does not touch the
          // stem, the options or the evidence span, so nothing was
          // re-verified; writing `true` here would claim a check that never
          // ran, in the one table that is append-only.
          evidenceReverified: false,
          changedByUserId: actor.userId,
        },
      });

      return {
        questionId: args.questionId,
        version: nextVersion,
        changedFields: [...changedFields] as readonly string[],
        departmentId: resolved.departmentId,
        jobRoleId: resolved.jobRoleId,
      };
    },
    audit: () => ({
      action: 'AUTHORING.QUESTION.FILING_CHANGED',
      outcome: 'SUCCESS',
      actorType: 'USER',
      actorUserId: actor.userId,
      actorDisplayName: actor.displayName,
      actorRoles: [...actor.roles],
      entityType: 'DraftQuestion',
      entityId: args.questionId,
      entityLabel: args.questionId,
      domainId: row.domainId,
      sourceId: row.sourceId,
      correlationId: actor.correlationId,
      requestId: actor.requestId,
      portal: 'AUTHORING',
      // H2: previous AND new, because a change of filing is what a past report
      // grouped by and the grouping must be reconstructable.
      previousValue: {
        departmentCode: row.department?.code ?? null,
        jobRoleCode: row.jobRole?.code ?? null,
      },
      newValue: {
        departmentCode: codes.departmentCode,
        jobRoleCode: codes.jobRoleCode,
      },
      detail: {
        version: nextVersion,
        changedFields: [...changedFields],
        departmentCode: codes.departmentCode,
        jobRoleCode: codes.jobRoleCode,
      },
    }),
  });

  return result;
};

const codesFor = async (
  prisma: PrismaClient,
  resolved: { readonly departmentId: string | null; readonly jobRoleId: string | null },
): Promise<{ departmentCode: string | null; jobRoleCode: string | null }> => {
  const [department, jobRole] = await Promise.all([
    resolved.departmentId === null
      ? Promise.resolve(null)
      : prisma.department.findUnique({
          where: { id: resolved.departmentId },
          select: { code: true },
        }),
    resolved.jobRoleId === null
      ? Promise.resolve(null)
      : prisma.jobRole.findUnique({ where: { id: resolved.jobRoleId }, select: { code: true } }),
  ]);
  return { departmentCode: department?.code ?? null, jobRoleCode: jobRole?.code ?? null };
};
