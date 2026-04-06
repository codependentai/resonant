import { describe, it, expect } from 'vitest';
import { evaluateConditions, type TriggerContext } from './triggers.js';
import type { TriggerCondition } from './db.js';

function makeContext(overrides: Partial<TriggerContext> = {}): TriggerContext {
  return {
    presenceNow: 'active',
    presencePrev: 'idle',
    agentFree: true,
    statusText: '',
    hour: 12,
    minute: 0,
    ...overrides,
  };
}

describe('evaluateConditions', () => {
  it('returns true for empty conditions', () => {
    expect(evaluateConditions([], makeContext())).toBe(true);
  });

  it('returns false for unknown condition type', () => {
    const conditions = [{ type: 'unknown_type' }] as unknown as TriggerCondition[];
    expect(evaluateConditions(conditions, makeContext())).toBe(false);
  });

  describe('presence_state', () => {
    it('matches current presence', () => {
      const conditions: TriggerCondition[] = [{ type: 'presence_state', state: 'active' }];
      expect(evaluateConditions(conditions, makeContext({ presenceNow: 'active' }))).toBe(true);
    });

    it('rejects non-matching presence', () => {
      const conditions: TriggerCondition[] = [{ type: 'presence_state', state: 'offline' }];
      expect(evaluateConditions(conditions, makeContext({ presenceNow: 'active' }))).toBe(false);
    });
  });

  describe('presence_transition', () => {
    it('matches from → to transition', () => {
      const conditions: TriggerCondition[] = [{ type: 'presence_transition', from: 'idle', to: 'active' }];
      expect(evaluateConditions(conditions, makeContext({ presencePrev: 'idle', presenceNow: 'active' }))).toBe(true);
    });

    it('rejects wrong from state', () => {
      const conditions: TriggerCondition[] = [{ type: 'presence_transition', from: 'offline', to: 'active' }];
      expect(evaluateConditions(conditions, makeContext({ presencePrev: 'idle', presenceNow: 'active' }))).toBe(false);
    });

    it('rejects wrong to state', () => {
      const conditions: TriggerCondition[] = [{ type: 'presence_transition', from: 'idle', to: 'offline' }];
      expect(evaluateConditions(conditions, makeContext({ presencePrev: 'idle', presenceNow: 'active' }))).toBe(false);
    });
  });

  describe('agent_free', () => {
    it('returns true when agent is free', () => {
      const conditions: TriggerCondition[] = [{ type: 'agent_free' }];
      expect(evaluateConditions(conditions, makeContext({ agentFree: true }))).toBe(true);
    });

    it('returns false when agent is busy', () => {
      const conditions: TriggerCondition[] = [{ type: 'agent_free' }];
      expect(evaluateConditions(conditions, makeContext({ agentFree: false }))).toBe(false);
    });
  });

  describe('time_window', () => {
    it('matches time within normal window', () => {
      const conditions: TriggerCondition[] = [{ type: 'time_window', after: '09:00', before: '17:00' }];
      expect(evaluateConditions(conditions, makeContext({ hour: 12, minute: 0 }))).toBe(true);
    });

    it('rejects time outside normal window', () => {
      const conditions: TriggerCondition[] = [{ type: 'time_window', after: '09:00', before: '17:00' }];
      expect(evaluateConditions(conditions, makeContext({ hour: 20, minute: 0 }))).toBe(false);
    });

    it('matches at exact start of window', () => {
      const conditions: TriggerCondition[] = [{ type: 'time_window', after: '09:00', before: '17:00' }];
      expect(evaluateConditions(conditions, makeContext({ hour: 9, minute: 0 }))).toBe(true);
    });

    it('rejects at exact end of window (exclusive)', () => {
      const conditions: TriggerCondition[] = [{ type: 'time_window', after: '09:00', before: '17:00' }];
      expect(evaluateConditions(conditions, makeContext({ hour: 17, minute: 0 }))).toBe(false);
    });

    it('handles overnight window (22:00 to 06:00)', () => {
      const conditions: TriggerCondition[] = [{ type: 'time_window', after: '22:00', before: '06:00' }];
      // 23:00 should match
      expect(evaluateConditions(conditions, makeContext({ hour: 23, minute: 0 }))).toBe(true);
      // 02:00 should match
      expect(evaluateConditions(conditions, makeContext({ hour: 2, minute: 0 }))).toBe(true);
      // 12:00 should not match
      expect(evaluateConditions(conditions, makeContext({ hour: 12, minute: 0 }))).toBe(false);
    });

    it('handles open-ended window (after only, no before)', () => {
      const conditions: TriggerCondition[] = [{ type: 'time_window', after: '18:00' }];
      expect(evaluateConditions(conditions, makeContext({ hour: 20, minute: 0 }))).toBe(true);
      expect(evaluateConditions(conditions, makeContext({ hour: 10, minute: 0 }))).toBe(false);
    });

    it('returns false for invalid time strings', () => {
      const conditions: TriggerCondition[] = [{ type: 'time_window', after: 'invalid', before: '17:00' }];
      expect(evaluateConditions(conditions, makeContext())).toBe(false);
    });

    it('returns false when before is invalid', () => {
      const conditions: TriggerCondition[] = [{ type: 'time_window', after: '09:00', before: 'nope' }];
      expect(evaluateConditions(conditions, makeContext())).toBe(false);
    });

    it('returns false for out-of-range hours (25:00)', () => {
      const conditions: TriggerCondition[] = [{ type: 'time_window', after: '25:00', before: '17:00' }];
      expect(evaluateConditions(conditions, makeContext())).toBe(false);
    });

    it('returns false for out-of-range minutes (12:60)', () => {
      const conditions: TriggerCondition[] = [{ type: 'time_window', after: '12:60' }];
      expect(evaluateConditions(conditions, makeContext())).toBe(false);
    });
  });

  describe('routine_missing', () => {
    it('detects missing routine in status text', () => {
      const conditions: TriggerCondition[] = [{ type: 'routine_missing', routine: 'shower', after_hour: 10 }];
      const ctx = makeContext({ statusText: 'shower: no', hour: 14 });
      expect(evaluateConditions(conditions, ctx)).toBe(true);
    });

    it('returns false when routine is done', () => {
      const conditions: TriggerCondition[] = [{ type: 'routine_missing', routine: 'shower', after_hour: 10 }];
      const ctx = makeContext({ statusText: 'shower: yes', hour: 14 });
      expect(evaluateConditions(conditions, ctx)).toBe(false);
    });

    it('returns false before after_hour', () => {
      const conditions: TriggerCondition[] = [{ type: 'routine_missing', routine: 'shower', after_hour: 10 }];
      const ctx = makeContext({ statusText: 'shower: no', hour: 8 });
      expect(evaluateConditions(conditions, ctx)).toBe(false);
    });

    it('returns false with empty statusText', () => {
      const conditions: TriggerCondition[] = [{ type: 'routine_missing', routine: 'shower', after_hour: 10 }];
      const ctx = makeContext({ statusText: '', hour: 14 });
      expect(evaluateConditions(conditions, ctx)).toBe(false);
    });

    it('is case-insensitive', () => {
      const conditions: TriggerCondition[] = [{ type: 'routine_missing', routine: 'Shower', after_hour: 10 }];
      const ctx = makeContext({ statusText: 'shower: No', hour: 14 });
      expect(evaluateConditions(conditions, ctx)).toBe(true);
    });
  });

  describe('multiple conditions (AND logic)', () => {
    it('requires all conditions to pass', () => {
      const conditions: TriggerCondition[] = [
        { type: 'presence_state', state: 'active' },
        { type: 'agent_free' },
        { type: 'time_window', after: '09:00', before: '17:00' },
      ];
      expect(evaluateConditions(conditions, makeContext({ presenceNow: 'active', agentFree: true, hour: 12 }))).toBe(true);
    });

    it('fails if any condition fails', () => {
      const conditions: TriggerCondition[] = [
        { type: 'presence_state', state: 'active' },
        { type: 'agent_free' },
      ];
      expect(evaluateConditions(conditions, makeContext({ presenceNow: 'active', agentFree: false }))).toBe(false);
    });
  });
});
