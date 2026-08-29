import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AppContext } from '../context.js';
import { unauthorized } from '../errors.js';
import { hashIp } from '../services/audit.js';
import { resolveSession } from '../services/identity.js';
import type { Actor } from '../services/rbac.js';

declare module 'fastify' {
  interface FastifyRequest {
    actor?: Actor;
    sessionToken?: string;
  }
}

function bearerToken(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  if (header?.toLowerCase().startsWith('bearer ')) return header.slice(7).trim();
  const custom = request.headers['x-cle-session'];
  return typeof custom === 'string' && custom.trim() !== '' ? custom.trim() : undefined;
}

/** Attaches the actor when a valid session token is present; never rejects on its own. */
export function registerAuth(app: FastifyInstance, ctx: AppContext): void {
  app.addHook('preHandler', async (request) => {
    const token = bearerToken(request);
    if (!token) return;
    const user = await resolveSession(ctx, token);
    if (!user) return;
    request.actor = { id: user.id, isPlatformAdmin: user.isPlatformAdmin };
    request.sessionToken = token;
  });
}

export function requireActor(request: FastifyRequest): Actor {
  if (!request.actor) throw unauthorized();
  return request.actor;
}

export function requestIpHash(request: FastifyRequest, secret: string): string | undefined {
  return hashIp(request.ip, secret);
}
