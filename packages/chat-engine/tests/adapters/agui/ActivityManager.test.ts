import { describe, expect, it } from 'vitest';

import { ActivityManagerImpl } from '../../../adapters/agui/ActivityManager';
import { AGUIEventType } from '../../../adapters/agui/types/events';

describe('ActivityManagerImpl', () => {
  it('存储独立的活动快照并跟踪最新类型', () => {
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

  it('应用补丁并报告新追加的操作范围', () => {
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

  it('为先于快照到达的增量推断数组根节点', () => {
    const manager = new ActivityManagerImpl();
    const activity = manager.handleActivityEvent({
      type: AGUIEventType.ACTIVITY_DELTA,
      activityType: 'log',
      patch: [{ op: 'add', path: '/messages/0', value: 'first' }],
    });
    expect(activity?.content).toEqual({ messages: ['first'] });
    expect(activity?.deltaInfo).toEqual({ fromIndex: 0, toIndex: 1 });
  });

  it('忽略无类型的增量并清空全部活动状态', () => {
    const manager = new ActivityManagerImpl();
    expect(manager.handleActivityEvent({ type: AGUIEventType.ACTIVITY_DELTA, patch: [] })).toBeNull();
    manager.handleActivityEvent({ type: AGUIEventType.ACTIVITY_SNAPSHOT, activityType: 'x', content: {} });
    manager.clear();
    expect(manager.getCurrentActivity()).toBeNull();
    expect(manager.getAllActivityTypes()).toEqual([]);
  });

  it('相同 activityType 的不同 messageId 维护独立实例', () => {
    const manager = new ActivityManagerImpl();
    manager.handleActivityEvent({
      type: AGUIEventType.ACTIVITY_SNAPSHOT,
      activityType: 'plan',
      messageId: 'm1',
      content: { operations: ['a'] },
    });
    manager.handleActivityEvent({
      type: AGUIEventType.ACTIVITY_SNAPSHOT,
      activityType: 'plan',
      messageId: 'm2',
      content: { operations: ['x'] },
    });

    expect(manager.getActivity('plan', 'm1')?.content).toEqual({ operations: ['a'] });
    expect(manager.getActivity('plan', 'm2')?.content).toEqual({ operations: ['x'] });
    expect(manager.getAllActivityTypes()).toEqual(['plan']);
    expect(manager.getCurrentActivity()).toMatchObject({ messageId: 'm2' });
  });

  it('无 messageId 的增量回退到最近实例并保持 key 稳定', () => {
    const manager = new ActivityManagerImpl();
    manager.handleActivityEvent({
      type: AGUIEventType.ACTIVITY_SNAPSHOT,
      activityType: 'plan',
      messageId: 'm1',
      content: { operations: ['a'] },
    });

    const updated = manager.handleActivityEvent({
      type: AGUIEventType.ACTIVITY_DELTA,
      activityType: 'plan',
      patch: [{ op: 'add', path: '/operations/-', value: 'b' }],
    });

    expect(updated).toMatchObject({ messageId: 'm1', content: { operations: ['a', 'b'] } });
    expect(manager.getActivity('plan', 'm1')?.content).toEqual({ operations: ['a', 'b'] });
    expect(manager.getActivity('plan')?.content).toEqual({ operations: ['a', 'b'] });
  });

  it('带 messageId 的增量不影响其他实例的内容', () => {
    const manager = new ActivityManagerImpl();
    manager.handleActivityEvent({
      type: AGUIEventType.ACTIVITY_SNAPSHOT,
      activityType: 'plan',
      messageId: 'm1',
      content: { operations: ['a'] },
    });
    manager.handleActivityEvent({
      type: AGUIEventType.ACTIVITY_SNAPSHOT,
      activityType: 'plan',
      messageId: 'm2',
      content: { operations: ['x'] },
    });

    manager.handleActivityEvent({
      type: AGUIEventType.ACTIVITY_DELTA,
      activityType: 'plan',
      messageId: 'm1',
      patch: [{ op: 'add', path: '/operations/-', value: 'b' }],
    });

    expect(manager.getActivity('plan', 'm1')?.content).toEqual({ operations: ['a', 'b'] });
    expect(manager.getActivity('plan', 'm2')?.content).toEqual({ operations: ['x'] });
  });

  it('带新 messageId 的首个增量从空内容开始且精确查询不回退', () => {
    const manager = new ActivityManagerImpl();
    manager.handleActivityEvent({
      type: AGUIEventType.ACTIVITY_SNAPSHOT,
      activityType: 'plan',
      messageId: 'm1',
      content: { operations: ['a'] },
    });

    const created = manager.handleActivityEvent({
      type: AGUIEventType.ACTIVITY_DELTA,
      activityType: 'plan',
      messageId: 'm2',
      patch: [{ op: 'add', path: '/operations/-', value: 'x' }],
    });

    expect(created).toMatchObject({ messageId: 'm2', content: { operations: ['x'] } });
    expect(manager.getActivity('plan', 'm2')?.content).toEqual({ operations: ['x'] });
    // 已有实例不受新实例增量的影响
    expect(manager.getActivity('plan', 'm1')?.content).toEqual({ operations: ['a'] });
    // 无 messageId 的查询仍回退到最近实例
    expect(manager.getActivity('plan')?.content).toEqual({ operations: ['x'] });
  });
});
