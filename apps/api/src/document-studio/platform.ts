// AI Document Studio M3 -- this deployable's Studio configuration, on its own
// so `http/route.ts` can name it without importing route code (B9).
//
// Both values come from the DEPLOYMENT, never from a screen:
//
//   storageDir               DOCUMENT_STUDIO_STORAGE_DIR, or null
//   testPreparationEnabled   the flag documentStudio.testPreparation.enabled,
//                            whose ceiling is `local`: false in every other
//                            environment whatever is stored (§11.4)

import { resolveFlag } from '@knowzy/configuration';
import type { KnowzyEnv } from '@knowzy/shared-types';

export interface DocumentStudioPlatform {
  readonly storageDir: string | null;
  readonly testPreparationEnabled: boolean;
}

export const documentStudioPlatformFromEnv = (
  environment: KnowzyEnv,
  rawEnv: Readonly<Record<string, string | undefined>>,
): DocumentStudioPlatform => {
  const dir = rawEnv['DOCUMENT_STUDIO_STORAGE_DIR'] ?? '';
  return {
    storageDir: dir.startsWith('/') ? dir : null,
    testPreparationEnabled: resolveFlag('documentStudio.testPreparation.enabled', environment)
      .effective,
  };
};
