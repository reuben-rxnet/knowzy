import { knowzyConfig } from '@knowzy/eslint-config';

// kind: 'database' — adds C6 (no ambient clock) and relaxes C4 for the
// migration tooling that legitimately issues raw SQL.
export default knowzyConfig({ kind: 'database' });
