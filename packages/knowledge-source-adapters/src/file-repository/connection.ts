// The FILE_REPOSITORY source configuration, validated at configuration time.
//
// Validated with zod when the source is SAVED rather than when it is
// synchronized, so a misconfiguration is a refusal an administrator sees
// immediately instead of a sync run that fails an hour later.
//
// Two fields are required for a mirror and exist entirely for honesty:
//
//   webUrlBase         the canonical SharePoint URL. Without it a document
//                      record would carry a local path as its provenance
//                      (see web-url.ts).
//   mirrorAccountUpn   whose access defines the corpus. A mirror contains
//                      exactly what the syncing user can see, so the corpus
//                      boundary is a PERSON — which is not a governance
//                      boundary and cannot be recovered from the data later.
//                      Recording it is the only way anyone can audit what the
//                      corpus does and does not contain.

import { z } from 'zod';
import { normalizeWebUrlBase } from './web-url.js';

/**
 * Where the bytes come from, and therefore what the platform may claim.
 *
 * Carried on the source so a screen can state "synchronized from a SharePoint
 * library mirror; permissions enforced by Knowzy" rather than leaving a reader
 * to infer it from a source name.
 */
export const FILE_REPOSITORY_PROVENANCE = [
  'SHAREPOINT_MIRROR',
  'ONEDRIVE_MIRROR',
  'MANAGED_UPLOAD',
] as const;
export type FileRepositoryProvenance = (typeof FILE_REPOSITORY_PROVENANCE)[number];

const MIRROR_PROVENANCE: readonly FileRepositoryProvenance[] = [
  'SHAREPOINT_MIRROR',
  'ONEDRIVE_MIRROR',
];

export const FileRepositoryConnectionSchema = z
  .object({
    /**
     * The synchronized root on this machine.
     *
     * OPERATIONAL configuration, never provenance. It is supplied by the
     * environment rather than committed, and it must never be persisted to a
     * document record, an audit detail, a citation or a bank item.
     */
    localRoot: z.string().min(1),
    /**
     * Whether the environment's root override applies to THIS source.
     *
     * The override exists so a machine-specific mirror path is never
     * committed, and it used to be applied to every FILE_REPOSITORY source
     * unconditionally. That was invisible while one such source existed; the
     * moment a second was added, it would have read the first one's folder.
     *
     * A source that keeps its documents in the repository -- derived
     * evaluation assets, fixtures -- sets this false and keeps its own
     * committed root.
     */
    rootFromEnvironment: z.boolean().default(false),
    /** Optional subfolder beneath the root, e.g. `SOPs`. */
    corpusSubfolder: z.string().optional(),
    provenance: z.enum(FILE_REPOSITORY_PROVENANCE),
    /** The canonical SharePoint folder URL. Required for a mirror. */
    webUrlBase: z.string().optional(),
    /** Whose access defines the visible corpus. Required for a mirror. */
    mirrorAccountUpn: z.string().min(3).optional(),
    /** When the sidecar metadata was captured, if it was. */
    mirrorCapturedAt: z.string().optional(),
    includePatterns: z.array(z.string()).default([]),
    excludePatterns: z.array(z.string()).default([]),
    /** Extensions in scope. Empty means every type with a registered extractor. */
    supportedExtensions: z.array(z.string()).default([]),
    maxFileBytes: z
      .number()
      .int()
      .positive()
      .max(200 * 1024 * 1024)
      .default(32 * 1024 * 1024),
    /**
     * The partial-sync safety threshold.
     *
     * A scan finding fewer than this fraction of the previous run's documents
     * aborts the run and emits NO delete events. A paused, throttled or
     * mid-run sync client presents a half-populated directory, and a naive
     * scan reads that as mass deletion: a sync that refuses is recoverable, a
     * sync that retires half the corpus is a cleanup job.
     */
    partialSyncFloor: z.number().min(0).max(1).default(0.8),
    /** Whether a sidecar may supply metadata and access facts. */
    sidecarsEnabled: z.boolean().default(true),
    isActive: z.boolean().default(false),
  })
  .strict()
  .superRefine((value, context) => {
    const isMirror = MIRROR_PROVENANCE.includes(value.provenance);

    if (isMirror && (value.webUrlBase === undefined || value.webUrlBase.trim() === '')) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['webUrlBase'],
        message:
          'A mirrored source must declare the canonical SharePoint URL base, or its documents ' +
          'would carry a local path as their provenance.',
      });
    }
    if (
      isMirror &&
      (value.mirrorAccountUpn === undefined || value.mirrorAccountUpn.trim() === '')
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['mirrorAccountUpn'],
        message:
          'A mirrored source must record which account defines the visible corpus. ' +
          'The corpus boundary is that person, and it cannot be recovered later.',
      });
    }
    if (value.webUrlBase !== undefined && value.webUrlBase.trim() !== '') {
      try {
        normalizeWebUrlBase(value.webUrlBase);
      } catch (error) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['webUrlBase'],
          message: (error as Error).message,
        });
      }
    }
  });

export type FileRepositoryConnection = z.infer<typeof FileRepositoryConnectionSchema>;

export const parseFileRepositoryConnection = (value: unknown): FileRepositoryConnection =>
  FileRepositoryConnectionSchema.parse(value);
