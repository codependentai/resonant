import { describe, expect, it, vi } from 'vitest';

vi.mock('../config.js', () => ({
  getResonantConfig: vi.fn().mockReturnValue({
    identity: { companion_name: 'Echo', user_name: 'Jordan', timezone: 'UTC' },
    agent: { cwd: 'C:/resonant-v1' },
    integrations: { life_api_url: '', mind_cloud: { enabled: false, mcp_url: '' } },
    command_center: { enabled: false },
  }),
}));

vi.mock('../services/db.js', () => ({
  getActiveTriggers: vi.fn().mockReturnValue([{ kind: 'watcher' }, { kind: 'impulse' }]),
  getConfig: vi.fn().mockReturnValue(null),
  getMessages: vi.fn().mockReturnValue([
    {
      id: 'msg-1',
      role: 'companion',
      content: 'hello',
      metadata: { reactions: [{ emoji: 'heart', user: 'user' }] },
    },
  ]),
}));

import { buildOrientationContext } from './context-builder.js';
import type { RuntimeLifecycleContext } from './types.js';

describe('buildOrientationContext', () => {
  it('renders provider-neutral context for thread, presence, triggers, tools, and reactions', async () => {
    const ctx: RuntimeLifecycleContext = {
      threadId: 'thread-1',
      threadName: 'Today',
      threadType: 'daily',
      streamMsgId: 'stream-1',
      isAutonomous: false,
      registry: {
        broadcast: vi.fn(),
        getCount: vi.fn().mockReturnValue(1),
        isUserConnected: vi.fn().mockReturnValue(true),
        getUserPresenceState: vi.fn().mockReturnValue('active'),
        minutesSinceLastUserActivity: vi.fn().mockReturnValue(3),
        getUserDeviceType: vi.fn().mockReturnValue('desktop'),
      } as any,
      sessionId: null,
      platform: 'web',
      toolInsertions: [],
      getTextLength: () => 0,
    };

    const context = await buildOrientationContext(ctx, true);
    expect(context).toContain('Thread: "Today" (daily)');
    expect(context).toContain("Jordan's presence: active");
    expect(context).toContain('Active triggers: 1 watcher, 1 impulse');
    expect(context).toContain('CHAT TOOLS');
    expect(context).toContain('RECENT REACTIONS');
  });
});

