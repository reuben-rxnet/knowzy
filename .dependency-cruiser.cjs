// Boundary enforcement for repository-structure.md §5.1 (B1–B10).
//
// dependency-cruiser owns the import-graph rules because it sees transitive
// edges — B3 is specified "transitively", and a direct-import-only check would
// miss @knowzy/domain -> @knowzy/some-helper -> @knowzy/knowledge-source-adapters,
// which is exactly the shape that erodes a port over time.
//
// npm workspaces symlink node_modules/@knowzy/* to packages/*; dependency-cruiser
// resolves symlinks by default, so these path regexes match the real locations.

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    // ---------------------------------------------------------------- B1
    {
      name: 'b1-web-no-server-packages',
      comment:
        'B1: no secret, no adapter, and no answer-key-capable code in a browser bundle. Web apps talk to the API over HTTP.',
      severity: 'error',
      from: { path: '^apps/(authoring-web|live-web)/' },
      to: {
        path: '^packages/(database|knowledge-source-adapters|claude-services|domain|reporting|certificate-generator|content-extraction)/',
      },
    },

    // ---------------------------------------------------------------- B2
    {
      name: 'b2-api-no-adapters',
      comment:
        'B2: the API must reach every knowledge source through MCP. This is what makes "no domain service can reach Graph by another path" structural — architecture.md §7.4.',
      severity: 'error',
      from: { path: '^apps/api/' },
      to: { path: '^packages/(knowledge-source-adapters|content-extraction)/' },
    },

    // ---------------------------------------------------------------- B3
    {
      name: 'b3-domain-no-external-vocabulary',
      comment:
        'B3: domain services speak adapter interfaces only, transitively. architecture.md §3.1 rule 2.',
      severity: 'error',
      from: { path: '^packages/domain/' },
      to: {
        path: '^packages/(knowledge-source-adapters|content-extraction)/',
        reachable: true,
      },
    },
    {
      name: 'b3-domain-no-graph-sdk',
      comment: 'B3: no Graph or SharePoint SDK type may reach the domain layer, transitively.',
      severity: 'error',
      from: { path: '^packages/domain/' },
      to: {
        path: 'node_modules/(@microsoft/microsoft-graph-client|@microsoft/microsoft-graph-types|@azure/msal-node)',
        reachable: true,
      },
    },

    // ---------------------------------------------------------------- B4
    {
      name: 'b4-claude-services-no-data-access',
      comment:
        'B4: the prompt layer has no data access, so it cannot widen retrieval. architecture.md §3.1 rule 4.',
      severity: 'error',
      from: { path: '^packages/claude-services/' },
      to: { path: '^packages/database/', reachable: true },
    },
    {
      name: 'b4-claude-services-no-prisma',
      comment: 'B4: @knowzy/claude-services may not reach a database client at all.',
      severity: 'error',
      from: { path: '^packages/claude-services/' },
      to: { path: 'node_modules/(@prisma/client|prisma)', reachable: true },
    },

    // ---------------------------------------------------------------- B5
    {
      name: 'b5-adapters-are-pure',
      comment:
        'B5: adapters receive configuration and return data. They cannot mutate platform state. knowledge-source-adapters.md §2.1.',
      severity: 'error',
      from: { path: '^packages/knowledge-source-adapters/' },
      to: { path: '^packages/(database|domain|claude-services|reporting)/' },
    },

    // ---------------------------------------------------------------- B6
    {
      name: 'b6-shared-ui-is-a-design-system',
      comment: 'B6: @knowzy/shared-ui may import nothing but @knowzy/shared-types.',
      severity: 'error',
      from: { path: '^packages/shared-ui/' },
      to: {
        path: '^packages/',
        pathNot: '^packages/(shared-ui|shared-types)/',
      },
    },

    // ---------------------------------------------------------------- B7
    {
      name: 'b7-shared-types-is-the-graph-root',
      comment:
        'B7: @knowzy/shared-types imports no workspace package. A cycle here would break codegen.',
      severity: 'error',
      from: { path: '^packages/shared-types/' },
      to: { path: '^packages/', pathNot: '^packages/shared-types/' },
    },

    // ---------------------------------------------------------------- B8
    {
      name: 'b8-apps-are-leaves',
      comment: 'B8: no package may import from an app.',
      severity: 'error',
      from: { path: '^packages/' },
      to: { path: '^apps/' },
    },

    // ---------------------------------------------------------------- B9
    {
      name: 'b9-no-cycles',
      comment: 'B9: no cycles anywhere, at any granularity.',
      severity: 'error',
      from: {},
      to: { circular: true },
    },

    // ---------------------------------------------------------------- B10
    //
    // B10 (no deep imports) is enforced by ESLint's `no-restricted-imports`
    // against the `@knowzy/*/src/*` and `@knowzy/*/dist/*` patterns, not here.
    //
    // dependency-cruiser resolves a cross-package deep import to the same
    // on-disk path as a package's own relative import, so a path-based rule at
    // this layer cannot distinguish "packages/a imported packages/b/src/thing"
    // from "packages/b imported ./thing" — it would reject every intra-package
    // relative import. The specifier is what carries the intent, and ESLint is
    // the tool that sees specifiers.

    // ----------------------------------------------------- supporting hygiene
    {
      name: 'no-orphans',
      comment: 'An unreferenced module is either dead code or a missing wiring.',
      severity: 'warn',
      from: {
        orphan: true,
        pathNot: [
          '\\.d\\.ts$',
          '(^|/)\\.[^/]+\\.(js|cjs|mjs|ts|json)$',
          '(^|/)(eslint|vitest|next|tailwind|postcss|prettier)\\.config\\.(js|cjs|mjs|ts)$',
          '(^|/)prisma/seed\\.ts$',
        ],
      },
      to: {},
    },
    {
      name: 'not-to-dev-dep',
      comment: 'Runtime code must not depend on a devDependency.',
      severity: 'error',
      from: { path: '^(apps|packages)/', pathNot: '\\.(test|spec)\\.tsx?$' },
      to: { dependencyTypes: ['npm-dev'], pathNot: '^node_modules/@types/' },
    },
    {
      name: 'no-non-package-json',
      comment: 'Every dependency must be declared in the importing package.json.',
      severity: 'error',
      from: {},
      to: { dependencyTypes: ['unknown', 'undetermined', 'npm-no-pkg', 'npm-unknown'] },
    },
  ],

  options: {
    doNotFollow: {
      path: 'node_modules',
      dependencyTypes: ['npm', 'npm-dev', 'npm-optional', 'npm-peer'],
    },
    // Tooling config and generated ambient declarations are not part of the
    // runtime dependency graph. Cruising them makes `no-non-package-json` fire
    // on `eslint.config.mjs -> @knowzy/eslint-config` (a devDependency that
    // resolves through a workspace symlink outside the cruised scope) and on
    // `next-env.d.ts -> next/image-types/global` (an ambient reference that
    // Next generates). Neither is a boundary question.
    exclude: {
      path: [
        '[.]test[.]tsx?$',
        '[.]spec[.]tsx?$',
        '/dist/',
        '/[.]next/',
        '/coverage/',
        '(^|/)eslint[.]config[.]mjs$',
        '(^|/)next-env[.]d[.]ts$',
        '(^|/)(vitest|next|tailwind|postcss|prettier)[.]config[.](js|cjs|mjs|ts)$',
      ].join('|'),
    },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'],
      mainFields: ['module', 'main', 'types'],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
