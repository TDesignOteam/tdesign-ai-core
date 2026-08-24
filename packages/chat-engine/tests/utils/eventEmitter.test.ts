import { describe, expect, it, vi } from 'vitest';

import SimpleEventEmitter from '../../utils/eventEmitter';

describe('SimpleEventEmitter', () => {
  it('emits arguments to listeners and reports whether any were called', () => {
    const emitter = new SimpleEventEmitter();
    const listener = vi.fn<(value: string, count: number) => void>();

    emitter.on('message', listener);

    expect(emitter.emit('message', 'hello', 2)).toBe(true);
    expect(listener).toHaveBeenCalledWith('hello', 2);
    expect(emitter.emit('missing')).toBe(false);
  });

  it('removes a specific listener', () => {
    const emitter = new SimpleEventEmitter();
    const removed = vi.fn();
    const retained = vi.fn();
    emitter.on('event', removed);
    emitter.on('event', retained);

    emitter.off('event', removed);
    emitter.emit('event');

    expect(removed).not.toHaveBeenCalled();
    expect(retained).toHaveBeenCalledOnce();
  });

  it('calls once listeners only once', () => {
    const emitter = new SimpleEventEmitter();
    const listener = vi.fn();
    emitter.once('event', listener);

    emitter.emit('event', 1);
    emitter.emit('event', 2);

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(1);
  });

  it.fails('does not skip a regular listener registered after a once listener', () => {
    const emitter = new SimpleEventEmitter();
    const onceListener = vi.fn();
    const regularListener = vi.fn();
    emitter.once('event', onceListener);
    emitter.on('event', regularListener);

    emitter.emit('event');

    expect(onceListener).toHaveBeenCalledOnce();
    expect(regularListener).toHaveBeenCalledOnce();
  });

  it('removes listeners for one event or all events', () => {
    const emitter = new SimpleEventEmitter();
    const first = vi.fn();
    const second = vi.fn();
    emitter.on('first', first);
    emitter.on('second', second);

    emitter.removeAllListeners('first');
    expect(emitter.emit('first')).toBe(false);
    expect(emitter.emit('second')).toBe(true);

    emitter.removeAllListeners();
    expect(emitter.emit('second')).toBe(false);
  });

  it('logs listener errors and continues notifying other listeners', () => {
    const emitter = new SimpleEventEmitter();
    const error = new Error('listener failed');
    const nextListener = vi.fn();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    emitter.on('event', () => {
      throw error;
    });
    emitter.on('event', nextListener);

    expect(emitter.emit('event')).toBe(true);
    expect(consoleError).toHaveBeenCalledWith('EventEmitter listener error:', error);
    expect(nextListener).toHaveBeenCalledOnce();
  });
});
