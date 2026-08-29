import { describe, expect, it, vi } from 'vitest';
import { HttpTelegramClient, TelegramApiError } from '../src/index.js';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
}

describe('HttpTelegramClient', () => {
  it('calls the Bot API with the token in the path and a JSON body', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true, result: { id: 1, is_bot: true, username: 'cle_bot' } }));
    const client = new HttpTelegramClient({ botToken: 'token', fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(client.getMe()).resolves.toMatchObject({ username: 'cle_bot' });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.telegram.org/bottoken/getMe');
    expect(init.method).toBe('POST');
  });

  it('surfaces a Telegram error with its code and retry hint', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ ok: false, description: 'Too Many Requests', error_code: 429, parameters: { retry_after: 7 } }),
    );
    const client = new HttpTelegramClient({ botToken: 'token', fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(client.sendMessage({ chatId: 1, text: 'hi' })).rejects.toMatchObject({
      errorCode: 429,
      retryAfterSeconds: 7,
      method: 'sendMessage',
    });
  });

  it('wraps a transport failure', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down');
    });
    const client = new HttpTelegramClient({ botToken: 'token', fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(client.getChat(1)).rejects.toBeInstanceOf(TelegramApiError);
  });

  it('requires a bot token', () => {
    expect(() => new HttpTelegramClient({ botToken: '' })).toThrow(TelegramApiError);
  });

  it('sends an inline keyboard when one is supplied', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true, result: { message_id: 5, date: 0, chat: { id: 1, type: 'channel' } } }));
    const client = new HttpTelegramClient({ botToken: 'token', fetchImpl: fetchImpl as unknown as typeof fetch });
    await client.sendMessage({
      chatId: -100,
      text: 'quiz',
      replyMarkup: { inline_keyboard: [[{ text: 'START QUIZ', url: 'https://t.me/cle_bot/app?startapp=q_x' }]] },
    });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({ reply_markup: { inline_keyboard: [[{ text: 'START QUIZ' }]] } });
  });
});
