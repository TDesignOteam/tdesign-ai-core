import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChatEventBus, createEventBus } from '../ChatEventBus';
import { ChatEngineEventType } from '../types';

const initPayload = { timestamp: 123 };

describe('ChatEventBus', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('订阅、派发与取消订阅普通监听器', () => {
    const bus = new ChatEventBus();
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribe = bus.on(ChatEngineEventType.ENGINE_INIT, first);
    bus.on(ChatEngineEventType.ENGINE_INIT, second);

    expect(bus.listenerCount(ChatEngineEventType.ENGINE_INIT)).toBe(2);
    expect(bus.hasListeners(ChatEngineEventType.ENGINE_INIT)).toBe(true);

    bus.emit(ChatEngineEventType.ENGINE_INIT, initPayload);
    unsubscribe();
    bus.emit(ChatEngineEventType.ENGINE_INIT, { timestamp: 456 });

    expect(first).toHaveBeenCalledOnce();
    expect(first).toHaveBeenCalledWith(initPayload);
    expect(second).toHaveBeenCalledTimes(2);
    expect(bus.listenerCount(ChatEngineEventType.ENGINE_INIT)).toBe(1);
  });

  it('支持一次性监听器与移除事件的全部监听器', () => {
    const bus = new ChatEventBus();
    const regular = vi.fn();
    const once = vi.fn();
    bus.on(ChatEngineEventType.ENGINE_INIT, regular);
    bus.once(ChatEngineEventType.ENGINE_INIT, once);

    bus.emit(ChatEngineEventType.ENGINE_INIT, initPayload);
    bus.emit(ChatEngineEventType.ENGINE_INIT, initPayload);

    expect(regular).toHaveBeenCalledTimes(2);
    expect(once).toHaveBeenCalledOnce();
    expect(bus.listenerCount(ChatEngineEventType.ENGINE_INIT)).toBe(1);

    bus.off(ChatEngineEventType.ENGINE_INIT);
    expect(bus.hasListeners(ChatEngineEventType.ENGINE_INIT)).toBe(false);
  });

  it('隔离普通与一次性处理器抛出的错误', () => {
    const error = new Error('handler failed');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const bus = new ChatEventBus();
    const survivor = vi.fn();
    bus.on(ChatEngineEventType.ENGINE_INIT, () => {
      throw error;
    });
    bus.once(ChatEngineEventType.ENGINE_INIT, () => {
      throw error;
    });
    bus.on(ChatEngineEventType.ENGINE_INIT, survivor);

    expect(() => bus.emit(ChatEngineEventType.ENGINE_INIT, initPayload)).not.toThrow();
    expect(survivor).toHaveBeenCalledOnce();
    expect(consoleError).toHaveBeenCalledTimes(2);
  });

  it('等待下一个事件并移除一次性监听器', async () => {
    const bus = new ChatEventBus();
    const result = bus.waitFor(ChatEngineEventType.ENGINE_INIT, 100);

    bus.emit(ChatEngineEventType.ENGINE_INIT, initPayload);

    await expect(result).resolves.toEqual(initPayload);
    expect(bus.listenerCount(ChatEngineEventType.ENGINE_INIT)).toBe(0);
  });

  it('waitFor 超时时 reject 并移除其监听器', async () => {
    vi.useFakeTimers();
    const bus = new ChatEventBus();
    const result = bus.waitFor(ChatEngineEventType.ENGINE_INIT, 25);
    const assertion = expect(result).rejects.toThrow('Timeout waiting for event: engine:init (25ms)');

    await vi.advanceTimersByTimeAsync(25);

    await assertion;
    expect(bus.listenerCount(ChatEngineEventType.ENGINE_INIT)).toBe(0);
  });

  it('等待直到事件匹配过滤器', async () => {
    const bus = new ChatEventBus();
    const filter = vi.fn((payload: { timestamp: number }) => payload.timestamp > 10);
    const result = bus.waitForMatch(ChatEngineEventType.ENGINE_INIT, filter, 100);

    bus.emit(ChatEngineEventType.ENGINE_INIT, { timestamp: 5 });
    bus.emit(ChatEngineEventType.ENGINE_INIT, { timestamp: 11 });

    await expect(result).resolves.toEqual({ timestamp: 11 });
    expect(filter).toHaveBeenCalledTimes(2);
    expect(bus.listenerCount(ChatEngineEventType.ENGINE_INIT)).toBe(0);
  });

  it('记录过滤器错误并保持订阅以等待后续匹配', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const bus = new ChatEventBus();
    const filter = vi
      .fn<(payload: { timestamp: number }) => boolean>()
      .mockImplementationOnce(() => {
        throw new Error('invalid payload');
      })
      .mockReturnValueOnce(true);
    const result = bus.waitForMatch(ChatEngineEventType.ENGINE_INIT, filter, 100);

    bus.emit(ChatEngineEventType.ENGINE_INIT, { timestamp: 1 });
    bus.emit(ChatEngineEventType.ENGINE_INIT, { timestamp: 2 });

    await expect(result).resolves.toEqual({ timestamp: 2 });
    expect(consoleError).toHaveBeenCalledOnce();
  });

  it('waitForMatch 超时时 reject 并取消订阅', async () => {
    vi.useFakeTimers();
    const bus = new ChatEventBus();
    const result = bus.waitForMatch(ChatEngineEventType.ENGINE_INIT, () => false, 40);
    const assertion = expect(result).rejects.toThrow('Timeout waiting for matching event: engine:init (40ms)');

    await vi.advanceTimersByTimeAsync(40);

    await assertion;
    expect(bus.listenerCount(ChatEngineEventType.ENGINE_INIT)).toBe(0);
  });

  it('独立处理自定义事件并统计其监听器', () => {
    const bus = new ChatEventBus();
    const alpha = vi.fn();
    const beta = vi.fn();
    const unsubscribe = bus.onCustom<{ value: number }>('alpha', alpha);
    bus.onCustom('beta', beta);

    expect(bus.getTotalListenerCount()).toBe(2);
    bus.emitCustom('alpha', { value: 3 });
    unsubscribe();
    bus.emitCustom('alpha', { value: 4 });

    expect(alpha).toHaveBeenCalledOnce();
    expect(alpha).toHaveBeenCalledWith({ value: 3 });
    expect(beta).not.toHaveBeenCalled();
  });

  it('限制事件历史长度并返回防御性数组副本', () => {
    vi.spyOn(Date, 'now').mockReturnValue(999);
    const bus = new ChatEventBus({ historySize: 2 });
    bus.emit(ChatEngineEventType.ENGINE_INIT, { timestamp: 1 });
    bus.emitCustom('progress', 50);
    bus.emit(ChatEngineEventType.ENGINE_DESTROY, { timestamp: 2 });

    const history = bus.getHistory();
    expect(history).toEqual([
      {
        event: ChatEngineEventType.CUSTOM,
        payload: { eventName: 'progress', data: 50 },
        timestamp: 999,
      },
      { event: ChatEngineEventType.ENGINE_DESTROY, payload: { timestamp: 2 }, timestamp: 999 },
    ]);

    history.pop();
    expect(bus.getHistory()).toHaveLength(2);
  });

  it('达到配置的普通监听器上限时发出警告', () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const bus = new ChatEventBus({ maxListeners: 1 });
    bus.on(ChatEngineEventType.ENGINE_INIT, vi.fn());
    bus.on(ChatEngineEventType.ENGINE_INIT, vi.fn());

    expect(consoleWarn).toHaveBeenCalledWith(expect.stringContaining('Maximum listeners (1) exceeded'));
    expect(bus.listenerCount(ChatEngineEventType.ENGINE_INIT)).toBe(2);
  });

  it('清除监听器与历史记录', () => {
    const bus = new ChatEventBus({ historySize: 1 });
    bus.on(ChatEngineEventType.ENGINE_INIT, vi.fn());
    bus.once(ChatEngineEventType.ENGINE_DESTROY, vi.fn());
    bus.onCustom('custom', vi.fn());
    bus.emit(ChatEngineEventType.ENGINE_INIT, initPayload);

    bus.clear();

    expect(bus.getTotalListenerCount()).toBe(0);
    expect(bus.getHistory()).toEqual([]);
  });

  it('永久销毁、忽略派发并拒绝新订阅', () => {
    const bus = new ChatEventBus();
    const callback = vi.fn();
    bus.on(ChatEngineEventType.ENGINE_INIT, callback);
    bus.destroy();

    bus.emit(ChatEngineEventType.ENGINE_INIT, initPayload);
    bus.emitCustom('ignored', true);

    expect(callback).not.toHaveBeenCalled();
    expect(() => bus.on(ChatEngineEventType.ENGINE_INIT, callback)).toThrow('Event bus has been destroyed');
    expect(() => bus.once(ChatEngineEventType.ENGINE_INIT, callback)).toThrow('Event bus has been destroyed');
    expect(() => bus.onCustom('ignored', callback)).toThrow('Event bus has been destroyed');
    expect(() => bus.waitFor(ChatEngineEventType.ENGINE_INIT)).toThrow('Event bus has been destroyed');
  });

  it('通过工厂函数创建事件总线', () => {
    expect(createEventBus()).toBeInstanceOf(ChatEventBus);
  });

  it.todo('事件总线被清除或销毁时 reject 待处理的 waitFor Promise');
  it.todo('在普通与一次性监听器上统一应用 maxListeners');
});
