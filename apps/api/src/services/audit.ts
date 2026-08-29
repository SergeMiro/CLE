import { createHash } from 'node:crypto';
import type { AppContext } from '../context.js';

export interface AuditInput {
  actorType: 'USER' | 'SYSTEM' | 'TELEGRAM' | 'ADMIN';
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  ip?: string | undefined;
}

/** IP addresses are stored only as a salted hash, never in the clear. */
export function hashIp(ip: string | undefined, salt: string): string | undefined {
  return ip ? createHash('sha256').update(`${salt}:${ip}`).digest('hex').slice(0, 32) : undefined;
}

export async function recordAudit(ctx: AppContext, input: AuditInput): Promise<void> {
  await ctx.prisma.auditLog.create({
    data: {
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      before: (input.before ?? null) as never,
      after: (input.after ?? null) as never,
      ipHash: hashIp(input.ip, ctx.env.SESSION_SECRET) ?? null,
    },
  });
}
