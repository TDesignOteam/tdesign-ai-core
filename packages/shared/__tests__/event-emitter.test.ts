import { describe, expect, it, vi } from 'vitest';

import SimpleEventEmitter from '../event-emitter';

describe('SimpleEventEmitter', () => {
  it('按注册顺序向监听器传递参数', () => {
    const emitter = new SimpleEventEmitter();
    const calls: string[] = [];
    const first = vi.fn<(message: string, count: number) => void>((message: string, count: number) => {
      calls.push(`first:${message}:${count}`);
    });
    const second = vi.fn<(message: string, count: number) => void>((message: string, count: number) => {
      calls.push(`second:${message}:${count}`);
    });

    emitter.on('message', first);
    emitter.on('message', second);

    expect(emitter.emit('message', 'hello', 2)).toBe(true);
    expect(calls).toEqual(['first:hello:2', 'second:hello:2']);
    expect(first).toHaveBeenCalledWith('hello', 2);
    expect(second).toHaveBeenCalledWith('hello', 2);
  });

  it('事件没有监听器时返回 false', () => {
    const emitter = new SimpleEventEmitter();

    expect(emitter.emit('missing')).toBe(false);
  });

  it('仅移除指定的监听器', () => {
    const emitter = new SimpleEventEmitter();
    const removed = vi.fn();
    const retained = vi.fn();
    emitter.on('event', removed);
    emitter.on('event', retained);

    emitter.off('event', removed);
    emitter.off('event', vi.fn());
    emitter.off('missing', removed);

    expect(emitter.emit('event')).toBe(true);
    expect(removed).not.toHaveBeenCalled();
    expect(retained).toHaveBeenCalledOnce();
  });

  it('同一监听器注册两次时仅移除一个注册', () => {
    const emitter = new SimpleEventEmitter();
    const listener = vi.fn();
    emitter.on('event', listener);
    emitter.on('event', listener);

    emitter.off('event', listener);
    emitter.emit('event');

    expect(listener).toHaveBeenCalledOnce();
  });

  it('once 监听器仅以首次派发参数调用一次', () => {
    const emitter = new SimpleEventEmitter();
    const listener = vi.fn();
    emitter.once('event', listener);

    expect(emitter.emit('event', 'first')).toBe(true);
    expect(emitter.emit('event', 'second')).toBe(false);
    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith('first');
  });

  it('不跳过在 once 监听器之后注册的普通监听器', () => {
    const emitter = new SimpleEventEmitter();
    const onceListener = vi.fn();
    const regularListener = vi.fn();
    emitter.once('event', onceListener);
    emitter.on('event', regularListener);

    emitter.emit('event');

    expect(onceListener).toHaveBeenCalledOnce();
    expect(regularListener).toHaveBeenCalledOnce();
  });

  it('可以通过原始 callback 移除 once 监听器', () => {
    const emitter = new SimpleEventEmitter();
    const listener = vi.fn();
    emitter.once('event', listener);

    emitter.off('event', listener);
    emitter.emit('event');

    expect(listener).not.toHaveBeenCalled();
  });

  it('即使抛出异常也在调用前移除 once 监听器', () => {
    const emitter = new SimpleEventEmitter();
    const error = new Error('once failed');
    const listener = vi.fn(() => {
      throw error;
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    emitter.once('event', listener);

    expect(emitter.emit('event')).toBe(true);
    expect(emitter.emit('event')).toBe(false);
    expect(listener).toHaveBeenCalledOnce();
    expect(consoleError).toHaveBeenCalledWith('EventEmitter listener error:', error);
  });

  it('隔离监听器错误并继续通知后续监听器', () => {
    const emitter = new SimpleEventEmitter();
    const error = new Error('listener failed');
    const nextListener = vi.fn();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    emitter.on('event', () => {
      throw error;
    });
    emitter.on('event', nextListener);

    expect(emitter.emit('event', 1)).toBe(true);
    expect(consoleError).toHaveBeenCalledWith('EventEmitter listener error:', error);
    expect(nextListener).toHaveBeenCalledWith(1);
  });

  it('移除单个事件的监听器且不影响其他事件', () => {
    const emitter = new SimpleEventEmitter();
    const first = vi.fn();
    const second = vi.fn();
    emitter.on('first', first);
    emitter.on('second', second);

    emitter.removeAllListeners('first');

    expect(emitter.emit('first')).toBe(false);
    expect(emitter.emit('second')).toBe(true);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });

  it('未指定事件时移除所有监听器', () => {
    const emitter = new SimpleEventEmitter();
    emitter.on('first', vi.fn());
    emitter.once('second', vi.fn());

    emitter.removeAllListeners();

    expect(emitter.emit('first')).toBe(false);
    expect(emitter.emit('second')).toBe(false);
  });
});
