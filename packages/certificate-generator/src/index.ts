// @knowzy/certificate-generator
//
// Deterministic PDF rendering and verification code signing.
//
// Boundary: No database access; it receives a value object.
//
// NOT IMPLEMENTED IN PHASE 1. This package exists in the Foundation phase so
// the boundary rules in repository-structure.md §5 are enforceable from the
// first commit — a rule that only starts applying once the code arrives is a
// rule the code will already have broken. Implementation lands in Phase 9.
//
// The placeholder exports below keep the module resolvable without asserting
// any behaviour. They are removed by the phase that implements certificates.

export const PACKAGE_NAME = '@knowzy/certificate-generator' as const;

// AI Document Studio M3 (AI_DOCUMENT_STUDIO_ARCHITECTURE.md §11.7): the Word
// and PDF downloads of an assessment-prepared document. The first rendering
// this package does; certificates (Phase 9) will reuse the PDF writer. Same
// boundary: no data access, a value object in, bytes out.
export { writePreparedDocx } from './writers/docx-writer.js';
export { writePreparedPdf } from './writers/pdf-writer.js';
export { writeZip, crc32 } from './writers/zip-writer.js';

/** The delivery phase that implements this package. */
export const IMPLEMENTED_IN = 'Phase 9' as const;
