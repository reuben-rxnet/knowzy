// Seed data — data-model.md §15: "Roles, permissions, role-permission matrix,
// default generation profile, default proficiency bands, badge definitions, and
// the mock source. Seeds are idempotent and environment-aware."
//
// Idempotent: every write is an upsert on a stable key, so running the seed
// twice changes nothing. Environment-aware: the mock source and the stub users
// exist in `local` only, and a startup assertion fails the process if a mock is
// registered elsewhere (V2).
//
// Nothing here asserts a tenant value. The mock source points at a fixture
// tree, and no credential, site URL, or list ID appears.

import { createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import {
  OUTPUT_SCHEMA_VERSION,
  canonicalPromptBody,
  PROMPT_SEMANTIC_VERSION,
} from '@knowzy/claude-services';
import {
  PERMISSION_KEYS,
  ROLE_DEFINITIONS,
  permissionFamily,
  type PermissionKey,
  type RoleKey,
} from '@knowzy/shared-types';
import {
  CONFIG_KEYS,
  CONFIG_KEY_LIST,
  FEATURE_FLAGS,
  FEATURE_FLAG_KEYS,
  ceilingPermits,
  readProcessEnv,
  resolveKnowzyEnv,
} from '@knowzy/configuration';

const prisma = new PrismaClient();

const log = (message: string): void => {
  process.stdout.write(`${message}\n`);
};

// ---------------------------------------------------------------------------
// Permissions and roles
// ---------------------------------------------------------------------------

const seedPermissions = async (): Promise<void> => {
  for (const key of PERMISSION_KEYS) {
    await prisma.permission.upsert({
      where: { key },
      create: {
        key,
        name: key,
        family: permissionFamily(key),
        description: `Permission ${key}`,
      },
      update: { family: permissionFamily(key) },
    });
  }
  log(`  permissions: ${PERMISSION_KEYS.length}`);
};

const seedRoles = async (): Promise<void> => {
  for (const role of ROLE_DEFINITIONS) {
    const created = await prisma.role.upsert({
      where: { key: role.key },
      create: {
        key: role.key,
        name: role.name,
        description: role.description,
        isSystem: true,
        portalScope: role.portalScope,
      },
      update: {
        name: role.name,
        description: role.description,
        portalScope: role.portalScope,
      },
    });

    const permissionRows = await prisma.permission.findMany({
      where: { key: { in: [...role.permissions] as string[] } },
      select: { id: true, key: true },
    });

    const found = new Set(permissionRows.map((p) => p.key));
    const missing = role.permissions.filter((p) => !found.has(p));
    if (missing.length > 0) {
      // A role referencing an unseeded permission would silently under-grant,
      // which is exactly the class of bug the closed union exists to prevent.
      throw new Error(`Role ${role.key} references unseeded permissions: ${missing.join(', ')}`);
    }

    // Replace the matrix rather than merging: role definitions are seeded
    // configuration, so the seed is authoritative and a removed permission must
    // actually be removed.
    await prisma.rolePermission.deleteMany({
      where: { roleId: created.id, permissionId: { notIn: permissionRows.map((p) => p.id) } },
    });
    for (const permission of permissionRows) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: created.id, permissionId: permission.id } },
        create: { roleId: created.id, permissionId: permission.id },
        update: {},
      });
    }
  }
  log(`  roles: ${ROLE_DEFINITIONS.length}`);
};

/**
 * Asserted here as well as in the contract test, because a seed that silently
 * grants an auditor a write permission would defeat the read-only guarantee in
 * access-control.md §2 rule 4.
 */
const assertAuditorIsReadOnly = (): void => {
  const auditor = ROLE_DEFINITIONS.find((r) => r.key === 'AUDITOR');
  if (!auditor) throw new Error('AUDITOR role definition is missing.');

  const writeish: PermissionKey[] = auditor.permissions.filter(
    (p) =>
      p !== 'audit.export' &&
      /\.(manage|configure|create|edit|submit|approve|publish|retire|archive|generate|regenerate|sync|test|reconcile)/.test(
        p,
      ),
  );
  if (writeish.length > 0) {
    throw new Error(`AUDITOR must hold no write permission; found: ${writeish.join(', ')}`);
  }
};

// ---------------------------------------------------------------------------
// Platform configuration and flags
// ---------------------------------------------------------------------------

const seedConfiguration = async (): Promise<void> => {
  // Only PLATFORM-scoped defaults are materialized. Anything not written here
  // resolves to the code default, which is the documented behaviour — a row is
  // not required for a key to have a value.
  const platformKeys = CONFIG_KEY_LIST.filter((k) => CONFIG_KEYS[k].scopes.includes('PLATFORM'));

  let created = 0;

  for (const key of platformKeys) {
    const declaration = CONFIG_KEYS[key];

    // findFirst + create rather than upsert: `scopeId` is null for a
    // PLATFORM row, and Prisma's compound-unique input rejects a null
    // component. The real uniqueness is enforced by the partial unique index
    // in migration 0003, because PostgreSQL treats NULLs as distinct and the
    // composite unique therefore would not.
    const existing = await prisma.applicationConfiguration.findFirst({
      where: { key, scope: 'PLATFORM', scopeId: null },
      select: { id: true },
    });

    // Do NOT overwrite an operator's value on re-seed. The seed establishes a
    // baseline; it does not reset a deliberate configuration decision.
    if (existing) continue;

    await prisma.applicationConfiguration.create({
      data: {
        key,
        scope: 'PLATFORM',
        scopeId: null,
        value: declaration.defaultValue as object,
        valueType: typeof declaration.defaultValue,
        isSecretRef: false,
      },
    });
    created += 1;
  }

  log(
    `  configuration: ${platformKeys.length} platform keys (${created} created, rest already present)`,
  );
};

const seedFeatureFlags = async (environment: string): Promise<void> => {
  for (const key of FEATURE_FLAG_KEYS) {
    const declaration = FEATURE_FLAGS[key];
    // A flag above its ceiling is seeded OFF regardless of its declared
    // default: the safe state for a capability this environment cannot support
    // is off (F6).
    const permitted = ceilingPermits(key, environment as 'local' | 'dev' | 'test' | 'prod');
    await prisma.featureFlag.upsert({
      where: { key_environment: { key, environment } },
      create: { key, environment, enabled: permitted && declaration.defaultEnabled },
      update: {},
    });
  }
  log(`  feature flags: ${FEATURE_FLAG_KEYS.length} for ${environment}`);
};

// ---------------------------------------------------------------------------
// Generation profile and prompt version
// ---------------------------------------------------------------------------

const DEFAULT_PROMPT_KEY = 'question-generation';
// 1.0.0 was created in Phase 1 with an explicitly inert body, and 1.1.0 held a
// hand-written paraphrase of the rules rather than the prompt itself. A
// PromptVersion is immutable once created (I14), so the corrected body arrives
// as a NEW version rather than as an edit to either row -- and the version now
// comes from @knowzy/claude-services, beside the hash that pins the body, so a
// prompt change cannot leave the recorded version behind.
const DEFAULT_PROMPT_VERSION = PROMPT_SEMANTIC_VERSION;

const seedGenerationProfile = async (): Promise<void> => {
  // A prompt version is immutable once created (I14), so the seed creates it
  // only if absent and never updates it.
  const existing = await prisma.promptVersion.findUnique({
    where: {
      promptKey_semanticVersion: {
        promptKey: DEFAULT_PROMPT_KEY,
        semanticVersion: DEFAULT_PROMPT_VERSION,
      },
    },
  });

  const promptVersion =
    existing ??
    (await prisma.promptVersion.create({
      data: {
        promptKey: DEFAULT_PROMPT_KEY,
        semanticVersion: DEFAULT_PROMPT_VERSION,
        // The prompt itself, rendered by the code that builds it, with the
        // per-call nonce placeheld. Not a DESCRIPTION of the prompt: this row
        // is what provenance points at, so it must be the text that was sent.
        // Guarded by the prompt-provenance contract test.
        body: canonicalPromptBody(),
        outputSchemaHash: createHash('sha256').update(OUTPUT_SCHEMA_VERSION).digest('hex'),
      },
    }));

  await prisma.generationProfile.upsert({
    where: { name: 'Default' },
    create: {
      name: 'Default',
      description: 'Baseline generation profile. Difficulty mix per authoring-portal.md §4.3.',
      // Configuration value, never hardcoded behaviour (architecture.md §4).
      modelId: 'claude-sonnet-5',
      promptVersionId: promptVersion.id,
      questionType: 'MULTIPLE_CHOICE_4',
      difficultyMix: { recall: 0.4, application: 0.45, analysis: 0.15 },
      maxQuestionsPerDocument: 25,
      maxQuestionsPerSection: 5,
      evidenceStrictness: 'STRICT',
      distractorRules: {
        plausibleDistractors: true,
        prohibitAllOfTheAbove: true,
        prohibitNoneOfTheAbove: true,
        distinctnessRequired: true,
      },
      duplicateFlagThreshold: CONFIG_KEYS['duplicate.flagThreshold'].defaultValue,
      duplicateBlockThreshold: CONFIG_KEYS['duplicate.blockThreshold'].defaultValue,
      coverageSettings: {
        charsPerQuestion: CONFIG_KEYS['coverage.charsPerQuestion'].defaultValue,
        minPerSection: CONFIG_KEYS['coverage.minPerSection'].defaultValue,
        maxPerSection: CONFIG_KEYS['coverage.maxPerSection'].defaultValue,
        minAssessableChars: CONFIG_KEYS['coverage.minAssessableChars'].defaultValue,
      },
      temperature: 0.2,
      maxOutputTokens: 8192,
      enabledDomainIds: [],
      isActive: true,
    },
    // The profile is configuration, not an immutable record, so it is
    // repointed at the current prompt version. Leaving it on 1.0.0 would run
    // generation against the inert Phase 1 body.
    update: { promptVersionId: promptVersion.id, modelId: 'claude-sonnet-5' },
  });
  log('  generation profile: Default');
};

// ---------------------------------------------------------------------------
// Badge definitions — badges-and-certificates.md §3
// ---------------------------------------------------------------------------

const seedBadgeDefinitions = async (): Promise<void> => {
  const gapThreshold = CONFIG_KEYS['proficiency.gapThreshold'].defaultValue;

  const definitions = [
    {
      key: 'DOMAIN_EXPERT',
      name: 'Domain Expert',
      description: 'Score 90% or above on a passed assessment in the domain.',
      category: 'PROFICIENCY',
      trigger: 'RESULT_SCORED' as const,
      isRepeatable: true,
      isPerDomain: true,
      criteria: {
        trigger: 'RESULT_SCORED',
        allOf: [
          { metric: 'percentageScore', op: 'gte', value: 90 },
          { metric: 'passed', op: 'eq', value: true },
          { metric: 'resultState', op: 'eq', value: 'SCORED' },
        ],
      },
    },
    {
      key: 'DOMAIN_PROFICIENT',
      name: 'Proficient',
      description: 'Score 75% or above on a passed assessment in the domain.',
      category: 'PROFICIENCY',
      trigger: 'RESULT_SCORED' as const,
      isRepeatable: true,
      isPerDomain: true,
      criteria: {
        trigger: 'RESULT_SCORED',
        allOf: [
          { metric: 'percentageScore', op: 'gte', value: 75 },
          { metric: 'passed', op: 'eq', value: true },
          { metric: 'resultState', op: 'eq', value: 'SCORED' },
        ],
      },
    },
    {
      key: 'FIRST_ASSESSMENT',
      name: 'First Steps',
      description: 'Complete and pass any assessment.',
      category: 'MILESTONE',
      trigger: 'RESULT_SCORED' as const,
      isRepeatable: false,
      isPerDomain: false,
      criteria: {
        trigger: 'RESULT_SCORED',
        allOf: [
          { metric: 'passed', op: 'eq', value: true },
          { metric: 'resultState', op: 'eq', value: 'SCORED' },
        ],
      },
    },
    {
      key: 'PERFECT_SCORE',
      name: 'Flawless',
      description: 'Score 100% with no unanswered questions.',
      category: 'PROFICIENCY',
      trigger: 'RESULT_SCORED' as const,
      isRepeatable: true,
      isPerDomain: false,
      criteria: {
        trigger: 'RESULT_SCORED',
        allOf: [
          { metric: 'percentageScore', op: 'gte', value: 100 },
          { metric: 'unansweredCount', op: 'eq', value: 0 },
          { metric: 'resultState', op: 'eq', value: 'SCORED' },
        ],
      },
    },
    {
      key: 'FIRST_ATTEMPT_PASS',
      name: 'Right First Time',
      description: 'Pass on attempt 1.',
      category: 'MILESTONE',
      trigger: 'RESULT_SCORED' as const,
      isRepeatable: true,
      isPerDomain: false,
      criteria: {
        trigger: 'RESULT_SCORED',
        allOf: [
          { metric: 'passed', op: 'eq', value: true },
          { metric: 'attemptNumber', op: 'eq', value: 1 },
          { metric: 'resultState', op: 'eq', value: 'SCORED' },
        ],
      },
    },
    {
      key: 'NO_WEAK_TOPICS',
      name: 'Balanced Knowledge',
      description:
        'Pass with every assessed topic at or above the gap threshold, and at least three topics assessed.',
      category: 'PROFICIENCY',
      trigger: 'RESULT_SCORED' as const,
      isRepeatable: true,
      isPerDomain: false,
      criteria: {
        trigger: 'RESULT_SCORED',
        allOf: [
          { metric: 'passed', op: 'eq', value: true },
          { metric: 'topicGapCount', op: 'eq', value: 0 },
          { metric: 'allTopicsAtOrAbove', op: 'gte', value: gapThreshold },
          { metric: 'resultState', op: 'eq', value: 'SCORED' },
        ],
      },
    },
    {
      key: 'BREADTH',
      name: 'Broad Coverage',
      description: 'Pass assessments in three or more distinct domains.',
      category: 'BREADTH',
      trigger: 'RESULT_SCORED' as const,
      isRepeatable: false,
      isPerDomain: false,
      criteria: {
        trigger: 'RESULT_SCORED',
        allOf: [{ metric: 'resultState', op: 'eq', value: 'SCORED' }],
        aggregate: { metric: 'distinctDomainsPassed', op: 'gte', value: 3 },
      },
    },
    {
      key: 'CONSISTENCY',
      name: 'Consistent Performer',
      description:
        'Pass three or more assessments in a rolling 90 days with an average of 80% or above.',
      category: 'CONSISTENCY',
      trigger: 'PERIODIC' as const,
      isRepeatable: true,
      isPerDomain: false,
      criteria: {
        trigger: 'PERIODIC',
        allOf: [{ metric: 'resultState', op: 'eq', value: 'SCORED' }],
        window: { kind: 'ROLLING_DAYS', days: 90 },
        aggregate: { metric: 'averageScoreInWindow', op: 'gte', value: 80 },
      },
    },
    {
      key: 'REFRESHER_COMPLETION',
      name: 'Closing the Gap',
      description: 'Complete five or more knowledge refreshers.',
      category: 'REMEDIATION',
      trigger: 'RECOMMENDATION_COMPLETED' as const,
      isRepeatable: true,
      isPerDomain: false,
      criteria: {
        trigger: 'RECOMMENDATION_COMPLETED',
        allOf: [],
        aggregate: { metric: 'recommendationsCompleted', op: 'gte', value: 5 },
      },
    },
    {
      key: 'IMPROVEMENT',
      name: 'Measurable Improvement',
      description:
        'A later attempt on the same assessment exceeds the earlier by 15 points or more.',
      category: 'IMPROVEMENT',
      trigger: 'RESULT_SCORED' as const,
      isRepeatable: true,
      isPerDomain: false,
      criteria: {
        trigger: 'RESULT_SCORED',
        allOf: [{ metric: 'resultState', op: 'eq', value: 'SCORED' }],
        aggregate: { metric: 'improvementPoints', op: 'gte', value: 15 },
      },
    },
  ];

  for (const d of definitions) {
    await prisma.badgeDefinition.upsert({
      where: { key: d.key },
      create: {
        key: d.key,
        name: d.name,
        description: d.description,
        category: d.category,
        trigger: d.trigger,
        criteria: d.criteria,
        isActive: true,
        isRepeatable: d.isRepeatable,
        isPerDomain: d.isPerDomain,
      },
      update: { name: d.name, description: d.description, criteria: d.criteria },
    });
  }
  log(`  badge definitions: ${definitions.length}`);
};

const seedCertificateRule = async (): Promise<void> => {
  await prisma.certificateRule.upsert({
    where: { key: 'ASSESSMENT_CERTIFICATE' },
    create: {
      key: 'ASSESSMENT_CERTIFICATE',
      name: 'Assessment Certificate',
      templateRef: 'assessment-certificate-v1',
      validityMonths: null,
      criteria: {
        trigger: 'RESULT_SCORED',
        allOf: [
          { metric: 'passed', op: 'eq', value: true },
          { metric: 'resultState', op: 'eq', value: 'SCORED' },
        ],
      },
      isActive: true,
    },
    update: {},
  });
  log('  certificate rule: ASSESSMENT_CERTIFICATE');
};

// ---------------------------------------------------------------------------
// Local-only: stub users and the mock source
// ---------------------------------------------------------------------------

/** Deterministic pseudo-oid for a local stub user. Not a real Entra object id. */
const localOid = (slug: string): string => `local-stub-${slug}`;

const seedLocalUsers = async (): Promise<string> => {
  // One user per role, so every authorization path is exercisable locally
  // without a tenant (§8).
  const people: {
    slug: string;
    displayName: string;
    roleKeys: readonly RoleKey[];
    authoring: boolean;
    live: boolean;
  }[] = ROLE_DEFINITIONS.map((role) => ({
    slug: role.key.toLowerCase().replace(/_/g, '-'),
    displayName: `Local ${role.name}`,
    roleKeys: [role.key] as readonly RoleKey[],
    authoring: role.portalScope !== 'LIVE',
    live: role.portalScope !== 'AUTHORING',
  }));

  // The KNOWZY Administrator identity holds TWO roles, because that is how
  // access-control.md 2 rule 3 says to combine approval and publication: "A
  // tenant may combine them by assigning both roles, which is a visible,
  // audited decision rather than a default." Permissions are the union across
  // a user's roles, so this identity holds every permission key.
  const administrator = people.find((person) => person.slug === 'knowzy-administrator');
  if (administrator) administrator.roleKeys = ['KNOWZY_ADMINISTRATOR', 'PUBLISHER'];

  // A SECOND administrator, and not a convenience.
  //
  // Separation of duties is an identity comparison, not a permission: gate 13
  // refuses an approver who is the question's author or last editor, and no
  // permission key can satisfy it. One administrator therefore cannot carry a
  // question from draft to approval alone -- correctly. This second identity
  // exists so the pilot workflow can be completed end to end with exactly one
  // deliberate switch at the approval step, rather than by weakening the gate
  // that makes approval mean anything.
  people.push({
    slug: 'knowzy-administrator-2',
    displayName: 'Local KNOWZY Administrator (second approver)',
    roleKeys: ['KNOWZY_ADMINISTRATOR', 'PUBLISHER'],
    authoring: true,
    live: true,
  });

  let adminId = '';

  for (const person of people) {
    const user = await prisma.user.upsert({
      where: { entraObjectId: localOid(person.slug) },
      create: {
        entraObjectId: localOid(person.slug),
        userPrincipalName: `${person.slug}@local.invalid`,
        displayName: person.displayName,
        status: 'ACTIVE',
        authoringPortalAccess: person.authoring,
        livePortalAccess: person.live,
        timeZone: 'UTC',
      },
      update: { displayName: person.displayName },
    });

    if (person.slug === 'platform-administrator') adminId = user.id;

    for (const roleKey of person.roleKeys) {
      const role = await prisma.role.findUniqueOrThrow({ where: { key: roleKey } });
      const already = await prisma.userRole.findFirst({
        where: { userId: user.id, roleId: role.id, revokedAt: null },
      });
      if (!already) {
        await prisma.userRole.create({
          data: {
            userId: user.id,
            roleId: role.id,
            grantedByUserId: user.id,
            reason: 'Local development seed',
          },
        });
      }
    }
  }

  log(`  local users: ${people.length} (one per role, plus a second administrator)`);
  return adminId;
};

/**
 * One domain and one topic, so a local author can generate.
 *
 * workflows.md §2.1 precondition 7 requires both to exist; without them the
 * zero-credential path stops at the first generation attempt. Real taxonomy is
 * administrator-managed, and this is the minimum that makes the path runnable.
 */
const seedLocalTaxonomy = async (): Promise<void> => {
  const domain = await prisma.domain.upsert({
    where: { code: 'SUPPORT_OPS' },
    create: {
      code: 'SUPPORT_OPS',
      name: 'Support Operations',
      description: 'Frontline support procedures, escalation, billing, and data handling.',
      isActive: true,
    },
    update: {},
  });

  const existingTopic = await prisma.topic.findFirst({
    where: { domainId: domain.id, slug: 'escalation-and-billing' },
  });
  if (!existingTopic) {
    await prisma.topic.create({
      data: {
        domainId: domain.id,
        name: 'Escalation and Billing',
        slug: 'escalation-and-billing',
        description: 'Severity classification, escalation timings, refunds, and chargebacks.',
        isActive: true,
      },
    });
  }

  log('  local taxonomy: 1 domain (SUPPORT_OPS), 1 topic');
};

const seedMockSource = async (ownerUserId: string): Promise<void> => {
  // A mock source carries no tenant value and no credential. `fixtureRoot` is a
  // path into the repository's fixture tree.
  await prisma.knowledgeSource.upsert({
    where: { name: 'Mock Support Operations' },
    create: {
      name: 'Mock Support Operations',
      description: 'Fixture-backed source for local development. No tenant credentials required.',
      sourceType: 'MOCK',
      // `sourceKey` names the fixture TREE, not a filesystem path: the MCP
      // server owns where fixtures live, so a source row cannot point the
      // adapter at an arbitrary directory.
      connection: { sourceKey: 'support-operations', authMethod: 'NONE' },
      restrictions: { roles: [], domains: [], teams: [], functions: [] },
      usableForGeneration: true,
      usableForRefreshers: true,
      usableForExplanations: true,
      permissionMode: 'DELEGATED_OBO',
      // UNTESTED until a probe runs. §5.4 rule 1: never inferred, never
      // defaulted to healthy — not even for a mock.
      connectionStatus: 'UNTESTED',
      connectionStatusAt: null,
      syncSchedule: { mode: 'MANUAL' },
      isActive: true,
      ownerUserId,
      // Two containers, mirroring the top level of the fixture tree. Only the
      // file types a registered extractor can actually handle are included:
      // listing `pdf` here would promise coverage the platform cannot deliver
      // until that extractor exists.
      paths: {
        create: [
          {
            containerId: 'SOPs',
            containerName: 'SOPs',
            folderPath: '/',
            includedFileTypes: ['md', 'txt', 'html'],
            excludedFileTypes: [],
            includedMetadata: ['Owner', 'ReviewCycle', 'Classification'],
            requiresFullSync: true,
            isActive: true,
          },
          {
            containerId: 'Policies',
            containerName: 'Policies',
            folderPath: '/',
            includedFileTypes: ['md', 'txt', 'html'],
            excludedFileTypes: [],
            includedMetadata: ['Owner', 'ReviewCycle', 'Classification'],
            requiresFullSync: true,
            isActive: true,
          },
        ],
      },
    },
    update: {},
  });
  log('  mock source: Mock Support Operations (UNTESTED)');
};

const seedPilotFileRepositorySource = async (ownerUserId: string): Promise<void> => {
  // The transitional pilot source: a FILE_REPOSITORY over a locally
  // synchronized mirror of an approved SharePoint folder.
  //
  // `localRoot` is the committed repository-relative FIXTURE mirror, so a fresh
  // clone has a working demonstration with no OneDrive at all. The real
  // synchronized root is supplied by `PILOT_MIRROR_ROOT` in the environment and
  // overrides this, because a machine-specific path must never be committed.
  //
  // `webUrlBase` is a NEUTRAL host here on purpose. Content rule C2 forbids a
  // SharePoint tenant hostname in source, and the approved pilot URL is a
  // customer identifier: it is recorded in RealWorldPilot/CorpusManifest.md,
  // and an operator sets it on the source for a real run.
  await prisma.knowledgeSource.upsert({
    where: { name: 'KNOWZY Real-World Pilot SOP Corpus' },
    create: {
      name: 'KNOWZY Real-World Pilot SOP Corpus',
      description:
        'Transitional pilot source. Reads a locally synchronized mirror of an approved ' +
        'SharePoint folder while Graph access awaits tenant consent. Access is enforced by ' +
        'Knowzy, not by SharePoint.',
      sourceType: 'FILE_REPOSITORY',
      connection: {
        localRoot: './fixtures/pilot-mirror',
        provenance: 'SHAREPOINT_MIRROR',
        webUrlBase:
          'https://pilot-tenant.invalid/sites/CentralRxOperationsSupport/Shared%20Documents/Reuben/Projects/Knowzy',
        mirrorAccountUpn: 'pilot.sync@example.invalid',
        includePatterns: [],
        excludePatterns: [],
        supportedExtensions: [],
        maxFileBytes: 33554432,
        partialSyncFloor: 0.8,
        sidecarsEnabled: true,
        isActive: true,
      },
      restrictions: { roles: [], domains: [], teams: [], functions: [] },
      usableForGeneration: true,
      usableForRefreshers: false,
      usableForExplanations: false,
      // DELEGATED_OBO is REFUSED by this adapter: a directory carries no
      // per-user SharePoint decision, and accepting the mode would
      // misrepresent who enforces access.
      permissionMode: 'APP_ONLY_SITES_SELECTED',
      connectionStatus: 'UNTESTED',
      connectionStatusAt: null,
      syncSchedule: { mode: 'MANUAL' },
      isActive: true,
      ownerUserId,
      // Every file type with a registered extractor, which now includes the
      // four binary Office formats. Listing a type without an extractor would
      // promise coverage the platform cannot deliver.
      paths: {
        create: [
          {
            containerId: 'SOPs',
            containerName: 'SOPs',
            folderPath: '/',
            includedFileTypes: ['pdf', 'docx', 'pptx', 'xlsx', 'md', 'txt', 'html'],
            excludedFileTypes: [],
            includedMetadata: ['Owner', 'ReviewCycle', 'Classification'],
            requiresFullSync: true,
            isActive: true,
          },
          {
            containerId: 'Policies',
            containerName: 'Policies',
            folderPath: '/',
            includedFileTypes: ['pdf', 'docx', 'pptx', 'xlsx', 'md', 'txt', 'html'],
            excludedFileTypes: [],
            includedMetadata: ['Owner', 'ReviewCycle', 'Classification'],
            requiresFullSync: true,
            isActive: true,
          },
        ],
      },
    },
    update: {},
  });
  log('  pilot source: KNOWZY Real-World Pilot SOP Corpus (FILE_REPOSITORY, UNTESTED)');
};

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const main = async (): Promise<void> => {
  const env = resolveKnowzyEnv(readProcessEnv());
  if (!env) {
    throw new Error('KNOWZY_ENV must be one of local, dev, test, prod before seeding.');
  }

  log(`Seeding Knowzy (${env})`);

  assertAuditorIsReadOnly();

  await seedPermissions();
  await seedRoles();
  await seedConfiguration();
  await seedFeatureFlags(env);
  await seedGenerationProfile();
  await seedBadgeDefinitions();
  await seedCertificateRule();

  if (env === 'local') {
    const adminId = await seedLocalUsers();
    await seedLocalTaxonomy();
    if (adminId) await seedMockSource(adminId);
    if (adminId) await seedPilotFileRepositorySource(adminId);
  } else {
    log('  skipping stub users and mock source: not a local environment (V2)');
  }

  log('Seed complete. Idempotent: re-running changes nothing.');
};

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    process.exitCode = 1;
    process.stderr.write(
      `Seed failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    await prisma.$disconnect();
  });
