// Root config. Each workspace package has its own eslint.config.mjs declaring
// its `kind`, which selects the content rules that apply to it
// (repository-structure.md §5.2). This root config covers loose files only.

import { knowzyConfig } from '@knowzy/eslint-config';

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/coverage/**',
      'packages/shared-types/generated/**',
      'docs/**',
    ],
  },
  ...knowzyConfig({ kind: 'library' }),
];
