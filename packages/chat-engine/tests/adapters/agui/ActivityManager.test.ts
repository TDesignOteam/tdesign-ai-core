import { describe, expect, it } from 'vitest';

import { ActivityManagerImpl } from '../../../adapters/agui/ActivityManager';
import { AGUIEventType } from '../../../adapters/agui/types/events';

describe('ActivityManagerImpl', () => {
  it('stores independent activity snapshots and tracks the latest type', () => {
    const manager = new ActivityManagerImpl();
    manager.handleActivityEvent({
      type: AGUIEventType.ACTIVITY_SNAPSHOT,
      activityType: 'plan',
      content: { operations: ['a'] },
    });
    manager.handleActivityEvent({
      type: AGUIEventType.ACTIVITY_SNAPSHOT,
      activityType: 'trace',
      content: { messages: [] },
    });

    expect(manager.getAllActivityTypes()).toEqual(['plan', 'trace']);
    expect(manager.getActivity('plan')?.content).toEqual({ operations: ['a'] });
    expect(manager.getCurrentActivityType()).toBe('trace');
  });

  it('applies patches and reports newly appended operation ranges', () => {
    const manager = new ActivityManagerImpl();
    manager.handleActivityEvent({
      type: AGUIEventType.ACTIVITY_SNAPSHOT,
      activityType: 'plan',
      content: { operations: ['a'] },
    });
    const updated = manager.handleActivityEvent({
      type: AGUIEventType.ACTIVITY_DELTA,
      activityType: 'plan',
      patch: [{ op: 'add', path: '/operations/-', value: 'b' }],
    });

    expect(updated).toMatchObject({
      content: { operations: ['a', 'b'] },
      deltaInfo: { fromIndex: 1, toIndex: 2 },
    });
  });

  it('infers an array root for a delta arriving before a snapshot', () => {
    const manager = new ActivityManagerImpl();
    const activity = manager.handleActivityEvent({
      type: AGUIEventType.ACTIVITY_DELTA,
      activityType: 'log',
      patch: [{ op: 'add', path: '/messages/0', value: 'first' }],
    });
    expect(activity?.content).toEqual({ messages: ['first'] });
    expect(activity?.deltaInfo).toEqual({ fromIndex: 0, toIndex: 1 });
  });

  it('ignores untyped deltas and clears all activity state', () => {
    const manager = new ActivityManagerImpl();
    expect(manager.handleActivityEvent({ type: AGUIEventType.ACTIVITY_DELTA, patch: [] })).toBeNull();
    manager.handleActivityEvent({ type: AGUIEventType.ACTIVITY_SNAPSHOT, activityType: 'x', content: {} });
    manager.clear();
    expect(manager.getCurrentActivity()).toBeNull();
    expect(manager.getAllActivityTypes()).toEqual([]);
  });
});
