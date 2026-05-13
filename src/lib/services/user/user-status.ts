import { eq } from 'drizzle-orm';

import { ForbiddenError } from '@/lib/_core/errors';
import { withSystemContext } from '@/lib/db';
import { userProfiles } from '@/lib/db/schema';

export type AccountAccessStatus = 'active' | 'suspended' | 'deleted';

export async function getUserAccountAccessStatus(userId: string): Promise<AccountAccessStatus> {
  return withSystemContext(async (database) => {
    const profile = await database.query.userProfiles.findFirst({
      where: eq(userProfiles.userId, userId),
      columns: {
        deletedAt: true,
        status: true,
      },
    });

    if (profile?.deletedAt) {
      return 'deleted';
    }

    if (profile?.status === 'suspended') {
      return 'suspended';
    }

    return 'active';
  });
}

export async function assertUserAccountActive(userId: string): Promise<void> {
  const status = await getUserAccountAccessStatus(userId);

  if (status === 'suspended') {
    throw new ForbiddenError('Account suspended. Contact an administrator.', {
      userId,
      accountStatus: status,
    });
  }

  if (status === 'deleted') {
    throw new ForbiddenError('Account deleted. Contact an administrator.', {
      userId,
      accountStatus: status,
    });
  }
}
