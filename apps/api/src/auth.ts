import { randomBytes } from 'node:crypto';
import { TelegramInitDataError, verifyTelegramInitData, type TelegramIdentity } from '@cle/telegram';

export interface UserRecord { id: string; telegramId: bigint; }
export interface UserRepository { upsertTelegramUser(identity: TelegramIdentity): Promise<UserRecord>; }
export interface ReplayStore { consume(key: string, ttlSeconds: number): Promise<boolean>; }

export class InMemoryReplayStore implements ReplayStore {
  private readonly values = new Map<string, number>();
  async consume(key: string, ttlSeconds: number): Promise<boolean> {
    const now = Date.now();
    for (const [stored, expiresAt] of this.values) if (expiresAt <= now) this.values.delete(stored);
    if (this.values.has(key)) return false;
    this.values.set(key, now + ttlSeconds * 1000);
    return true;
  }
}

export interface TelegramAuthServiceOptions { botToken: string; users: UserRepository; replays: ReplayStore; now?: () => Date; }
export class TelegramAuthService {
  constructor(private readonly options: TelegramAuthServiceOptions) {}
  async authenticate(initData: string): Promise<UserRecord> {
    const verified = verifyTelegramInitData(initData, this.options.botToken, this.options.now?.());
    if (!(await this.options.replays.consume(verified.replayKey, 3600))) throw new TelegramInitDataError('initData replay detected');
    return this.options.users.upsertTelegramUser(verified.identity);
  }
}

export function newReferralCode(): string { return randomBytes(9).toString('base64url'); }

