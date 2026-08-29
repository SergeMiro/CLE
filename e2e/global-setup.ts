import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';

/**
 * Prepares an isolated world for the browser tests: its own database, its own
 * simulated Telegram state file, and a freshly seeded demo community.
 */
export default async function globalSetup(): Promise<void> {
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    APP_MODE: 'mock',
    LOG_LEVEL: 'silent',
    DATABASE_URL: process.env.E2E_DATABASE_URL ?? 'postgresql://cle:cle@localhost:5432/cle_e2e?schema=public',
    MOCK_TELEGRAM_STATE_FILE: '.cle/e2e-telegram.json',
    API_URL: 'http://localhost:4201',
    MINI_APP_URL: 'http://localhost:4200',
    PLATFORM_ADMIN_TELEGRAM_IDS: '111000900',
  };

  rmSync('.cle/e2e-telegram.json', { force: true });
  execFileSync('pnpm', ['--filter', '@cle/db', 'exec', 'prisma', 'migrate', 'deploy'], { env, stdio: 'inherit' });
  execFileSync('pnpm', ['--filter', '@cle/api', 'seed:demo', '--', '--reset'], { env, stdio: 'inherit' });
}
