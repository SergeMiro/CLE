import type { TelegramChat, TelegramChatMember, TelegramMessage, TelegramUpdate, TelegramUser } from './updates.js';

export class TelegramApiError extends Error {
  constructor(
    message: string,
    readonly method: string,
    readonly errorCode?: number,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

export interface InlineKeyboardButton {
  text: string;
  url?: string;
  web_app?: { url: string };
  callback_data?: string;
}

export interface SendMessageOptions {
  chatId: number | string;
  text: string;
  parseMode?: 'HTML' | 'MarkdownV2';
  disableWebPagePreview?: boolean;
  replyMarkup?: { inline_keyboard: InlineKeyboardButton[][] };
}

/** Everything CLE needs from the Bot API. Implemented once for HTTP and once in memory. */
export interface TelegramClient {
  getMe(): Promise<TelegramUser>;
  getChat(chatId: number | string): Promise<TelegramChat>;
  getChatMember(chatId: number | string, userId: number | bigint): Promise<TelegramChatMember>;
  getChatMemberCount(chatId: number | string): Promise<number>;
  sendMessage(options: SendMessageOptions): Promise<TelegramMessage>;
  setWebhook(url: string, secretToken: string, allowedUpdates: string[]): Promise<boolean>;
  deleteWebhook(): Promise<boolean>;
  answerCallbackQuery(callbackQueryId: string, text?: string): Promise<boolean>;
  /** Long polling, used for local development where no public HTTPS endpoint exists. */
  getUpdates(offset: number, timeoutSeconds: number, allowedUpdates: string[]): Promise<TelegramUpdate[]>;
}

interface TelegramResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
  parameters?: { retry_after?: number };
}

export interface HttpTelegramClientOptions {
  botToken: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class HttpTelegramClient implements TelegramClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: HttpTelegramClientOptions) {
    if (!options.botToken) throw new TelegramApiError('a bot token is required', 'constructor');
    this.baseUrl = options.baseUrl ?? 'https://api.telegram.org';
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  private async call<T>(method: string, payload: Record<string, unknown>, timeoutMs = this.timeoutMs): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/bot${this.options.botToken}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const body = (await response.json()) as TelegramResponse<T>;
      if (!body.ok || body.result === undefined) {
        throw new TelegramApiError(body.description ?? `${method} failed`, method, body.error_code, body.parameters?.retry_after);
      }
      return body.result;
    } catch (error) {
      if (error instanceof TelegramApiError) throw error;
      throw new TelegramApiError(error instanceof Error ? error.message : String(error), method);
    } finally {
      clearTimeout(timer);
    }
  }

  getMe(): Promise<TelegramUser> {
    return this.call<TelegramUser>('getMe', {});
  }

  getChat(chatId: number | string): Promise<TelegramChat> {
    return this.call<TelegramChat>('getChat', { chat_id: chatId });
  }

  getChatMember(chatId: number | string, userId: number | bigint): Promise<TelegramChatMember> {
    return this.call<TelegramChatMember>('getChatMember', { chat_id: chatId, user_id: Number(userId) });
  }

  getChatMemberCount(chatId: number | string): Promise<number> {
    return this.call<number>('getChatMemberCount', { chat_id: chatId });
  }

  sendMessage(options: SendMessageOptions): Promise<TelegramMessage> {
    return this.call<TelegramMessage>('sendMessage', {
      chat_id: options.chatId,
      text: options.text,
      ...(options.parseMode ? { parse_mode: options.parseMode } : {}),
      ...(options.disableWebPagePreview ? { link_preview_options: { is_disabled: true } } : {}),
      ...(options.replyMarkup ? { reply_markup: options.replyMarkup } : {}),
    });
  }

  setWebhook(url: string, secretToken: string, allowedUpdates: string[]): Promise<boolean> {
    return this.call<boolean>('setWebhook', {
      url,
      secret_token: secretToken,
      allowed_updates: allowedUpdates,
      drop_pending_updates: false,
    });
  }

  deleteWebhook(): Promise<boolean> {
    return this.call<boolean>('deleteWebhook', {});
  }

  answerCallbackQuery(callbackQueryId: string, text?: string): Promise<boolean> {
    return this.call<boolean>('answerCallbackQuery', { callback_query_id: callbackQueryId, ...(text ? { text } : {}) });
  }

  getUpdates(offset: number, timeoutSeconds: number, allowedUpdates: string[]): Promise<TelegramUpdate[]> {
    return this.call<TelegramUpdate[]>(
      'getUpdates',
      { offset, timeout: timeoutSeconds, allowed_updates: allowedUpdates },
      // Long polling holds the connection open for the whole timeout window.
      (timeoutSeconds + 10) * 1000,
    );
  }
}

export interface MockTelegramState {
  me: TelegramUser;
  chats: Map<string, TelegramChat>;
  members: Map<string, TelegramChatMember>;
  memberCounts: Map<string, number>;
  sent: SendMessageOptions[];
  webhook?: { url: string; secretToken: string; allowedUpdates: string[] };
  pendingUpdates: TelegramUpdate[];
}

/** In-memory Bot API for APP_MODE=mock, local development and tests. */
export class MockTelegramClient implements TelegramClient {
  readonly state: MockTelegramState;
  protected nextMessageId = 1000;

  constructor(overrides: Partial<MockTelegramState> = {}) {
    this.state = {
      me: overrides.me ?? { id: 777_000, is_bot: true, username: 'cle_mock_bot', first_name: 'CLE Mock' },
      chats: overrides.chats ?? new Map(),
      members: overrides.members ?? new Map(),
      memberCounts: overrides.memberCounts ?? new Map(),
      sent: overrides.sent ?? [],
      pendingUpdates: overrides.pendingUpdates ?? [],
      ...(overrides.webhook ? { webhook: overrides.webhook } : {}),
    };
  }

  private static key(chatId: number | string, userId: number | bigint): string {
    return `${chatId}:${userId}`;
  }

  setChat(chat: TelegramChat): void {
    this.state.chats.set(String(chat.id), chat);
    if (chat.username) this.state.chats.set(`@${chat.username}`, chat);
  }

  setMember(chatId: number | string, userId: number | bigint, member: TelegramChatMember): void {
    this.state.members.set(MockTelegramClient.key(chatId, userId), member);
  }

  setMemberCount(chatId: number | string, count: number): void {
    this.state.memberCounts.set(String(chatId), count);
  }

  async getMe(): Promise<TelegramUser> {
    return this.state.me;
  }

  async getChat(chatId: number | string): Promise<TelegramChat> {
    const chat = this.state.chats.get(String(chatId));
    if (!chat) throw new TelegramApiError('chat not found', 'getChat', 400);
    return chat;
  }

  async getChatMember(chatId: number | string, userId: number | bigint): Promise<TelegramChatMember> {
    return (
      this.state.members.get(MockTelegramClient.key(chatId, userId)) ?? {
        user: { id: Number(userId) },
        status: 'left',
      }
    );
  }

  async getChatMemberCount(chatId: number | string): Promise<number> {
    return this.state.memberCounts.get(String(chatId)) ?? 0;
  }

  async sendMessage(options: SendMessageOptions): Promise<TelegramMessage> {
    this.state.sent.push(options);
    this.nextMessageId += 1;
    return {
      message_id: this.nextMessageId,
      date: Math.floor(Date.now() / 1000),
      chat: this.state.chats.get(String(options.chatId)) ?? { id: Number(options.chatId) || 0, type: 'channel' },
      text: options.text,
    };
  }

  async setWebhook(url: string, secretToken: string, allowedUpdates: string[]): Promise<boolean> {
    this.state.webhook = { url, secretToken, allowedUpdates };
    return true;
  }

  async deleteWebhook(): Promise<boolean> {
    delete this.state.webhook;
    return true;
  }

  async answerCallbackQuery(): Promise<boolean> {
    return true;
  }

  async getUpdates(): Promise<TelegramUpdate[]> {
    return this.state.pendingUpdates.splice(0, this.state.pendingUpdates.length);
  }
}
