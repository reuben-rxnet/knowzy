import { describe, expect, it } from 'vitest';
import { resolveSeparationSettings } from './separation-settings.js';

describe('resolveSeparationSettings', () => {
  it('is STRICT with no configuration at all', () => {
    const settings = resolveSeparationSettings([]);
    expect(settings.policies.authorMayApproveOwn).toBe(false);
    expect(settings.policies.editorMayApproveOwn).toBe(false);
    expect(settings.competency).toEqual({
      versionEditorMayApprove: false,
      targetEditorMayApprove: false,
    });
  });

  it('applies the platform decision to permit self-approval', () => {
    const settings = resolveSeparationSettings([
      { key: 'approval.authorMayApproveOwn', value: true },
      { key: 'approval.editorMayApproveOwn', value: true },
      { key: 'approval.competencyVersionEditorMayApprove', value: true },
      { key: 'approval.competencyTargetEditorMayApprove', value: true },
    ]);
    expect(settings.policies.authorMayApproveOwn).toBe(true);
    expect(settings.policies.editorMayApproveOwn).toBe(true);
    expect(settings.competency.versionEditorMayApprove).toBe(true);
    expect(settings.competency.targetEditorMayApprove).toBe(true);
  });

  it('never reads a malformed value as permission', () => {
    const settings = resolveSeparationSettings([
      { key: 'approval.authorMayApproveOwn', value: 'true' },
      { key: 'approval.competencyVersionEditorMayApprove', value: 1 },
    ]);
    expect(settings.policies.authorMayApproveOwn).toBe(false);
    expect(settings.competency.versionEditorMayApprove).toBe(false);
  });

  it('can be switched back on, one key at a time', () => {
    const settings = resolveSeparationSettings([
      { key: 'approval.authorMayApproveOwn', value: true },
      { key: 'approval.competencyTargetEditorMayApprove', value: false },
    ]);
    expect(settings.policies.authorMayApproveOwn).toBe(true);
    expect(settings.competency.targetEditorMayApprove).toBe(false);
  });
});
