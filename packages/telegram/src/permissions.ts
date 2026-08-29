import type { TelegramChatMember } from './updates.js';

/** Without these the bot cannot run a community, so the channel is not ACTIVE. */
export const REQUIRED_BOT_PERMISSIONS = ['can_post_messages'] as const;
/** Missing these degrades features but does not stop monetization. */
export const RECOMMENDED_BOT_PERMISSIONS = ['can_edit_messages', 'can_delete_messages', 'can_invite_users'] as const;

export type BotPermission = (typeof REQUIRED_BOT_PERMISSIONS)[number] | (typeof RECOMMENDED_BOT_PERMISSIONS)[number];

export interface PermissionReport {
  isAdmin: boolean;
  granted: BotPermission[];
  missingRequired: BotPermission[];
  missingRecommended: BotPermission[];
  /** ACTIVE when everything required is present, DEGRADED when only extras are missing. */
  status: 'ACTIVE' | 'DEGRADED' | 'DISCONNECTED';
}

export function inspectBotPermissions(member: TelegramChatMember | undefined): PermissionReport {
  if (!member || (member.status !== 'administrator' && member.status !== 'creator')) {
    return {
      isAdmin: false,
      granted: [],
      missingRequired: [...REQUIRED_BOT_PERMISSIONS],
      missingRecommended: [...RECOMMENDED_BOT_PERMISSIONS],
      status: 'DISCONNECTED',
    };
  }
  const all = [...REQUIRED_BOT_PERMISSIONS, ...RECOMMENDED_BOT_PERMISSIONS] as BotPermission[];
  // A channel creator implicitly holds every right.
  const held = (permission: BotPermission): boolean => member.status === 'creator' || member[permission] === true;
  const granted = all.filter(held);
  const missingRequired = REQUIRED_BOT_PERMISSIONS.filter((permission) => !held(permission));
  const missingRecommended = RECOMMENDED_BOT_PERMISSIONS.filter((permission) => !held(permission));
  return {
    isAdmin: true,
    granted,
    missingRequired: [...missingRequired],
    missingRecommended: [...missingRecommended],
    status: missingRequired.length > 0 ? 'DEGRADED' : 'ACTIVE',
  };
}
