// The route registry.
//
// Every route the API exposes is listed here, and every entry carries a
// declared policy (access-control.md §4.3 P1). The completeness test in
// apps/api/test enumerates what Fastify actually registered and asserts it
// matches this list, so a route added without a policy fails the build rather
// than review.
//
// Milestones add to this array; nothing else registers routes.

import type { KnowzyRoute } from '../http/route.js';
import { generationRoutes } from './generation.js';
import { learningRoutes } from './learning.js';
import { reviewRoutes } from './review.js';
import { sourceRoutes } from './sources.js';
import { whoamiRoutes } from './whoami.js';

export const ALL_ROUTES: readonly KnowzyRoute[] = [
  ...whoamiRoutes,
  ...sourceRoutes,
  ...generationRoutes,
  ...reviewRoutes,
  ...learningRoutes,
];
