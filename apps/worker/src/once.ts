import { loadEnvironment } from '@cle/config';
import { buildContext } from '@cle/api';
import { runMaintenancePass } from './maintenance.js';

/** Runs a single maintenance pass and exits; handy in cron, CI and manual testing. */
const ctx = buildContext({ env: loadEnvironment() });
const report = await runMaintenancePass(ctx);
console.log(JSON.stringify(report, null, 2));
await ctx.prisma.$disconnect();
process.exit(report.errors.length > 0 ? 1 : 0);
