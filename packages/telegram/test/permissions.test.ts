import { describe, expect, it } from 'vitest';
import { inspectBotPermissions } from '../src/index.js';

const bot = { id: 1, is_bot: true };

describe('inspectBotPermissions', () => {
  it('reports DISCONNECTED when the bot is not an administrator', () => {
    const report = inspectBotPermissions({ user: bot, status: 'member' });
    expect(report.status).toBe('DISCONNECTED');
    expect(report.isAdmin).toBe(false);
    expect(report.missingRequired).toContain('can_post_messages');
  });

  it('reports DISCONNECTED when the bot is absent entirely', () => {
    expect(inspectBotPermissions(undefined).status).toBe('DISCONNECTED');
  });

  it('reports ACTIVE when every required right is granted', () => {
    const report = inspectBotPermissions({
      user: bot,
      status: 'administrator',
      can_post_messages: true,
      can_edit_messages: true,
      can_delete_messages: true,
      can_invite_users: true,
    });
    expect(report.status).toBe('ACTIVE');
    expect(report.missingRequired).toHaveLength(0);
    expect(report.missingRecommended).toHaveLength(0);
  });

  it('reports DEGRADED when the creator revokes posting rights', () => {
    const report = inspectBotPermissions({ user: bot, status: 'administrator', can_invite_users: true });
    expect(report.status).toBe('DEGRADED');
    expect(report.missingRequired).toEqual(['can_post_messages']);
    expect(report.granted).toEqual(['can_invite_users']);
  });

  it('treats a creator as holding every right', () => {
    expect(inspectBotPermissions({ user: bot, status: 'creator' }).status).toBe('ACTIVE');
  });

  it('stays ACTIVE while only recommended rights are missing', () => {
    const report = inspectBotPermissions({ user: bot, status: 'administrator', can_post_messages: true });
    expect(report.status).toBe('ACTIVE');
    expect(report.missingRecommended.length).toBeGreaterThan(0);
  });
});
