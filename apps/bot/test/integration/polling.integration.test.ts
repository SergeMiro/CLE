import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CHANNEL_CHAT_ID, type BotHarness, createBotHarness, seedCommunity } from '../harness.js';
import { ALLOWED_UPDATES, runPolling } from '../../src/polling.js';

describe('Telegram long polling bridge', () => {
  let harness: BotHarness;

  beforeEach(async () => {
    harness = await createBotHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  it('requests exactly the update types CLE handles', () => {
    expect(ALLOWED_UPDATES).toEqual(['message', 'channel_post', 'edited_channel_post', 'my_chat_member', 'chat_member', 'callback_query']);
  });

  it('feeds a polled membership update through the same handler as the webhook', async () => {
    const seeded = await seedCommunity(harness);
    harness.telegram.state.pendingUpdates.push({
      update_id: 10,
      chat_member: {
        chat: { id: CHANNEL_CHAT_ID, type: 'channel' },
        from: { id: 800_002 },
        date: Math.floor(new Date('2026-09-01T12:00:00Z').getTime() / 1000),
        old_chat_member: { user: { id: 800_002 }, status: 'left' },
        new_chat_member: { user: { id: 800_002, username: 'polled_member' }, status: 'member' },
      },
    });

    const processed = await runPolling(harness.ctx, { maxCycles: 1, timeoutSeconds: 0 });
    expect(processed).toBe(1);

    const member = await harness.prisma.communityMember.findFirstOrThrow({
      where: { communityId: seeded.community.id },
      include: { user: true },
    });
    expect(member.status).toBe('ACTIVE');
    expect(member.user.telegramUsername).toBe('polled_member');
  });

  it('answers a /start deep link with a Mini App button', async () => {
    await seedCommunity(harness);
    harness.telegram.state.pendingUpdates.push({
      update_id: 11,
      message: {
        message_id: 1,
        date: Math.floor(Date.now() / 1000),
        chat: { id: 800_003, type: 'private' },
        from: { id: 800_003, username: 'newcomer' },
        text: '/start',
      },
    });

    await runPolling(harness.ctx, { maxCycles: 1, timeoutSeconds: 0 });
    const reply = harness.telegram.state.sent.at(-1);
    expect(reply?.chatId).toBe(800_003);
    expect(reply?.replyMarkup?.inline_keyboard[0]?.[0]?.text).toBe('Open CLE');
  });

  it('advances the offset so an update is never processed twice', async () => {
    await seedCommunity(harness);
    const batches: number[][] = [];
    harness.telegram.state.pendingUpdates.push({
      update_id: 20,
      message: { message_id: 1, date: 0, chat: { id: 800_004, type: 'private' }, from: { id: 800_004 }, text: '/start' },
    });

    await runPolling(harness.ctx, {
      maxCycles: 2,
      timeoutSeconds: 0,
      onBatch: (updates) => batches.push(updates.map((update) => update.update_id)),
    });
    expect(batches).toEqual([[20], []]);
    expect(await harness.prisma.webhookEvent.count()).toBe(1);
  });

  it('keeps polling when one update throws', async () => {
    await seedCommunity(harness);
    harness.telegram.state.pendingUpdates.push(
      // A channel post for a chat CLE does not know is ignored, not fatal.
      { update_id: 30, channel_post: { message_id: 1, date: 0, chat: { id: -1009999999, type: 'channel' }, text: 'hello' } },
      { update_id: 31, message: { message_id: 2, date: 0, chat: { id: 800_005, type: 'private' }, from: { id: 800_005 }, text: '/start' } },
    );
    const processed = await runPolling(harness.ctx, { maxCycles: 1, timeoutSeconds: 0 });
    expect(processed).toBe(2);
    expect(harness.telegram.state.sent.at(-1)?.chatId).toBe(800_005);
  });
});
