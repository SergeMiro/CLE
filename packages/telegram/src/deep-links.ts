export class DeepLinkError extends Error {}

export type StartPayload =
  | { kind: 'community'; communityId: string }
  | { kind: 'quiz'; quizId: string }
  | { kind: 'referral'; referralCode: string; communityId?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// '_' separates the fields of a payload, so it cannot appear inside a referral code.
const CODE = /^[A-Za-z0-9-]{1,24}$/;

function compact(uuid: string): string {
  if (!UUID.test(uuid)) throw new DeepLinkError(`"${uuid}" is not a UUID`);
  return uuid.replace(/-/g, '');
}

function expand(hex: string): string {
  if (!/^[0-9a-f]{32}$/i.test(hex)) throw new DeepLinkError('malformed identifier in start payload');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`.toLowerCase();
}

/**
 * Telegram start payloads allow only A-Z a-z 0-9 _ - and 64 characters, so ids
 * travel as compacted hex with a single-letter tag.
 */
export function encodeStartPayload(payload: StartPayload): string {
  switch (payload.kind) {
    case 'community':
      return `c_${compact(payload.communityId)}`;
    case 'quiz':
      return `q_${compact(payload.quizId)}`;
    case 'referral': {
      if (!CODE.test(payload.referralCode)) throw new DeepLinkError('referral code has unsupported characters');
      return payload.communityId ? `r_${payload.referralCode}_${compact(payload.communityId)}` : `r_${payload.referralCode}`;
    }
  }
}

export function decodeStartPayload(raw: string): StartPayload | undefined {
  if (!raw || raw.length > 64 || !/^[A-Za-z0-9_-]+$/.test(raw)) return undefined;
  const [tag, ...rest] = raw.split('_');
  try {
    if (tag === 'c' && rest.length === 1) return { kind: 'community', communityId: expand(rest[0] ?? '') };
    if (tag === 'q' && rest.length === 1) return { kind: 'quiz', quizId: expand(rest[0] ?? '') };
    if (tag === 'r' && rest.length === 1) return { kind: 'referral', referralCode: rest[0] ?? '' };
    if (tag === 'r' && rest.length === 2) {
      return { kind: 'referral', referralCode: rest[0] ?? '', communityId: expand(rest[1] ?? '') };
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export interface MiniAppLinkOptions {
  botUsername: string;
  /** Direct Mini App short name, when the app is published as t.me/<bot>/<app>. */
  appName?: string;
  payload?: StartPayload;
}

export function miniAppLink({ botUsername, appName, payload }: MiniAppLinkOptions): string {
  const bot = botUsername.replace(/^@/, '');
  const encoded = payload ? encodeStartPayload(payload) : undefined;
  if (appName) return `https://t.me/${bot}/${appName}${encoded ? `?startapp=${encoded}` : ''}`;
  return `https://t.me/${bot}${encoded ? `?start=${encoded}` : ''}`;
}
