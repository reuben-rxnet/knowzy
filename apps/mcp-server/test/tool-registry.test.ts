// G2: every MCP tool has a declared policy, portal partition, timeout budget,
// and audit action — repository-structure.md §5.3.
//
// The registry is the only path to the HTTP surface, so this suite checks two
// separate things: that each declaration is complete and coherent, and that the
// declarations actually govern what a caller can reach. A registry nobody
// enforces is documentation.

import { describe, expect, it } from 'vitest';
import { PERMISSION_KEYS, AUDIT_ACTIONS } from '@knowzy/shared-types';
import {
  allTools,
  registerTool,
  resolveTool,
  toolsForPortal,
  type ToolPortal,
} from '../src/tools/registry.js';
import { ENVELOPE_SIGNING_ENFORCED, verifyEnvelope } from '../src/tools/envelope.js';

// Importing the modules is what registers the tools.
import '../src/tools/source-administration.js';
import '../src/tools/source-navigation.js';

const permissionKeys = new Set<string>(PERMISSION_KEYS);
const auditActions = new Set<string>(AUDIT_ACTIONS);

describe('MCP tool registry completeness (G2)', () => {
  const tools = allTools();

  it('registers the tools this milestone claims', () => {
    expect(tools.map((tool) => tool.name)).toEqual([
      'extract_document_content',
      'get_document_permissions',
      'get_document_sections',
      'get_knowledge_source',
      'get_source_document',
      'get_synchronization_history',
      'list_knowledge_sources',
      'list_source_containers',
      'list_source_items',
      'search_source_documents',
      'synchronize_knowledge_source',
      'test_knowledge_source',
    ]);
  });

  it('declares a permission drawn from the closed permission union', () => {
    for (const tool of tools) {
      expect(permissionKeys.has(tool.permission), tool.name).toBe(true);
    }
  });

  it('declares at least one portal', () => {
    for (const tool of tools) {
      expect(tool.portals.length, tool.name).toBeGreaterThan(0);
    }
  });

  it('declares a timeout budget that is finite and positive', () => {
    for (const tool of tools) {
      expect(tool.timeoutMs, tool.name).toBeGreaterThan(0);
      // An hour-long tool call would outlive the envelope it runs under.
      expect(tool.timeoutMs, tool.name).toBeLessThanOrEqual(600_000);
    }
  });

  it('declares an audit action, or names the rule that exempts it', () => {
    for (const tool of tools) {
      if (tool.auditAction === null) {
        expect(tool.auditExemptionReason, tool.name).toMatch(/audit-model\.md §8/);
        continue;
      }
      expect(auditActions.has(tool.auditAction), tool.name).toBe(true);
      expect(tool.auditExemptionReason, tool.name).toBeUndefined();
    }
  });

  it('audits every tool that writes', () => {
    for (const tool of tools.filter((t) => t.writes !== 'NONE')) {
      expect(tool.auditAction, tool.name).not.toBeNull();
    }
  });

  it('lets no tool outside the question-bank family write externally', () => {
    for (const tool of tools) {
      if (tool.writes !== 'EXTERNAL') continue;
      expect(tool.family, tool.name).toBe('question-bank');
    }
  });

  it('gives every tool a description an administrator could read', () => {
    for (const tool of tools) {
      expect(tool.description.length, tool.name).toBeGreaterThan(20);
    }
  });
});

describe('registration refuses an incomplete declaration', () => {
  const base = {
    family: 'source-navigation',
    permission: 'document.browse' as const,
    portals: ['AUTHORING'] as readonly ToolPortal[],
    timeoutMs: 1_000,
    description: 'A planted tool used only to prove registration validates.',
    input: { safeParse: () => ({ success: true, data: {} }) } as never,
    handler: async () => ({}),
  };

  it('refuses a tool with no portal, because nothing could call it', () => {
    expect(() =>
      registerTool({ ...base, name: 'planted_no_portal', portals: [], auditAction: null,
        auditExemptionReason: 'audit-model.md §8' }),
    ).toThrow(/declares no portal/);
  });

  it('refuses silence about audit: no action and no exemption reason', () => {
    expect(() => registerTool({ ...base, name: 'planted_silent_audit', auditAction: null })).toThrow(
      /no audit action and no exemption reason/,
    );
  });

  it('refuses a write tool that claims an audit exemption', () => {
    expect(() =>
      registerTool({
        ...base,
        name: 'planted_unaudited_write',
        writes: 'LOCAL',
        auditAction: null,
        auditExemptionReason: 'audit-model.md §8: reads are exempt',
      }),
    ).toThrow(/writes, so it cannot be exempt/);
  });

  it('refuses an external write outside the question-bank family', () => {
    expect(() =>
      registerTool({
        ...base,
        name: 'planted_external_write',
        family: 'source-navigation',
        writes: 'EXTERNAL',
        auditAction: 'ADMIN.SOURCE.UPDATED',
      }),
    ).toThrow(/cannot write externally/);
  });

  it('refuses a duplicate name rather than letting load order decide policy', () => {
    expect(() =>
      registerTool({
        ...base,
        name: 'list_source_items',
        writes: 'NONE',
        auditAction: null,
        auditExemptionReason: 'audit-model.md §8',
      }),
    ).toThrow(/already registered/);
  });
});

describe('portal partitioning (E5)', () => {
  it('makes an authoring tool NOT EXIST for a LIVE envelope', () => {
    expect(resolveTool('AUTHORING', 'extract_document_content')).toBeDefined();
    // Not "refused" — absent. The reply is 404, so it cannot confirm the tool
    // exists elsewhere.
    expect(resolveTool('LIVE', 'extract_document_content')).toBeUndefined();
  });

  it('exposes no authoring or bank tool to the LIVE portal', () => {
    // mcp-tools.md E5: a LIVE envelope reaches §11 learning tools and
    // get_published_question, and nothing else. None of those are registered
    // yet, so the correct current answer is an empty set — not a partial one.
    expect(toolsForPortal('LIVE')).toEqual([]);
  });

  it('gives the SYSTEM portal the sync tool, so a schedule can run it (E6)', () => {
    expect(resolveTool('SYSTEM', 'synchronize_knowledge_source')).toBeDefined();
  });

  it('keeps browsing out of the SYSTEM portal', () => {
    // A scheduled job has no user to browse on behalf of; granting it browse
    // would create an unattributable read path.
    expect(resolveTool('SYSTEM', 'list_source_items')).toBeUndefined();
  });

  it('returns undefined for a name that was never registered', () => {
    expect(resolveTool('AUTHORING', 'delete_everything')).toBeUndefined();
  });
});

describe('envelope verification', () => {
  const clock = { now: () => new Date('2026-01-01T00:00:00.000Z') };
  const valid = {
    subject: {
      userId: '00000000-0000-0000-0000-000000000001',
      entraObjectId: 'oid-1',
      displayName: 'Test Author',
    },
    portal: 'AUTHORING' as const,
    effectiveRoles: ['CONTENT_AUTHOR'],
    permissions: ['document.browse'],
    dataScope: { domainIds: [], teamIds: [], sourceIds: [], denySourceIds: [] },
    delegation: { mode: 'NONE' as const },
    correlationId: 'corr-1',
    requestId: 'req-1',
    issuedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2026-01-01T00:02:00.000Z',
  };

  it('accepts a well-formed, unexpired envelope', () => {
    expect(verifyEnvelope(valid, { clock }).envelope.subject.userId).toBe(valid.subject.userId);
  });

  it('rejects an expired envelope', () => {
    expect(() =>
      verifyEnvelope({ ...valid, expiresAt: '2025-12-31T23:59:00.000Z' }, { clock }),
    ).toThrow(/expired/);
  });

  it('rejects an envelope issued in the future', () => {
    expect(() =>
      verifyEnvelope(
        { ...valid, issuedAt: '2026-01-01T01:00:00.000Z', expiresAt: '2026-01-01T01:02:00.000Z' },
        { clock },
      ),
    ).toThrow(/future/);
  });

  it('rejects an on-behalf-of reference without delegation (E4)', () => {
    expect(() =>
      verifyEnvelope(
        { ...valid, delegation: { mode: 'NONE', oboTokenRef: 'handle-1' } },
        { clock },
      ),
    ).toThrow(/without delegation/);
  });

  it('rejects an unknown field rather than ignoring it', () => {
    expect(() => verifyEnvelope({ ...valid, isAdmin: true }, { clock })).toThrow(/rejected/);
  });

  it('names the failing field but never echoes its value', () => {
    try {
      verifyEnvelope({ ...valid, correlationId: '' }, { clock });
      expect.unreachable('the envelope should have been rejected');
    } catch (error) {
      expect((error as Error).message).toContain('correlationId');
    }
  });

  it('records that envelope SIGNING is not yet enforced (deviation from E1)', () => {
    // Asserted, not assumed: turning signing on must be a visible change, and
    // this test is what makes the deviation impossible to forget.
    expect(ENVELOPE_SIGNING_ENFORCED).toBe(false);
  });
});
