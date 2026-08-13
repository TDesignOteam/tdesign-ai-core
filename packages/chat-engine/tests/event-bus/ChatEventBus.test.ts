import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChatEventBus, createEventBus } from '../../event-bus/ChatEventBus';
import { ChatEngineEventType } from '../../event-bus/types';

const initPayload = { timestamp: 123 };

describe('ChatEventBus', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('subscribes, emits, and unsubscribes regular listeners', () => {
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

  it('supports one-time listeners and removing all listeners for an event', () => {
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

  it('isolates errors thrown by regular and one-time handlers', () => {
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

  it('waits for the next event and removes the one-time listener', async () => {
    const bus = new ChatEventBus();
    const result = bus.waitFor(ChatEngineEventType.ENGINE_INIT, 100);

    bus.emit(ChatEngineEventType.ENGINE_INIT, initPayload);

    await expect(result).resolves.toEqual(initPayload);
    expect(bus.listenerCount(ChatEngineEventType.ENGINE_INIT)).toBe(0);
  });

  it('rejects waitFor on timeout and removes its listener', async () => {
    vi.useFakeTimers();
    const bus = new ChatEventBus();
    const result = bus.waitFor(ChatEngineEventType.ENGINE_INIT, 25);
    const assertion = expect(result).rejects.toThrow('Timeout waiting for event: engine:init (25ms)');

    await vi.advanceTimersByTimeAsync(25);

    await assertion;
    expect(bus.listenerCount(ChatEngineEventType.ENGINE_INIT)).toBe(0);
  });

  it('waits until an event matches a filter', async () => {
    const bus = new ChatEventBus();
    const filter = vi.fn((payload: { timestamp: number }) => payload.timestamp > 10);
    const result = bus.waitForMatch(ChatEngineEventType.ENGINE_INIT, filter, 100);

    bus.emit(ChatEngineEventType.ENGINE_INIT, { timestamp: 5 });
    bus.emit(ChatEngineEventType.ENGINE_INIT, { timestamp: 11 });

    await expect(result).resolves.toEqual({ timestamp: 11 });
    expect(filter).toHaveBeenCalledTimes(2);
    expect(bus.listenerCount(ChatEngineEventType.ENGINE_INIT)).toBe(0);
  });

  it('logs filter errors and remains subscribed for a later match', async () => {
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

  it('rejects waitForMatch on timeout and unsubscribes', async () => {
    vi.useFakeTimers();
    const bus = new ChatEventBus();
    const result = bus.waitForMatch(ChatEngineEventType.ENGINE_INIT, () => false, 40);
    const assertion = expect(result).rejects.toThrow('Timeout waiting for matching event: engine:init (40ms)');

    await vi.advanceTimersByTimeAsync(40);

    await assertion;
    expect(bus.listenerCount(ChatEngineEventType.ENGINE_INIT)).toBe(0);
  });

  it('handles custom events independently and counts their listeners', () => {
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

  it('bounds event history and returns a defensive array copy', () => {
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

  it('warns when the configured regular listener limit is reached', () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const bus = new ChatEventBus({ maxListeners: 1 });
    bus.on(ChatEngineEventType.ENGINE_INIT, vi.fn());
    bus.on(ChatEngineEventType.ENGINE_INIT, vi.fn());

    expect(consoleWarn).toHaveBeenCalledWith(expect.stringContaining('Maximum listeners (1) exceeded'));
    expect(bus.listenerCount(ChatEngineEventType.ENGINE_INIT)).toBe(2);
  });

  it('clears listeners and history', () => {
    const bus = new ChatEventBus({ historySize: 1 });
    bus.on(ChatEngineEventType.ENGINE_INIT, vi.fn());
    bus.once(ChatEngineEventType.ENGINE_DESTROY, vi.fn());
    bus.onCustom('custom', vi.fn());
    bus.emit(ChatEngineEventType.ENGINE_INIT, initPayload);

    bus.clear();

    expect(bus.getTotalListenerCount()).toBe(0);
    expect(bus.getHistory()).toEqual([]);
  });

  it('destroys permanently, ignoring emissions and rejecting new subscriptions', () => {
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

  it('creates an event bus through the factory', () => {
    expect(createEventBus()).toBeInstanceOf(ChatEventBus);
  });

  it.todo('rejects pending waitFor promises when the event bus is cleared or destroyed');
  it.todo('applies maxListeners consistently across regular and one-time listeners');
});
