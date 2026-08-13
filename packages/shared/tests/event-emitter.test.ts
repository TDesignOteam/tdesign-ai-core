import { describe, expect, it, vi } from 'vitest';

import SimpleEventEmitter from '../event-emitter';

describe('SimpleEventEmitter', () => {
  it('delivers arguments to listeners in registration order', () => {
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

  it('returns false when an event has no listeners', () => {
    const emitter = new SimpleEventEmitter();

    expect(emitter.emit('missing')).toBe(false);
  });

  it('removes only the requested listener', () => {
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

  it('removes one registration when the same listener was added twice', () => {
    const emitter = new SimpleEventEmitter();
    const listener = vi.fn();
    emitter.on('event', listener);
    emitter.on('event', listener);

    emitter.off('event', listener);
    emitter.emit('event');

    expect(listener).toHaveBeenCalledOnce();
  });

  it('invokes a once listener once with the first emission arguments', () => {
    const emitter = new SimpleEventEmitter();
    const listener = vi.fn();
    emitter.once('event', listener);

    expect(emitter.emit('event', 'first')).toBe(true);
    expect(emitter.emit('event', 'second')).toBe(false);
    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith('first');
  });

  it.todo('does not skip a regular listener registered after a once listener', () => {
    const emitter = new SimpleEventEmitter();
    const onceListener = vi.fn();
    const regularListener = vi.fn();
    emitter.once('event', onceListener);
    emitter.on('event', regularListener);

    emitter.emit('event');

    expect(onceListener).toHaveBeenCalledOnce();
    expect(regularListener).toHaveBeenCalledOnce();
  });

  it('removes a once listener before invoking it, even when it throws', () => {
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

  it('isolates listener errors and continues notifying later listeners', () => {
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

  it('removes listeners for one event without affecting another', () => {
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

  it('removes every listener when no event is specified', () => {
    const emitter = new SimpleEventEmitter();
    emitter.on('first', vi.fn());
    emitter.once('second', vi.fn());

    emitter.removeAllListeners();

    expect(emitter.emit('first')).toBe(false);
    expect(emitter.emit('second')).toBe(false);
  });
});
