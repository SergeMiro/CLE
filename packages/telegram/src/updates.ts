/** Minimal structural types for the Telegram updates CLE actually consumes. */
export interface TelegramUser {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface TelegramChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
  title?: string;
  username?: string;
  description?: string;
}

export interface TelegramMessage {
  message_id: number;
  date: number;
  chat: TelegramChat;
  from?: TelegramUser;
  sender_chat?: TelegramChat;
  text?: string;
  caption?: string;
  entities?: unknown[];
  photo?: unknown[];
  video?: unknown;
  document?: unknown;
}

export interface TelegramChatMember {
  user: TelegramUser;
  status: 'creator' | 'administrator' | 'member' | 'restricted' | 'left' | 'kicked';
  can_post_messages?: boolean;
  can_edit_messages?: boolean;
  can_delete_messages?: boolean;
  can_invite_users?: boolean;
  can_manage_chat?: boolean;
  can_restrict_members?: boolean;
}

export interface TelegramChatMemberUpdated {
  chat: TelegramChat;
  from: TelegramUser;
  date: number;
  old_chat_member: TelegramChatMember;
  new_chat_member: TelegramChatMember;
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  data?: string;
  message?: TelegramMessage;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  channel_post?: TelegramMessage;
  edited_channel_post?: TelegramMessage;
  my_chat_member?: TelegramChatMemberUpdated;
  chat_member?: TelegramChatMemberUpdated;
  callback_query?: TelegramCallbackQuery;
}

const ACTIVE_STATUSES = new Set(['creator', 'administrator', 'member', 'restricted']);

/** "In the channel" for reward purposes: present and not restricted out of it. */
export function isActiveMembership(member: Pick<TelegramChatMember, 'status'>): boolean {
  return ACTIVE_STATUSES.has(member.status);
}

export function isBanned(member: Pick<TelegramChatMember, 'status'>): boolean {
  return member.status === 'kicked';
}

export function messageText(message: TelegramMessage): string {
  return message.text ?? message.caption ?? '';
}

/** Public permalink for a post; private channels have no public URL. */
export function messageUrl(chat: TelegramChat, messageId: number): string | undefined {
  if (chat.username) return `https://t.me/${chat.username}/${messageId}`;
  // -100xxxxxxxxxx supergroup/channel ids expose the internal id after the -100 prefix.
  const raw = String(chat.id);
  return raw.startsWith('-100') ? `https://t.me/c/${raw.slice(4)}/${messageId}` : undefined;
}

export function updateKind(update: TelegramUpdate): string {
  if (update.channel_post) return 'channel_post';
  if (update.edited_channel_post) return 'edited_channel_post';
  if (update.my_chat_member) return 'my_chat_member';
  if (update.chat_member) return 'chat_member';
  if (update.callback_query) return 'callback_query';
  if (update.message) return 'message';
  if (update.edited_message) return 'edited_message';
  return 'unknown';
}
