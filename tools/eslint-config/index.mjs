// Knowzy shared ESLint flat config.
//
// Implements the CONTENT rules of repository-structure.md §5.2 (C1–C8).
// The import-graph rules (B1–B10) are enforced by dependency-cruiser
// (.dependency-cruiser.cjs) because it sees transitive edges, which is what
// B3 ("transitively") requires. C9 and C10 are type-level tests in
// packages/testing/contracts, not lint rules.
//
// Every rule below names the invariant it protects, so a failure message tells
// the author which documented rule they hit.

import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/** C1 — no SharePoint internal field names outside the adapter package. */
const NO_INTERNAL_FIELD_NAMES = [
  {
    selector: 'Literal[value=/^field_[0-9]+$/]',
    message:
      'C1: SharePoint internal field names (field_n) may appear only in @knowzy/knowledge-source-adapters. Use a semantic key and resolve it through the mapping profile — see docs/sharepoint-field-mapping.md §4.1.',
  },
  {
    selector: 'Literal[value=/_x0020_/]',
    message:
      'C1: encoded SharePoint internal names (_x0020_) may appear only in @knowzy/knowledge-source-adapters. See docs/sharepoint-field-mapping.md §4.1.',
  },
];

/** C2 — no tenant topology literals anywhere. "Sources are data, not code." */
const NO_TENANT_LITERALS = [
  {
    selector: 'Literal[value=/\\.sharepoint\\.com/]',
    message:
      'C2: no SharePoint tenant hostname may appear in source. Site URLs are KnowledgeSource rows entered by administrators — see docs/knowledge-source-administration.md §1.',
  },
  {
    selector:
      'Literal[value=/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/]',
    message:
      'C2: no GUID literal may appear in source. Site, drive, and list IDs are resolved at Test Connection time and stored — see docs/knowledge-source-administration.md §4.',
  },
];

/** C3 — one configuration resolution path. */
const NO_PROCESS_ENV = [
  {
    selector: "MemberExpression[object.name='process'][property.name='env']",
    message:
      'C3: read configuration through @knowzy/configuration, not process.env. One resolution path, one place to audit — see docs/environment-and-configuration.md §3.2 P3.',
  },
];

/** C4 — parameterized SQL only, in two packages. */
const NO_RAW_SQL = [
  {
    selector: 'MemberExpression[property.name=/^\\$queryRaw(Unsafe)?$/]',
    message:
      'C4: $queryRaw is permitted only in @knowzy/reporting and the similarity module, parameterized. See docs/security.md §10.',
  },
  {
    selector: 'MemberExpression[property.name=/^\\$executeRaw(Unsafe)?$/]',
    message:
      'C4: $executeRaw is permitted only in @knowzy/database migrations tooling. See docs/security.md §10.',
  },
];

/** C6 — one injected clock. */
const NO_AMBIENT_CLOCK = [
  {
    selector: "NewExpression[callee.name='Date'][arguments.length=0]",
    message:
      'C6: use the injected Clock, not new Date(). Tests substitute a fixed clock — see docs/data-model.md §9 T3.',
  },
  {
    selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
    message: 'C6: use the injected Clock, not Date.now(). See docs/data-model.md §9 T3.',
  },
];

/** C5 — markup from a document can never reach the DOM. */
const NO_RAW_HTML = [
  {
    selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
    message:
      'C5: dangerouslySetInnerHTML is prohibited in both portals, with no exceptions. See docs/security.md §5.',
  },
];

const baseTs = [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-non-null-assertion': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      // No options: ESLint's schema requires `allow` to be non-empty, and
      // there is nothing we want to allow. Apps write via process.stdout.
      'no-console': 'error',
      // B10 — deep imports bypass the exports map, and a boundary that can be
      // bypassed by path is not a boundary.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@knowzy/*/src/*', '@knowzy/*/dist/*'],
              message:
                'B10: import from the package entry point only. Deep imports bypass the exports map — see docs/repository-structure.md §5.1.',
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        ...NO_INTERNAL_FIELD_NAMES,
        ...NO_TENANT_LITERALS,
        ...NO_RAW_SQL,
      ],
    },
  },
];

/**
 * @param {object} options
 * @param {'library'|'service'|'web'|'adapters'|'reporting'|'configuration'|'database'|'domain'|'testing'|'e2e'} options.kind
 */
export function knowzyConfig({ kind }) {
  /** @type {import('eslint').Linter.Config[]} */
  const config = [
    { ignores: ['dist/**', '.next/**', '.turbo/**', 'coverage/**', '**/*.generated.ts'] },
    ...baseTs,
  ];

  const restricted = [];

  // C1 is relaxed only inside the adapter package — it is the one place that
  // legitimately speaks SharePoint's internal vocabulary.
  if (kind !== 'adapters') {
    restricted.push(...NO_INTERNAL_FIELD_NAMES);
  }

  // C3 — @knowzy/configuration is the only reader of process.env.
  //
  // `e2e` is the second exemption, and a narrow one: the browser acceptance
  // harness is not deployed and is not part of the product's configuration
  // surface. It reads the URLs of the stack it drives and which installed
  // browser to use. Routing those through @knowzy/configuration would declare
  // test-runner settings as platform configuration keys, which is the opposite
  // of what C3 is protecting.
  if (kind !== 'configuration' && kind !== 'e2e') {
    restricted.push(...NO_PROCESS_ENV);
  }

  // C4 — relaxed in reporting (parameterized aggregates) and database (migration tooling).
  if (kind !== 'reporting' && kind !== 'database') {
    restricted.push(...NO_RAW_SQL);
  }

  // C6 — the clock rule binds the two packages whose output is persisted.
  if (kind === 'domain' || kind === 'database') {
    restricted.push(...NO_AMBIENT_CLOCK);
  }

  if (kind === 'web') {
    restricted.push(...NO_RAW_HTML);
  }

  restricted.push(...NO_TENANT_LITERALS);

  config.push({
    rules: {
      'no-restricted-syntax': ['error', ...restricted],
    },
  });

  // C8 — no `any` in shared-types; schemas are the contract.
  if (kind === 'library') {
    config.push({
      rules: {
        '@typescript-eslint/no-explicit-any': 'error',
        '@typescript-eslint/explicit-module-boundary-types': 'off',
      },
    });
  }

  // Test files.
  //
  // C2 exists to keep tenant TOPOLOGY out of production code. A synthetic GUID
  // or hostname in a fixture is the opposite: it is how a test proves the rule
  // works — the redaction suite asserts that a UUID SURVIVES redaction, and the
  // startup suite needs a well-formed client id to validate against. So C2 is
  // lifted for tests while C1, C3, C4, and C6 stay in force, because a test
  // reaching for a real internal field name or raw SQL is still a defect.
  const restrictedForTests = restricted.filter(
    (rule) => !NO_TENANT_LITERALS.some((tenant) => tenant.selector === rule.selector),
  );

  config.push({
    files: ['**/*.test.ts', '**/*.test.tsx', '**/test/**', '**/contracts/**', 'fixtures/**'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-restricted-syntax': ['error', ...restrictedForTests],
    },
  });

  return config;
}

export default knowzyConfig;
