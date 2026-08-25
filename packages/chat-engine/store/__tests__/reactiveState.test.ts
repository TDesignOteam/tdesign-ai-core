import { describe, expect, it, vi } from 'vitest';

import ReactiveState from '../reactiveState';

type TestState = {
  count: number;
  profile: { name: string; tags: string[] };
};

const createState = () => {
  const state = new ReactiveState<TestState>();
  state.initialize({ count: 0, profile: { name: 'Ada', tags: [] } });
  return state;
};

const flushNotifications = () => new Promise<void>((resolve) => queueMicrotask(resolve));

describe('ReactiveState', () => {
  it('初始化并暴露冻结的顶层状态', () => {
    const state = createState();

    expect(state.getState()).toEqual({ count: 0, profile: { name: 'Ada', tags: [] } });
    expect(Object.isFrozen(state.getState())).toBe(true);
  });

  it('默认返回当前引用，按需返回独立克隆', () => {
    const state = createState();
    const current = state.getState();
    const clone = state.getState(true);

    expect(state.getState()).toBe(current);
    expect(clone).toEqual(current);
    expect(clone).not.toBe(current);
    expect(clone.profile).not.toBe(current.profile);
  });

  it('更新状态并上报 Immer 生成的变更路径', async () => {
    const state = createState();
    const subscriber = vi.fn();
    state.subscribe(subscriber);

    state.setState((draft) => {
      draft.count = 1;
      draft.profile.tags.push('typescript');
    });
    await flushNotifications();

    expect(state.getState()).toEqual({ count: 1, profile: { name: 'Ada', tags: ['typescript'] } });
    expect(subscriber).toHaveBeenCalledOnce();
    expect(subscriber.mock.calls[0][1]).toEqual(expect.arrayContaining(['count', 'profile.tags.0']));
  });

  it('批量处理同步更新并对变更路径去重', async () => {
    const state = createState();
    const subscriber = vi.fn();
    state.subscribe(subscriber);

    state.setState((draft) => {
      draft.count = 1;
    });
    state.setState((draft) => {
      draft.count = 2;
    });
    await flushNotifications();

    expect(subscriber).toHaveBeenCalledOnce();
    expect(subscriber).toHaveBeenCalledWith(state.getState(), ['count']);
  });

  it('使用显式提供的变更路径', async () => {
    const state = createState();
    const subscriber = vi.fn();
    state.subscribe(subscriber);

    state.setState(
      (draft) => {
        draft.profile.name = 'Grace';
      },
      ['person.displayName'],
    );
    await flushNotifications();

    expect(subscriber).toHaveBeenCalledWith(state.getState(), ['person.displayName']);
  });

  it('更新未产生变更时不通知也不替换状态', async () => {
    const state = createState();
    const original = state.getState();
    const subscriber = vi.fn();
    state.subscribe(subscriber);

    state.setState(() => undefined);
    await flushNotifications();

    expect(state.getState()).toBe(original);
    expect(subscriber).not.toHaveBeenCalled();
  });

  it('按精确路径与后代路径过滤订阅', async () => {
    const state = createState();
    const profileSubscriber = vi.fn();
    const nameSubscriber = vi.fn();
    const countSubscriber = vi.fn();
    state.subscribe(profileSubscriber, ['profile']);
    state.subscribe(nameSubscriber, ['profile.name']);
    state.subscribe(countSubscriber, ['count']);

    state.setState((draft) => {
      draft.profile.name = 'Grace';
    });
    await flushNotifications();

    expect(profileSubscriber).toHaveBeenCalledOnce();
    expect(nameSubscriber).toHaveBeenCalledOnce();
    expect(countSubscriber).not.toHaveBeenCalled();
  });

  it('取消订阅某个处理器', async () => {
    const state = createState();
    const subscriber = vi.fn();
    const unsubscribe = state.subscribe(subscriber, ['count']);
    unsubscribe();

    state.setState((draft) => {
      draft.count += 1;
    });
    await flushNotifications();

    expect(subscriber).not.toHaveBeenCalled();
  });

  it('隔离订阅者错误以保证后续订阅者被通知', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const state = createState();
    const survivor = vi.fn();
    state.subscribe(() => {
      throw new Error('subscriber failed');
    });
    state.subscribe(survivor);

    state.setState((draft) => {
      draft.count = 1;
    });
    await flushNotifications();

    expect(consoleError).toHaveBeenCalledOnce();
    expect(survivor).toHaveBeenCalledOnce();
  });

  it('向订阅者提供冻结的状态与路径集合', async () => {
    const state = createState();
    const subscriber = vi.fn((nextState: Readonly<TestState>, paths: readonly string[]) => {
      expect(Object.isFrozen(nextState)).toBe(true);
      expect(Object.isFrozen(paths)).toBe(true);
    });
    state.subscribe(subscriber);

    state.setState((draft) => {
      draft.count = 1;
    });
    await flushNotifications();

    expect(subscriber).toHaveBeenCalledOnce();
  });

  it('destroy 移除订阅，包括已排队待通知的任务', async () => {
    const state = createState();
    const subscriber = vi.fn();
    state.subscribe(subscriber);
    state.setState((draft) => {
      draft.count = 1;
    });

    state.destroy();
    await flushNotifications();

    expect(subscriber).not.toHaveBeenCalled();
  });

  it('debug 记录更新日志并返回同一实例', async () => {
    vi.spyOn(console, 'groupCollapsed').mockImplementation(() => undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'groupEnd').mockImplementation(() => undefined);
    const state = createState();

    expect(state.debug('Session')).toBe(state);
    state.setState((draft) => {
      draft.count = 1;
    });
    await flushNotifications();

    expect(console.groupCollapsed).toHaveBeenCalledWith('%cSession Update', 'color: #4CAF50; font-weight: bold;');
    expect(console.log).toHaveBeenCalledWith('Changed Paths:', ['count']);
    expect(console.log).toHaveBeenCalledWith('New State:', state.getState());
  });

  it.todo('父对象被替换时通知子路径订阅者');
  it.todo('初始化后立即深度冻结嵌套值');
});
