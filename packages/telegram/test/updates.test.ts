import { describe, expect, it } from 'vitest';
import { MockTelegramClient, isActiveMembership, isBanned, messageText, messageUrl, updateKind } from '../src/index.js';

describe('update helpers', () => {
  it('classifies membership statuses', () => {
    expect(isActiveMembership({ status: 'member' })).toBe(true);
    expect(isActiveMembership({ status: 'creator' })).toBe(true);
    expect(isActiveMembership({ status: 'left' })).toBe(false);
    expect(isBanned({ status: 'kicked' })).toBe(true);
  });

  it('prefers text and falls back to a caption', () => {
    expect(messageText({ message_id: 1, date: 0, chat: { id: 1, type: 'channel' }, caption: 'photo caption' })).toBe('photo caption');
    expect(messageText({ message_id: 1, date: 0, chat: { id: 1, type: 'channel' }, text: 'body' })).toBe('body');
  });

  it('builds a public permalink for a public channel', () => {
    expect(messageUrl({ id: -1001234567890, type: 'channel', username: 'sciencedaily' }, 42)).toBe('https://t.me/sciencedaily/42');
  });

  it('builds an internal permalink for a private channel', () => {
    expect(messageUrl({ id: -1001234567890, type: 'channel' }, 42)).toBe('https://t.me/c/1234567890/42');
  });

  it('returns no permalink for a plain chat id', () => {
    expect(messageUrl({ id: 5, type: 'private' }, 1)).toBeUndefined();
  });

  it('names the update kind', () => {
    expect(updateKind({ update_id: 1, channel_post: { message_id: 1, date: 0, chat: { id: 1, type: 'channel' } } })).toBe('channel_post');
    expect(updateKind({ update_id: 1 })).toBe('unknown');
  });
});

describe('MockTelegramClient', () => {
  it('records sent messages and returns a message id', async () => {
    const client = new MockTelegramClient();
    client.setChat({ id: -100123, type: 'channel', title: 'Science Daily', username: 'sciencedaily' });
    const message = await client.sendMessage({ chatId: -100123, text: 'TEST YOUR KNOWLEDGE' });
    expect(message.message_id).toBeGreaterThan(0);
    expect(client.state.sent).toHaveLength(1);
  });

  it('defaults an unknown member to "left"', async () => {
    const client = new MockTelegramClient();
    expect((await client.getChatMember(-100123, 7)).status).toBe('left');
  });

  it('stores a configured member and count', async () => {
    const client = new MockTelegramClient();
    client.setMember(-100123, 7, { user: { id: 7 }, status: 'member' });
    client.setMemberCount(-100123, 51);
    expect((await client.getChatMember(-100123, 7)).status).toBe('member');
    expect(await client.getChatMemberCount(-100123)).toBe(51);
  });

  it('records the webhook registration', async () => {
    const client = new MockTelegramClient();
    await client.setWebhook('https://cle.example/telegram', 'secret', ['channel_post']);
    expect(client.state.webhook).toEqual({ url: 'https://cle.example/telegram', secretToken: 'secret', allowedUpdates: ['channel_post'] });
    await client.deleteWebhook();
    expect(client.state.webhook).toBeUndefined();
  });
});
