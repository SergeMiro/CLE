import { loadEnvironment } from '@cle/config';
import { createApi } from './app.js';
import { buildContext } from './context.js';

const env = loadEnvironment();
const ctx = buildContext({ env });
const app = await createApi({ ctx });

await app.listen({ port: env.API_PORT, host: '0.0.0.0' });
app.log.info(`CLE API listening on ${env.API_PORT} in ${env.APP_MODE} mode`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    app.log.info(`${signal} received, shutting down`);
    await app.close();
    await ctx.prisma.$disconnect();
    process.exit(0);
  });
}
