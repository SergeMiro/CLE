import { prisma } from '@cle/db';
import type { TelegramIdentity } from '@cle/telegram';
import { newReferralCode, type UserRecord, type UserRepository } from './auth.js';

export class PrismaUserRepository implements UserRepository {
  async upsertTelegramUser(identity: TelegramIdentity): Promise<UserRecord> {
    const data = {
      telegramUsername: identity.username ?? null,
      telegramFirstName: identity.firstName ?? null,
      telegramLastName: identity.lastName ?? null,
      lastSeenAt: new Date(),
    };
    return prisma.user.upsert({
      where: { telegramId: identity.id },
      create: { telegramId: identity.id, referralCode: newReferralCode(), ...data },
      update: data,
      select: { id: true, telegramId: true },
    });
  }
}
