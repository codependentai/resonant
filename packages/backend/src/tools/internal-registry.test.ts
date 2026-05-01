import { describe, expect, it, vi } from 'vitest';

vi.mock('../services/db.js', () => ({
  listPendingTimers: vi.fn().mockReturnValue([
    { id: 'timer-1', label: 'Tea', fire_at: '2026-04-25T18:00:00.000Z', context: 'kettle' },
  ]),
  createTimer: vi.fn((params) => ({
    ...params,
    fire_at: params.fireAt,
    thread_id: params.threadId,
  })),
  cancelTimer: vi.fn((id: string) => id === 'timer-1'),
  getThread: vi.fn((id: string) => id === 'thread-1' ? { id } : null),
}));

import {
  ALL_INTERNAL_TOOLS,
  COMMAND_CENTER_TOOL_NAMES,
  executeInternalTool,
  getInternalTool,
} from './internal-registry.js';

describe('internal tool registry', () => {
  it('contains the first provider-neutral tool groups', () => {
    expect(getInternalTool('timer.list')).toBeTruthy();
    expect(getInternalTool('share.file')).toBeTruthy();
    expect(getInternalTool('canvas.create')).toBeTruthy();
    expect(getInternalTool('semantic.search')).toBeTruthy();
    expect(getInternalTool('telegram.send')).toBeTruthy();
  });

  it('registers Command Center MCP tools as registry metadata', () => {
    for (const name of COMMAND_CENTER_TOOL_NAMES) {
      expect(ALL_INTERNAL_TOOLS.some(tool => tool.name === name)).toBe(true);
    }
  });

  it('executes timer.list without shelling out through sc.mjs', async () => {
    const result = await executeInternalTool('timer.list', {}, { threadId: 'thread-1' });
    expect(result.ok).toBe(true);
    expect(result.text).toContain('Tea');
  });

  it('returns model-visible errors for unsupported registered tools', async () => {
    const result = await executeInternalTool('share.file', { path: '/tmp/a.txt' }, { threadId: 'thread-1' });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('unsupported_registry_handler');
    expect(result.text).toContain('compatibility sc.mjs');
  });
});
