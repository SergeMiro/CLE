import { z } from 'zod';

const mode = z.enum(['development', 'test', 'production']).default('development');
const appMode = z.enum(['mock', 'live']).default('mock');

export const environmentSchema = z.object({
  NODE_ENV: mode,
  APP_MODE: appMode,
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_BOT_USERNAME: z.string().optional(),
  TELEGRAM_CHANNEL_ID: z.string().optional(),
  TELEGRAM_CHANNEL_USERNAME: z.string().optional(),
  TELEGRAM_API_ID: z.string().optional(),
  TELEGRAM_API_HASH: z.string().optional(),
  MINI_APP_URL: z.string().url(),
  API_URL: z.string().url(),
  TON_NETWORK: z.enum(['mainnet', 'testnet']).default('testnet'),
  TON_RPC_URL: z.string().url().optional(),
  TON_TREASURY_ADDRESS: z.string().optional(),
  TON_TREASURY_SECRET: z.string().min(32).optional(),
  SESSION_SECRET: z.string().min(32),
  ADMIN_TELEGRAM_IDS: z.string().default(''),
  REWARD_CREATOR_PERCENT: z.coerce.number().int().min(0).max(100).default(10),
  GROWTH_POOL_PERCENT: z.coerce.number().int().min(0).max(100).default(35),
  LOYALTY_POOL_PERCENT: z.coerce.number().int().min(0).max(100).default(40),
  REFERRAL_POOL_PERCENT: z.coerce.number().int().min(0).max(100).default(15),
  SCIENCE_POOL_PERCENT: z.coerce.number().int().min(0).max(100).default(10),
  MIN_WITHDRAWAL_NANOTON: z.coerce.bigint().nonnegative(),
  MAX_QUIZZES_PER_DAY: z.coerce.number().int().positive().default(3),
  REFERRAL_QUALIFICATION_DAYS: z.coerce.number().int().nonnegative().default(30),
  NEW_MEMBER_HOLD_DAYS: z.coerce.number().int().nonnegative().default(7),
  REJOIN_COOLDOWN_DAYS: z.coerce.number().int().nonnegative().default(7),
});

export type Environment = z.infer<typeof environmentSchema>;

export function parseEnvironment(input: NodeJS.ProcessEnv = process.env): Environment {
  const result = environmentSchema.safeParse(input);
  if (!result.success) throw new Error(`Invalid environment: ${z.prettifyError(result.error)}`);
  const values = result.data;
  const poolTotal = values.GROWTH_POOL_PERCENT + values.LOYALTY_POOL_PERCENT + values.REFERRAL_POOL_PERCENT + values.SCIENCE_POOL_PERCENT;
  if (poolTotal !== 100) throw new Error('GROWTH_POOL_PERCENT + LOYALTY_POOL_PERCENT + REFERRAL_POOL_PERCENT + SCIENCE_POOL_PERCENT must equal 100');
  if (values.APP_MODE === 'live' && (!values.TELEGRAM_BOT_TOKEN || !values.TELEGRAM_CHANNEL_ID || !values.TON_RPC_URL || !values.TON_TREASURY_ADDRESS)) {
    throw new Error('live mode requires Telegram channel and TON treasury configuration');
  }
  return values;
}

