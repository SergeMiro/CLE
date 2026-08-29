import { type AppContext, handleTelegramUpdate } from '@cle/api';
import type { TelegramUpdate } from '@cle/telegram';

/** Everything CLE needs to see. Anything else Telegram would send is not requested. */
export const ALLOWED_UPDATES = ['message', 'channel_post', 'edited_channel_post', 'my_chat_member', 'chat_member', 'callback_query'];

export interface PollingOptions {
  timeoutSeconds?: number;
  /** Stop after this many polls; omitted means run until stopped. */
  maxCycles?: number;
  onBatch?: (updates: TelegramUpdate[]) => void;
  signal?: AbortSignal;
}

/**
 * Long-polling bridge for local development: it feeds Telegram updates into
 * exactly the same handler the webhook route uses, so behaviour cannot drift
 * between the two transports.
 */
export async function runPolling(ctx: AppContext, options: PollingOptions = {}): Promise<number> {
  const timeoutSeconds = options.timeoutSeconds ?? 25;
  let offset = 0;
  let cycles = 0;
  let processed = 0;

  while (!options.signal?.aborted && (options.maxCycles === undefined || cycles < options.maxCycles)) {
    cycles += 1;
    let updates: TelegramUpdate[];
    try {
      updates = await ctx.telegram.getUpdates(offset, timeoutSeconds, ALLOWED_UPDATES);
    } catch (error) {
      console.error('[bot] getUpdates failed:', error instanceof Error ? error.message : error);
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      continue;
    }

    options.onBatch?.(updates);
    for (const update of updates) {
      offset = Math.max(offset, update.update_id + 1);
      try {
        const outcome = await handleTelegramUpdate(ctx, update);
        processed += 1;
        console.log(`[bot] ${outcome.kind} ${outcome.handled ? 'handled' : 'ignored'}${outcome.detail ? `: ${outcome.detail}` : ''}`);
      } catch (error) {
        console.error(`[bot] update ${update.update_id} failed:`, error instanceof Error ? error.message : error);
      }
    }
  }
  return processed;
}
