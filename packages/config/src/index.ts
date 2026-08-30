import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';

const BPS_TOTAL = 10_000;

const bps = z.coerce.number().int().min(0).max(BPS_TOTAL);

export const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_MODE: z.enum(['mock', 'live']).default('mock'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  API_PORT: z.coerce.number().int().positive().default(4101),
  MINIAPP_PORT: z.coerce.number().int().positive().default(4100),
  API_URL: z.string().url(),
  MINI_APP_URL: z.string().url(),

  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_BOT_USERNAME: z.string().optional(),
  TELEGRAM_BOT_ID: z.coerce.bigint().optional(),
  /** Short name of a named Mini App (/newapp). Leave unset when the bot has a Main Mini App. */
  TELEGRAM_MINI_APP_NAME: z.string().regex(/^[A-Za-z0-9_]{3,30}$/).optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
  /** APP_MODE=mock only: JSON file holding the simulated Telegram world, shared between processes. */
  MOCK_TELEGRAM_STATE_FILE: z.string().optional(),

  TON_NETWORK: z.enum(['mainnet', 'testnet']).default('testnet'),
  TON_RPC_URL: z.string().url().optional(),
  TON_API_KEY: z.string().optional(),
  TON_TREASURY_ADDRESS: z.string().optional(),
  TON_TREASURY_MNEMONIC: z.string().optional(),

  SESSION_SECRET: z.string().min(32),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().max(720).default(12),
  PLATFORM_ADMIN_TELEGRAM_IDS: z.string().default(''),
  /** Requests per minute per IP for the general API surface. */
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(240),
  /** Sign-ins per minute per IP. Kept separate: many users can share one address behind NAT. */
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(60),

  PLATFORM_FEE_BPS: bps.default(1000),
  MAX_CREATOR_SHARE_BPS: bps.default(1000),
  DEFAULT_GROWTH_BPS: bps.default(3500),
  DEFAULT_LOYALTY_BPS: bps.default(4000),
  DEFAULT_REFERRAL_BPS: bps.default(1500),
  DEFAULT_LEARNING_BPS: bps.default(1000),
  MIN_WITHDRAWAL_NANOTON: z.coerce.bigint().nonnegative().default(100_000_000n),
  MAX_QUIZZES_PER_DAY: z.coerce.number().int().positive().default(3),
  REFERRAL_QUALIFICATION_DAYS: z.coerce.number().int().nonnegative().default(30),
  NEW_MEMBER_HOLD_DAYS: z.coerce.number().int().nonnegative().default(7),
  REJOIN_COOLDOWN_DAYS: z.coerce.number().int().nonnegative().default(7),

  /** Where uploaded ad creatives are written. Backed by a Docker volume in production. */
  UPLOAD_DIR: z.string().default('.cle/uploads'),
  /** Largest creative accepted, in bytes. A 46px strip needs far less than this. */
  UPLOAD_MAX_BYTES: z.coerce.number().int().positive().max(10_000_000).default(512_000),

  AI_PROVIDER: z.enum(['mock', 'openrouter', 'gemini', 'anthropic', 'openai-compatible']).default('mock'),
  AI_MODEL: z.string().optional(),
  AI_API_KEY: z.string().optional(),
  AI_BASE_URL: z.string().url().optional(),
  AI_QUALITY_THRESHOLD: z.coerce.number().int().min(0).max(100).default(70),
});

export type Environment = z.infer<typeof environmentSchema>;

export class ConfigurationError extends Error {}

/** Empty strings in a .env file mean "unset", not "set to an empty value". */
function dropBlanks(input: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const output: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && value.trim() !== '') output[key] = value;
  }
  return output;
}

export function parseEnvironment(input: NodeJS.ProcessEnv = process.env): Environment {
  const result = environmentSchema.safeParse(dropBlanks(input));
  if (!result.success) throw new ConfigurationError(`Invalid environment: ${z.prettifyError(result.error)}`);
  const env = result.data;

  const poolTotal = env.DEFAULT_GROWTH_BPS + env.DEFAULT_LOYALTY_BPS + env.DEFAULT_REFERRAL_BPS + env.DEFAULT_LEARNING_BPS;
  if (poolTotal !== BPS_TOTAL) {
    throw new ConfigurationError(`Default reward pool shares must total ${BPS_TOTAL} bps, received ${poolTotal}`);
  }
  if (env.PLATFORM_FEE_BPS + env.MAX_CREATOR_SHARE_BPS > BPS_TOTAL) {
    throw new ConfigurationError('PLATFORM_FEE_BPS + MAX_CREATOR_SHARE_BPS cannot exceed 10000 bps');
  }
  if (env.APP_MODE === 'live') {
    const missing = [
      ['TELEGRAM_BOT_TOKEN', env.TELEGRAM_BOT_TOKEN],
      ['TELEGRAM_BOT_USERNAME', env.TELEGRAM_BOT_USERNAME],
      ['TELEGRAM_WEBHOOK_SECRET', env.TELEGRAM_WEBHOOK_SECRET],
    ].filter(([, value]) => !value).map(([key]) => key);
    if (missing.length > 0) throw new ConfigurationError(`live mode requires ${missing.join(', ')}`);
  }
  if (env.AI_PROVIDER !== 'mock' && !env.AI_API_KEY) {
    throw new ConfigurationError(`AI_PROVIDER=${env.AI_PROVIDER} requires AI_API_KEY`);
  }
  return env;
}

export function platformAdminTelegramIds(env: Environment): bigint[] {
  return env.PLATFORM_ADMIN_TELEGRAM_IDS.split(',')
    .map((value) => value.trim())
    .filter((value) => /^\d+$/.test(value))
    .map((value) => BigInt(value));
}

/** Bootstrap values for the first PlatformPolicy row; the database is authoritative afterwards. */
export function bootstrapPlatformPolicy(env: Environment) {
  return {
    platformFeeBps: env.PLATFORM_FEE_BPS,
    maxCreatorShareBps: env.MAX_CREATOR_SHARE_BPS,
    minWithdrawalNanoton: env.MIN_WITHDRAWAL_NANOTON,
    maxQuizzesPerDay: env.MAX_QUIZZES_PER_DAY,
    allowedPoolTypes: ['GROWTH', 'LOYALTY', 'REFERRAL', 'LEARNING'] as const,
    defaultPools: {
      growthBps: env.DEFAULT_GROWTH_BPS,
      loyaltyBps: env.DEFAULT_LOYALTY_BPS,
      referralBps: env.DEFAULT_REFERRAL_BPS,
      learningBps: env.DEFAULT_LEARNING_BPS,
    },
    defaultRewardTiming: {
      newMemberHoldDays: env.NEW_MEMBER_HOLD_DAYS,
      rejoinCooldownDays: env.REJOIN_COOLDOWN_DAYS,
      referralQualificationDays: env.REFERRAL_QUALIFICATION_DAYS,
    },
  };
}

/**
 * Loads the nearest .env into process.env without overwriting anything already
 * set. Every entry point calls loadEnvironment(), so no service can start with
 * half a configuration just because it was launched from the wrong directory.
 */
export function loadDotEnv(startDirectory = process.cwd()): string | undefined {
  let directory = resolve(startDirectory);
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = resolve(directory, '.env');
    if (existsSync(candidate)) {
      try {
        process.loadEnvFile(candidate);
      } catch {
        return undefined;
      }
      return candidate;
    }
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return undefined;
}

export function loadEnvironment(): Environment {
  loadDotEnv();
  return parseEnvironment(process.env);
}
