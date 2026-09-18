// The authenticated subject.
//
// Lives here rather than in @knowzy/authentication or @knowzy/authorization
// because both need it and neither should depend on the other: authentication
// produces a Subject, authorization consumes one. shared-types is the root of
// the graph (B7), so this is the only place both can reach.
//
// ADR-011: roles and permissions on a Subject are resolved from the Knowzy
// database, never from a token's group claims. A Subject built from claims
// alone is a bug, not an optimisation.

import { z } from 'zod';
import { UserStatusSchema } from './enums.js';
import { PermissionKeySchema } from './permissions.js';

export const SubjectSchema = z.object({
  userId: z.string().uuid(),
  /** Entra `oid`, or a stub identifier in local development. */
  entraObjectId: z.string(),
  displayName: z.string(),

  roles: z.array(z.string()),
  permissions: z.array(PermissionKeySchema),
  status: UserStatusSchema,

  authoringPortalAccess: z.boolean(),
  livePortalAccess: z.boolean(),

  /** Empty sets mean UNRESTRICTED on that dimension — access-control.md §5. */
  domainIds: z.array(z.string().uuid()),
  teamIds: z.array(z.string().uuid()),
  allowSourceIds: z.array(z.string().uuid()),
  denySourceIds: z.array(z.string().uuid()),
});

export type Subject = z.infer<typeof SubjectSchema>;
