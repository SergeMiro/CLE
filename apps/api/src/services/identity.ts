import { createHash, randomBytes, randomInt } from 'node:crypto';
import type { User } from '@cle/db';
import { TelegramInitDataError, type TelegramIdentity, verifyTelegramInitData } from '@cle/telegram';
import type { AppContext } from '../context.js';
import { unauthorized } from '../errors.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Deep-link safe: no underscore (the payload separator) and no lookalike characters. */
export function newReferralCode(length = 10): string {
  let code = '';
  for (let index = 0; index < length; index += 1) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface IssuedSession {
  token: string;
  expiresAt: Date;
}

/** The raw token is returned once; only its hash is stored, so a database leak cannot impersonate anyone. */
export async function issueSession(
  ctx: AppContext,
  userId: string,
  meta: { userAgent?: string | undefined; ipHash?: string | undefined } = {},
): Promise<IssuedSession> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(ctx.now().getTime() + ctx.env.SESSION_TTL_HOURS * 3_600_000);
  await ctx.prisma.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      issuedAt: ctx.now(),
      expiresAt,
      userAgent: meta.userAgent ?? null,
      ipHash: meta.ipHash ?? null,
    },
  });
  return { token, expiresAt };
}

export async function resolveSession(ctx: AppContext, token: string): Promise<User | undefined> {
  const session = await ctx.prisma.session.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
  if (!session || session.revokedAt || session.expiresAt <= ctx.now()) return undefined;
  if (session.user.status === 'BANNED') return undefined;
  return session.user;
}

export async function revokeSession(ctx: AppContext, token: string): Promise<void> {
  await ctx.prisma.session.updateMany({ where: { tokenHash: hashToken(token) }, data: { revokedAt: ctx.now() } });
}

const MOCK_INIT_DATA = /^mock:(\d+)(?::([A-Za-z0-9_]{1,32}))?$/;

/**
 * Verifies Telegram's signed initData: HMAC against the bot token, plus a
 * freshness window on auth_date. The payload is deliberately not consumed
 * one-time — Telegram hands the same initData to every reload of a Mini App
 * session, so a single-use rule would lock people out on a refresh.
 *
 * In APP_MODE=mock a "mock:<telegramId>" string is accepted instead, so the
 * whole product can be exercised locally without a bot token. The shortcut is
 * unreachable in live mode.
 */
export function verifyIdentity(ctx: AppContext, initData: string): TelegramIdentity {
  if (ctx.env.APP_MODE === 'mock') {
    const match = MOCK_INIT_DATA.exec(initData.trim());
    if (match) {
      return {
        id: BigInt(match[1] ?? '0'),
        ...(match[2] ? { username: match[2], firstName: match[2] } : { firstName: `Tester ${match[1]}` }),
      };
    }
  }
  if (!ctx.env.TELEGRAM_BOT_TOKEN) throw unauthorized('Telegram authentication is not configured on this server');
  try {
    return verifyTelegramInitData(initData, ctx.env.TELEGRAM_BOT_TOKEN, ctx.now()).identity;
  } catch (error) {
    throw error instanceof TelegramInitDataError ? unauthorized(error.message) : error;
  }
}

/**
 * Records the identity Telegram signed. The profile is written verbatim,
 * including cleared fields: signed initData is the current truth about a person,
 * so a username they have removed must disappear here too.
 */
export async function upsertTelegramUser(ctx: AppContext, identity: TelegramIdentity): Promise<User> {
  const isPlatformAdmin = ctx.platformAdminTelegramIds.some((id) => id === identity.id);
  const shared = {
    telegramUsername: identity.username ?? null,
    telegramFirstName: identity.firstName ?? null,
    telegramLastName: identity.lastName ?? null,
    lastSeenAt: ctx.now(),
  };
  return ctx.prisma.user.upsert({
    where: { telegramId: identity.id },
    // A platform admin listed in configuration is promoted on sight, but never demoted here.
    update: isPlatformAdmin ? { ...shared, isPlatformAdmin: true } : shared,
    create: { telegramId: identity.id, referralCode: newReferralCode(), isPlatformAdmin, ...shared },
  });
}

/**
 * Finds or creates a user from a bare Telegram id, for callers that have no
 * profile to write — operator scripts and Telegram updates that carry only an
 * id. It must never blank out a profile that a real sign-in already recorded.
 */
export async function ensureTelegramUser(ctx: AppContext, telegramId: bigint): Promise<User> {
  const isPlatformAdmin = ctx.platformAdminTelegramIds.some((id) => id === telegramId);
  const existing = await ctx.prisma.user.findUnique({ where: { telegramId } });
  if (existing) {
    return isPlatformAdmin && !existing.isPlatformAdmin
      ? ctx.prisma.user.update({ where: { id: existing.id }, data: { isPlatformAdmin: true } })
      : existing;
  }
  return ctx.prisma.user.create({ data: { telegramId, referralCode: newReferralCode(), isPlatformAdmin } });
}
