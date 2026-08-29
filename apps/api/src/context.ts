import { type Environment, platformAdminTelegramIds } from '@cle/config';
import { type AIProvider, HttpAIProvider, MockAIProvider } from '@cle/ai';
import { type PrismaClient, prisma as defaultPrisma } from '@cle/db';
import { FileMockTelegramClient, HttpTelegramClient, MockTelegramClient, type TelegramClient } from '@cle/telegram';
import { MockTonPayoutProvider, type TonPayoutProvider } from '@cle/ton';

export interface AppContext {
  env: Environment;
  prisma: PrismaClient;
  telegram: TelegramClient;
  ai: AIProvider;
  payouts: TonPayoutProvider;
  /** Injected so tests can freeze time. */
  now: () => Date;
  platformAdminTelegramIds: bigint[];
}

export interface BuildContextOptions {
  env: Environment;
  prisma?: PrismaClient;
  telegram?: TelegramClient;
  ai?: AIProvider;
  payouts?: TonPayoutProvider;
  now?: () => Date;
}

function buildTelegram(env: Environment): TelegramClient {
  if (env.APP_MODE === 'live' && env.TELEGRAM_BOT_TOKEN) return new HttpTelegramClient({ botToken: env.TELEGRAM_BOT_TOKEN });
  // In mock mode the API, worker, bot and seed script are separate processes;
  // a shared state file lets them see the same simulated Telegram world.
  return env.MOCK_TELEGRAM_STATE_FILE ? new FileMockTelegramClient(env.MOCK_TELEGRAM_STATE_FILE) : new MockTelegramClient();
}

function buildAi(env: Environment): AIProvider {
  if (env.AI_PROVIDER === 'mock' || !env.AI_API_KEY) return new MockAIProvider();
  return new HttpAIProvider({
    vendor: env.AI_PROVIDER,
    apiKey: env.AI_API_KEY,
    model: env.AI_MODEL ?? 'gpt-4o-mini',
    ...(env.AI_BASE_URL ? { baseUrl: env.AI_BASE_URL } : {}),
    referer: env.MINI_APP_URL,
  });
}

export function buildContext(options: BuildContextOptions): AppContext {
  const { env } = options;
  return {
    env,
    prisma: options.prisma ?? defaultPrisma,
    telegram: options.telegram ?? buildTelegram(env),
    ai: options.ai ?? buildAi(env),
    payouts: options.payouts ?? new MockTonPayoutProvider(env.TON_NETWORK),
    now: options.now ?? (() => new Date()),
    platformAdminTelegramIds: platformAdminTelegramIds(env),
  };
}
