// Builds a fixture that stands in for a locally synchronized SharePoint folder.
//
// This is NOT the real pilot corpus. It is a fixture shaped like one, so the
// FILE_REPOSITORY adapter can be driven through the whole conformance suite
// and the whole pipeline with no tenant access and no customer content.
//
// It deliberately contains the awkward cases a real mirror contains:
//
//   desktop.ini                 written by the OneDrive client. A readable
//                               .ini file that would otherwise extract
//                               SUCCESSFULLY into a nonsense section.
//   ~$certificate-renewal.docx  an Office lock file.
//   notes.rtf                   a real format with no registered extractor.
//   restricted-board-pay.md     declared DENIED by its sidecar, so the
//                               conformance suite has a document that must be
//                               excluded from listing, search and extraction.
//
// Binary bytes are copied from the content-extraction fixtures rather than
// duplicated, so there is one source of truth for them.
//
// Run:  node fixtures/build-pilot-mirror.mjs

import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// The generator lives OUTSIDE the mirror root, so the corpus it builds
// contains only documents and the register is not polluted by build tooling.
const HERE = join(import.meta.dirname, 'pilot-mirror');
const BINARY = join(
  import.meta.dirname,
  '..',
  'packages',
  'content-extraction',
  'test',
  'fixtures',
);

const dir = (...parts) => {
  const target = join(HERE, ...parts);
  mkdirSync(target, { recursive: true });
  return target;
};

const sops = dir('SOPs');
const policies = dir('Policies');

// ── Documents with a registered extractor ───────────────────────────────────

copyFileSync(join(BINARY, 'sop.docx'), join(sops, 'certificate-renewal.docx'));
copyFileSync(join(BINARY, 'sop-two-page.pdf'), join(sops, 'certificate-renewal-procedure.pdf'));
copyFileSync(join(BINARY, 'policy.xlsx'), join(sops, 'renewal-windows.xlsx'));
copyFileSync(join(BINARY, 'deck.pptx'), join(sops, 'knowledge-transfer.pptx'));

// Plain text with no heading structure, for the X4 fallback path.
writeFileSync(
  join(sops, 'acceptable-use.txt'),
  [
    'Shared accounts must never be used to access the certificate store.',
    '',
    'A request for elevated access must be approved by the team leader before it is granted.',
    '',
    'Any credential suspected of exposure must be rotated within four hours of the report.',
    '',
    'The service desk must record every elevated-access request in the change log.',
  ].join('\n'),
  'utf8',
);

// Markdown, which DOES carry heading structure.
writeFileSync(
  join(sops, 'escalation-matrix.md'),
  [
    '# Escalation Matrix',
    '',
    '## Severity one',
    '',
    'A severity-one incident must be escalated to the duty manager within fifteen minutes',
    'of detection. The duty manager must acknowledge the escalation before the on-call',
    'engineer stands down.',
    '',
    '## Severity two',
    '',
    'A severity-two incident must be acknowledged within two hours. The team leader may',
    'defer a severity-two incident to the next working day only with a recorded reason.',
    '',
    '## Refunds raised by an incident',
    '',
    'Where an incident caused a billing error, the billing manager must authorise any refund',
    'before it is issued. A refund above five hundred euro requires a second authorisation',
    'from the finance controller, and the refund reference must be recorded against the',
    'incident within one working day of payment.',
    '',
    '## Post-incident review',
    '',
    'A severity-one incident requires a written review within five working days. The review',
    'must name the owner of every remediation action and the date each action is due. An',
    'action that slips its date must be escalated to the service owner, who may re-plan it',
    'only once before it is reported to the operations board.',
  ].join('\n'),
  'utf8',
);

// ── A document the source declares NOT accessible ───────────────────────────
// The conformance suite needs one of these: it must be absent from listing and
// search, and refused for extraction, each with a stated reason.

writeFileSync(
  join(policies, 'restricted-board-pay.md'),
  [
    '# Board Remuneration',
    '',
    'The remuneration committee must approve every award before it is communicated.',
  ].join('\n'),
  'utf8',
);
writeFileSync(
  join(policies, 'restricted-board-pay.md.meta.json'),
  `${JSON.stringify(
    {
      sourceVersion: '2.0',
      sourceCreatedAt: '2025-02-01T09:00:00.000Z',
      sourceModifiedAt: '2025-06-01T09:00:00.000Z',
      mimeType: 'text/markdown',
      metadata: { Classification: 'Restricted', Owner: 'Company Secretary' },
      access: {
        default: 'DENIED',
        summary: 'Restricted to the remuneration committee by the source owner.',
      },
    },
    null,
    2,
  )}\n`,
  'utf8',
);

// ── A sidecar carrying real SharePoint column values ────────────────────────
// This is what discovery produces: the columns the sync client does not bring.

writeFileSync(
  join(sops, 'certificate-renewal.docx.meta.json'),
  `${JSON.stringify(
    {
      sourceVersion: '4.2',
      sourceCreatedAt: '2025-01-15T08:30:00.000Z',
      sourceModifiedAt: '2025-08-20T14:05:00.000Z',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      metadata: {
        Owner: 'Service Operations Lead',
        ReviewCycle: 'Annual',
        Classification: 'Internal',
      },
      access: { default: 'ALLOWED' },
    },
    null,
    2,
  )}\n`,
  'utf8',
);

// ── Files that must be skipped, each for a different reason ─────────────────

writeFileSync(join(sops, 'desktop.ini'), '[.ShellClassInfo]\nIconResource=OneDrive.ico\n', 'utf8');
writeFileSync(join(sops, '~$certificate-renewal.docx'), 'lock', 'utf8');
writeFileSync(
  join(sops, 'notes.rtf'),
  '{\\rtf1\\ansi A format with no registered extractor.}',
  'utf8',
);

console.log('pilot mirror fixture built under fixtures/pilot-mirror');
