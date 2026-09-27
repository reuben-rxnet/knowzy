// The five capabilities the administration screen shows, mapped from the
// catalogue's own names. One mapping, here, so the screen and any report read
// the same words for the same declaration.

import type { DeclaredCapabilities } from '@knowzy/shared-types';
import type { ProviderCapabilities } from './provider.js';

export const declaredCapabilities = (capabilities: ProviderCapabilities): DeclaredCapabilities => ({
  supportsGeneration: capabilities.supportsGeneration,
  supportsCostReporting: capabilities.reportsCost,
  supportsTokenReporting: capabilities.reportsTokenUsage,
  supportsStreaming: capabilities.supportsStreaming,
  retrievalFree: capabilities.retrievalFree,
});
