import { loadEnvironment } from '@cle/config';
import { buildContext } from '@cle/api';
import { startMaintenanceWorker } from './queues.js';

const env = loadEnvironment();
const ctx = buildContext({ env });
const handle = await startMaintenanceWorker(ctx);

handle.worker.on('completed', (job, report) => {
  console.log(`[worker] pass ${job.id} finished`, report);
});
handle.worker.on('failed', (job, error) => {
  console.error(`[worker] pass ${job?.id} failed`, error);
});
console.log(`[worker] CLE maintenance worker started in ${env.APP_MODE} mode`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    console.log(`[worker] ${signal} received, shutting down`);
    await handle.close();
    await ctx.prisma.$disconnect();
    process.exit(0);
  });
}
