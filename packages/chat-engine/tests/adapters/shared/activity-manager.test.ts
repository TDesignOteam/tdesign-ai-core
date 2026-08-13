import { beforeEach, describe, expect, it } from 'vitest';

import { AGUIEventType } from '../../../adapters/agui/types/events';
import { ActivityManagerImpl, activityManager } from '../../../adapters/shared/activity-manager';

describe('ActivityManagerImpl', () => {
  it('stores snapshots and tracks the current activity', () => {
    const manager = new ActivityManagerImpl();

    const result = manager.handleActivityEvent({
      type: AGUIEventType.ACTIVITY_SNAPSHOT,
      activityType: 'plan',
      messageId: 'message-1',
      content: { operations: [{ title: 'first' }] },
    });

    expect(result).toEqual({
      activityType: 'plan',
      messageId: 'message-1',
      content: { operations: [{ title: 'first' }] },
    });
    expect(manager.getCurrentActivityType()).toBe('plan');
    expect(manager.getCurrentActivity()).toBe(result);
    expect(manager.getActivity('plan')).toBe(result);
    expect(manager.getAllActivityTypes()).toEqual(['plan']);
  });

  it('applies deltas and reports newly appended operation indexes', () => {
    const manager = new ActivityManagerImpl();
    manager.handleActivityEvent({
      type: AGUIEventType.ACTIVITY_SNAPSHOT,
      activityType: 'plan',
      content: { operations: [{ title: 'first' }] },
    });

    const result = manager.handleActivityEvent({
      type: AGUIEventType.ACTIVITY_DELTA,
      activityType: 'plan',
      messageId: 'message-2',
      patch: [{ op: 'add', path: '/operations/-', value: { title: 'second' } }],
    });

    expect(result).toEqual({
      activityType: 'plan',
      messageId: 'message-2',
      content: { operations: [{ title: 'first' }, { title: 'second' }] },
      deltaInfo: { fromIndex: 1, toIndex: 2 },
    });
  });

  it('infers an array for a delta received before its snapshot', () => {
    const manager = new ActivityManagerImpl();

    const result = manager.handleActivityEvent({
      type: AGUIEventType.ACTIVITY_DELTA,
      activityType: 'chat',
      patch: [{ op: 'add', path: '/messages/0', value: { text: 'hello' } }],
    });

    expect(result).toEqual({
      activityType: 'chat',
      messageId: undefined,
      content: { messages: [{ text: 'hello' }] },
      deltaInfo: { fromIndex: 0, toIndex: 1 },
    });
  });

  it('ignores delta events without an activity type', () => {
    const manager = new ActivityManagerImpl();

    expect(manager.handleActivityEvent({ type: AGUIEventType.ACTIVITY_DELTA, patch: [] })).toBeNull();
    expect(manager.getAllActivityTypes()).toEqual([]);
  });

  it('clears all activity state', () => {
    const manager = new ActivityManagerImpl();
    manager.handleActivityEvent({ type: AGUIEventType.ACTIVITY_SNAPSHOT, activityType: 'plan', content: {} });

    manager.clear();

    expect(manager.getCurrentActivityType()).toBeNull();
    expect(manager.getCurrentActivity()).toBeNull();
    expect(manager.getActivity('plan')).toBeNull();
    expect(manager.getAllActivityTypes()).toEqual([]);
  });
});

describe('shared activityManager singleton', () => {
  beforeEach(() => activityManager.clear());

  it('is usable through the shared adapter export', () => {
    activityManager.handleActivityEvent({
      type: AGUIEventType.ACTIVITY_SNAPSHOT,
      activityType: 'shared',
      content: {},
    });

    expect(activityManager.getCurrentActivityType()).toBe('shared');
  });
});
