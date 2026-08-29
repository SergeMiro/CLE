import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { MockTelegramClient, type MockTelegramState, type SendMessageOptions } from './bot-api.js';
import type { TelegramChat, TelegramChatMember, TelegramMessage, TelegramUpdate, TelegramUser } from './updates.js';

interface SerializedState {
  me: TelegramUser;
  chats: [string, TelegramChat][];
  members: [string, TelegramChatMember][];
  memberCounts: [string, number][];
  sent: SendMessageOptions[];
  pendingUpdates: TelegramUpdate[];
  webhook?: { url: string; secretToken: string; allowedUpdates: string[] };
}

/**
 * A mock Telegram world shared between processes through one JSON file.
 *
 * In APP_MODE=mock the API, the worker, the bot and the demo seed each run in
 * their own process; without a shared file, a channel created by one of them
 * would be invisible to the others. This exists purely for local development
 * and is never constructed in live mode.
 */
export class FileMockTelegramClient extends MockTelegramClient {
  constructor(private readonly path: string) {
    super();
    this.load();
  }

  private load(): void {
    if (!existsSync(this.path)) return;
    try {
      const raw = JSON.parse(readFileSync(this.path, 'utf8')) as SerializedState;
      this.state.me = raw.me ?? this.state.me;
      this.state.chats = new Map(raw.chats ?? []);
      this.state.members = new Map(raw.members ?? []);
      this.state.memberCounts = new Map(raw.memberCounts ?? []);
      this.state.sent = raw.sent ?? [];
      this.state.pendingUpdates = raw.pendingUpdates ?? [];
      if (raw.webhook) this.state.webhook = raw.webhook;
    } catch {
      // A corrupt development file should not stop the process; start clean.
    }
  }

  private save(): void {
    const serialized: SerializedState = {
      me: this.state.me,
      chats: [...this.state.chats.entries()],
      members: [...this.state.members.entries()],
      memberCounts: [...this.state.memberCounts.entries()],
      sent: this.state.sent.slice(-100),
      pendingUpdates: this.state.pendingUpdates,
      ...(this.state.webhook ? { webhook: this.state.webhook } : {}),
    };
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(serialized, null, 2));
  }

  override setChat(chat: TelegramChat): void {
    this.load();
    super.setChat(chat);
    this.save();
  }

  override setMember(chatId: number | string, userId: number | bigint, member: TelegramChatMember): void {
    this.load();
    super.setMember(chatId, userId, member);
    this.save();
  }

  override setMemberCount(chatId: number | string, count: number): void {
    this.load();
    super.setMemberCount(chatId, count);
    this.save();
  }

  override async getChat(chatId: number | string): Promise<TelegramChat> {
    this.load();
    return super.getChat(chatId);
  }

  override async getChatMember(chatId: number | string, userId: number | bigint): Promise<TelegramChatMember> {
    this.load();
    return super.getChatMember(chatId, userId);
  }

  override async getChatMemberCount(chatId: number | string): Promise<number> {
    this.load();
    return super.getChatMemberCount(chatId);
  }

  override async sendMessage(options: SendMessageOptions): Promise<TelegramMessage> {
    this.load();
    const message = await super.sendMessage(options);
    this.save();
    return message;
  }

  override async getUpdates(): Promise<TelegramUpdate[]> {
    this.load();
    const updates = await super.getUpdates();
    if (updates.length > 0) this.save();
    return updates;
  }

  /** Queues an update for the polling bridge to pick up, as Telegram would. */
  enqueue(update: TelegramUpdate): void {
    this.load();
    this.state.pendingUpdates.push(update);
    this.save();
  }

  snapshot(): MockTelegramState {
    this.load();
    return this.state;
  }
}
