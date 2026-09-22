// Mapping an imported file's own Domain and Topic columns onto real taxonomy.
//
// The rule under test, stated once: AN IMPORT NEVER CREATES TAXONOMY. A
// spreadsheet typo would otherwise mint a domain code, and a domain code is
// permanent once a question publishes under it.
//
// The fixtures are the names a real file actually carried — VisionStar, SAP,
// Azure, Infrastructure, Service Management — plus the mistyped variant that
// is the whole reason this path refuses instead of creating.

import { describe, expect, it } from 'vitest';
import {
  resolveImportTaxonomy,
  taxonomyResolver,
  type TaxonomyCatalogueDomain,
} from './import-mapping.js';

const CATALOGUE: TaxonomyCatalogueDomain[] = [
  {
    domainId: 'd-support',
    code: 'SUPPORT_OPS',
    name: 'Support Operations',
    topics: [
      { topicId: 't-escalation', name: 'Escalation and Billing' },
      { topicId: 't-cancellation', name: 'Order Cancellation' },
    ],
  },
  {
    domainId: 'd-visionstar',
    code: 'VISIONSTAR',
    name: 'VisionStar',
    topics: [
      { topicId: 't-lms', name: 'LMS Overview' },
      { topicId: 't-restart', name: 'Restart Governance' },
    ],
  },
];

const FALLBACK = { domainId: 'd-support', topicId: 't-escalation' };

describe('resolveImportTaxonomy', () => {
  it('matches on the domain NAME as the file writes it', () => {
    const result = resolveImportTaxonomy({
      detected: [{ domainName: 'VisionStar', topicName: 'LMS Overview' }],
      catalogue: CATALOGUE,
      fallback: FALLBACK,
    });
    expect(result.unmatched).toHaveLength(0);
    expect(result.resolutions[0]?.status).toBe('MATCHED');
    expect(result.resolutions[0]?.domainId).toBe('d-visionstar');
    expect(result.resolutions[0]?.topicId).toBe('t-lms');
  });

  it('matches on the CODE too, and ignores case and separators', () => {
    const result = resolveImportTaxonomy({
      detected: [{ domainName: 'support_ops', topicName: 'escalation and billing' }],
      catalogue: CATALOGUE,
      fallback: FALLBACK,
    });
    expect(result.resolutions[0]?.status).toBe('MATCHED');
    expect(result.resolutions[0]?.domainId).toBe('d-support');
  });

  it('REFUSES a mistyped domain rather than creating it', () => {
    // The defect this whole module exists to prevent. "VissionStar" is one
    // keystroke from a real domain and would become a permanent code.
    const result = resolveImportTaxonomy({
      detected: [{ domainName: 'VissionStar', topicName: 'LMS Overview' }],
      catalogue: CATALOGUE,
      fallback: FALLBACK,
    });
    expect(result.unmatched).toHaveLength(1);
    expect(result.resolutions[0]?.status).toBe('UNMATCHED');
    expect(result.resolutions[0]?.domainId).toBeNull();
    expect(result.resolutions[0]?.detail).toContain('never creates taxonomy');
  });

  it('does NOT fall back to the screen selection for a name it could not match', () => {
    // The subtle version of the same mistake: the file wrote something, the
    // platform does not have it, and a dropdown happens to be set. Filing the
    // question under that dropdown would be silent mis-filing.
    const result = resolveImportTaxonomy({
      detected: [{ domainName: 'Azure', topicName: 'Landing Zones' }],
      catalogue: CATALOGUE,
      fallback: FALLBACK,
    });
    expect(result.resolutions[0]?.status).toBe('UNMATCHED');
    expect(result.resolutions[0]?.domainId).toBeNull();
    expect(result.resolutions[0]?.topicId).toBeNull();
  });

  it('refuses a real domain with an unknown topic, and says which half matched', () => {
    const result = resolveImportTaxonomy({
      detected: [{ domainName: 'VisionStar', topicName: 'Oracle Access' }],
      catalogue: CATALOGUE,
      fallback: FALLBACK,
    });
    const resolution = result.resolutions[0];
    expect(resolution?.status).toBe('UNMATCHED');
    // The domain id IS reported, because it is true and it is what the mapping
    // control needs to preselect. The topic is what is missing.
    expect(resolution?.domainId).toBe('d-visionstar');
    expect(resolution?.topicId).toBeNull();
    expect(resolution?.detail).toContain('VISIONSTAR');
    expect(result.unmatched).toHaveLength(1);
  });

  it('uses the screen selection ONLY when the file names nothing', () => {
    const result = resolveImportTaxonomy({
      detected: [{ domainName: null, topicName: null }],
      catalogue: CATALOGUE,
      fallback: FALLBACK,
    });
    expect(result.resolutions[0]?.status).toBe('FALLBACK');
    expect(result.resolutions[0]?.domainId).toBe('d-support');
    expect(result.unmatched).toHaveLength(0);
  });

  it('accepts an importer’s explicit mapping, which is the point of the choice', () => {
    const result = resolveImportTaxonomy({
      detected: [{ domainName: 'SAP', topicName: 'Interfaces' }],
      catalogue: CATALOGUE,
      mappings: [
        {
          domainName: 'SAP',
          topicName: 'Interfaces',
          domainId: 'd-support',
          topicId: 't-cancellation',
        },
      ],
      fallback: FALLBACK,
    });
    expect(result.unmatched).toHaveLength(0);
    expect(result.resolutions[0]?.status).toBe('MAPPED');
    expect(result.resolutions[0]?.topicId).toBe('t-cancellation');
  });

  it('matches a mapping regardless of how the file cased or spaced the name', () => {
    const result = resolveImportTaxonomy({
      detected: [{ domainName: 'Service  Management', topicName: 'Incidents' }],
      catalogue: CATALOGUE,
      mappings: [
        {
          domainName: 'service-management',
          topicName: 'incidents',
          domainId: 'd-support',
          topicId: 't-escalation',
        },
      ],
      fallback: FALLBACK,
    });
    expect(result.resolutions[0]?.status).toBe('MAPPED');
  });

  it('counts the questions behind each distinct pair, so a refusal has a size', () => {
    const result = resolveImportTaxonomy({
      detected: [
        { domainName: 'VisionStar', topicName: 'LMS Overview' },
        { domainName: 'VisionStar', topicName: 'LMS Overview' },
        { domainName: 'Infrastructure', topicName: 'Patching' },
      ],
      catalogue: CATALOGUE,
      fallback: FALLBACK,
    });
    expect(result.resolutions).toHaveLength(2);
    expect(result.resolutions.find((r) => r.status === 'MATCHED')?.questionCount).toBe(2);
    expect(result.resolutions.find((r) => r.status === 'UNMATCHED')?.questionCount).toBe(1);
  });
});

describe('taxonomyResolver', () => {
  it('places a matched question and returns null for an unmatched one', () => {
    const resolve = taxonomyResolver(
      resolveImportTaxonomy({
        detected: [
          { domainName: 'VisionStar', topicName: 'Restart Governance' },
          { domainName: 'Azure', topicName: 'Landing Zones' },
        ],
        catalogue: CATALOGUE,
        fallback: FALLBACK,
      }),
    );

    expect(resolve({ domainName: 'VisionStar', topicName: 'Restart Governance' })).toEqual({
      domainId: 'd-visionstar',
      topicId: 't-restart',
    });
    // Null, not the fallback: the import service turns this into a per-question
    // refusal rather than filing it somewhere plausible.
    expect(resolve({ domainName: 'Azure', topicName: 'Landing Zones' })).toBeNull();
  });

  it('returns null for a pair the resolution never saw', () => {
    const resolve = taxonomyResolver(
      resolveImportTaxonomy({ detected: [], catalogue: CATALOGUE, fallback: FALLBACK }),
    );
    expect(resolve({ domainName: 'VisionStar', topicName: 'LMS Overview' })).toBeNull();
  });
});
