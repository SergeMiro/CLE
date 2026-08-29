import { parseEnvironment } from '@cle/config';
import { createApi } from './app.js';
import { InMemoryReplayStore, TelegramAuthService } from './auth.js';
import { PrismaUserRepository } from './repositories.js';

const env = parseEnvironment();
const api = await createApi({ auth: new TelegramAuthService({ botToken: env.TELEGRAM_BOT_TOKEN ?? '', users: new PrismaUserRepository(), replays: new InMemoryReplayStore() }), sessionSecret: env.SESSION_SECRET, production: env.NODE_ENV === 'production' });
await api.listen({ port: 3001, host: '0.0.0.0' });
