import { defineConfig, devices } from '@playwright/test';

const DATABASE_URL = process.env.E2E_DATABASE_URL ?? 'postgresql://cle:cle@localhost:5432/cle_e2e?schema=public';

const serverEnv = {
  NODE_ENV: 'test',
  APP_MODE: 'mock',
  LOG_LEVEL: 'silent',
  DATABASE_URL,
  REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6380',
  MOCK_TELEGRAM_STATE_FILE: '.cle/e2e-telegram.json',
  SESSION_SECRET: 'e2e-session-secret-that-is-long-enough-000',
  MIN_WITHDRAWAL_NANOTON: '100000000',
  PLATFORM_ADMIN_TELEGRAM_IDS: '111000900',
  // Every browser test hits the API from the same address; the production
  // default would throttle the suite rather than the traffic it is meant to stop.
  RATE_LIMIT_MAX: '10000',
  AUTH_RATE_LIMIT_MAX: '10000',
  TELEGRAM_BOT_USERNAME: 'cle_e2e_bot',
  API_PORT: '4201',
  MINIAPP_PORT: '4200',
  API_URL: 'http://localhost:4201',
  MINI_APP_URL: 'http://localhost:4200',
};

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: 'http://localhost:4200',
    trace: 'retain-on-failure',
    ...devices['iPhone 13'],
  },
  webServer: [
    {
      command: 'pnpm --filter @cle/api dev',
      url: 'http://localhost:4201/health',
      reuseExistingServer: false,
      timeout: 60_000,
      env: serverEnv,
    },
    {
      command: 'pnpm --filter @cle/miniapp dev',
      url: 'http://localhost:4200',
      reuseExistingServer: false,
      timeout: 120_000,
      env: serverEnv,
    },
  ],
});
