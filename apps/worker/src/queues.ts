import { Queue, Worker, type JobsOptions } from 'bullmq';
import { Redis } from 'ioredis';
import type { AppContext } from '@cle/api';
import { runMaintenancePass, type MaintenanceReport } from './maintenance.js';

export const MAINTENANCE_QUEUE = 'cle-maintenance';
export const MAINTENANCE_JOB = 'maintenance-pass';

export function createConnection(redisUrl: string): Redis {
  return new Redis(redisUrl, { maxRetriesPerRequest: null });
}

export interface WorkerHandle {
  queue: Queue;
  worker: Worker;
  close: () => Promise<void>;
}

/**
 * The queue exists so a pass never overlaps itself and so failures retry with
 * backoff; the work itself lives in runMaintenancePass, which is plain code and
 * can be run without Redis.
 */
export async function startMaintenanceWorker(ctx: AppContext, everyMs = 60_000): Promise<WorkerHandle> {
  const connection = createConnection(ctx.env.REDIS_URL);
  const queue = new Queue(MAINTENANCE_QUEUE, { connection });

  const repeatOptions: JobsOptions = {
    repeat: { every: everyMs },
    removeOnComplete: 50,
    removeOnFail: 200,
    attempts: 3,
    backoff: { type: 'exponential', delay: 5_000 },
  };
  await queue.add(MAINTENANCE_JOB, {}, repeatOptions);

  const worker = new Worker<unknown, MaintenanceReport>(
    MAINTENANCE_QUEUE,
    async () => runMaintenancePass(ctx),
    { connection: createConnection(ctx.env.REDIS_URL), concurrency: 1 },
  );

  return {
    queue,
    worker,
    close: async () => {
      await worker.close();
      await queue.close();
      connection.disconnect();
    },
  };
}
