// Authoring Role Simplification (2026-10-07, access-control.md §2.0), against
// a real database: a grant on an INACTIVE role confers no permission, and the
// seeded catalogue has exactly two active roles.
//
// It creates one throwaway user, grants it a retired role, reads its effective
// access through both identity reads, and deletes the user and grant
// afterwards.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readProcessEnv } from '@knowzy/configuration';
import { FixedClock } from '@knowzy/observability';
import { PrismaClient } from '@prisma/client';
import { subjectLookupRepository, userRepository } from '../src/index.js';

const connectionString = readProcessEnv()['DATABASE_URL'];
const describeDb = connectionString ? describe : describe.skip;
const prisma = new PrismaClient(
  connectionString ? { datasources: { db: { url: connectionString } } } : undefined,
);

const suffix = Date.now().toString(36);
const UPN = `role-activation-${suffix}@local.invalid`;

describeDb('role activation', () => {
  let userId = '';

  beforeAll(async () => {
    await prisma.$connect();
    const user = await prisma.user.create({
      data: {
        entraObjectId: `test-role-activation-${suffix}`,
        userPrincipalName: UPN,
        displayName: 'Role activation test user',
        status: 'ACTIVE',
        authoringPortalAccess: true,
        livePortalAccess: false,
        timeZone: 'UTC',
      },
    });
    userId = user.id;
    const approver = await prisma.role.findUniqueOrThrow({ where: { key: 'APPROVER' } });
    await prisma.userRole.create({
      data: { userId, roleId: approver.id, grantedByUserId: userId, reason: 'test' },
    });
  });

  afterAll(async () => {
    if (userId !== '') {
      await prisma.userRole.deleteMany({ where: { userId } });
      await prisma.user.delete({ where: { id: userId } });
    }
    await prisma.$disconnect();
  });

  it('seeds exactly two active roles, and keeps the others defined', async () => {
    const roles = await prisma.role.findMany({ select: { key: true, isActive: true } });
    expect(
      roles
        .filter((role) => role.isActive)
        .map((role) => role.key)
        .sort(),
    ).toEqual(['KNOWZY_ADMINISTRATOR', 'LEARNER']);
    expect(roles.length).toBeGreaterThan(2);
  });

  it('a grant on an inactive role confers no permission, in either identity read', async () => {
    const access = await userRepository(prisma, new FixedClock(new Date())).resolveEffectiveAccess(
      userId,
    );
    expect(access?.roles).toEqual([]);
    expect(access?.permissions).toEqual([]);

    const subject = await subjectLookupRepository(prisma).byIdentifier(UPN);
    expect(subject?.permissions ?? []).toEqual([]);
  });
});
