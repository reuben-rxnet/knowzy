import { knowzyConfig } from '@knowzy/eslint-config';

// kind: 'configuration' — this is the ONE package permitted to read
// process.env (repository-structure.md §5.2 C3).
export default knowzyConfig({ kind: 'configuration' });
