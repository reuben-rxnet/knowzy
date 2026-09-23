import { knowzyConfig } from '@knowzy/eslint-config';

// `e2e`: the acceptance harness drives the product from outside. It is not
// deployed, so C3 (process.env only in @knowzy/configuration) is relaxed for
// the stack URLs and the browser channel -- and only for those, since nothing
// else here reads the environment.
export default knowzyConfig({ kind: 'e2e' });
