// Domain codes and topic slugs — the normalization every taxonomy write goes
// through.
//
// These are pure functions and they are tested here rather than through the
// database, because what they decide is permanent: a code lands inside every
// QuestionID published under the domain, and two codes that differ only in
// case or punctuation would produce two indistinguishable published prefixes.

import { describe, expect, it } from 'vitest';
import {
  DOMAIN_CODE_MAX,
  normalizeDescription,
  normalizeDisplayName,
  normalizeDomainCode,
  topicSlug,
  TaxonomyError,
} from './taxonomy-service.js';

describe('normalizeDomainCode', () => {
  it('upper-cases, so one code cannot exist twice in different cases', () => {
    expect(normalizeDomainCode('visionstar')).toBe('VISIONSTAR');
    expect(normalizeDomainCode('VisionStar')).toBe('VISIONSTAR');
  });

  it('folds spaces and hyphens to underscores', () => {
    // What a person types when asked for a code: the words of the domain.
    expect(normalizeDomainCode('service management')).toBe('SERVICE_MANAGEMENT');
    expect(normalizeDomainCode('service-management')).toBe('SERVICE_MANAGEMENT');
    expect(normalizeDomainCode('  SAP  Basis ')).toBe('SAP_BASIS');
  });

  it('refuses punctuation, because the code goes into a published identifier', () => {
    for (const bad of ['VISION*STAR', 'SAP/BASIS', 'AZURE.INFRA', 'ÉLAN']) {
      expect(() => normalizeDomainCode(bad), bad).toThrow(TaxonomyError);
    }
  });

  it('refuses a code that is too short or too long', () => {
    expect(() => normalizeDomainCode('A')).toThrow(/between 2 and 40/);
    expect(() => normalizeDomainCode('A'.repeat(DOMAIN_CODE_MAX + 1))).toThrow(/between 2 and 40/);
  });

  it('keeps digits and underscores as they are', () => {
    expect(normalizeDomainCode('SAP_S4_2026')).toBe('SAP_S4_2026');
  });
});

describe('topicSlug', () => {
  it('collapses the ways one topic name gets typed', () => {
    // The unique index is [domainId, slug], so these three are one topic.
    expect(topicSlug('SAP Integration')).toBe('sap-integration');
    expect(topicSlug('sap integration')).toBe('sap-integration');
    expect(topicSlug('  SAP   Integration  ')).toBe('sap-integration');
  });

  it('drops punctuation rather than encoding it', () => {
    expect(topicSlug('LMS / Patient Request')).toBe('lms-patient-request');
    expect(topicSlug('Order Cancellation (RxNet)')).toBe('order-cancellation-rxnet');
  });

  it('refuses a name with nothing sluggable in it', () => {
    expect(() => topicSlug('***')).toThrow(TaxonomyError);
  });
});

describe('normalizeDisplayName', () => {
  it('collapses internal whitespace but keeps case', () => {
    expect(normalizeDisplayName('  VisionStar   LMS  ', 'domain')).toBe('VisionStar LMS');
  });

  it('names what was wrong, using the caller’s word for the thing', () => {
    expect(() => normalizeDisplayName('A', 'topic')).toThrow(/topic name/);
  });
});

describe('normalizeDescription', () => {
  it('treats blank as absent, so an empty textarea does not store a space', () => {
    expect(normalizeDescription('   ')).toBeNull();
    expect(normalizeDescription(undefined)).toBeNull();
    expect(normalizeDescription(null)).toBeNull();
  });

  it('keeps real text', () => {
    expect(normalizeDescription('  Lab management systems.  ')).toBe('Lab management systems.');
  });
});
