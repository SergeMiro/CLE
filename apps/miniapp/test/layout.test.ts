import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/*
 * The root layout hands the browser this deployment's settings — API address,
 * app mode, TON network, bot username. They are read from the environment at
 * request time, which only holds if the layout is never prerendered: a static
 * build bakes in the build container's environment, and a live deployment then
 * tells the browser it is in mock mode on testnet.
 */
describe('the root layout', () => {
  const source = readFileSync(new URL('../app/layout.tsx', import.meta.url), 'utf8');

  it('is rendered per request, not baked at build time', () => {
    expect(source).toMatch(/export const dynamic = 'force-dynamic'/);
  });

  it('reads the deployment settings from the environment', () => {
    for (const variable of ['API_URL', 'APP_MODE', 'TON_NETWORK', 'TELEGRAM_BOT_USERNAME']) {
      expect(source).toContain(`process.env.${variable}`);
    }
  });
});
