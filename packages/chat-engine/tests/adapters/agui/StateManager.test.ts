import { describe, expect, it, vi } from 'vitest';

import { StateManagerImpl } from '../../../adapters/agui/StateManager';
import { AGUIEventType } from '../../../adapters/agui/types/events';

describe('StateManagerImpl', () => {
  it('stores each valid snapshot entry and tracks the latest state', () => {
    const manager = new StateManagerImpl();
    manager.handleStateEvent({
      type: AGUIEventType.STATE_SNAPSHOT,
      snapshot: { cart: { count: 1 }, profile: { name: 'Ada' } },
    });

    expect(manager.getAllStateKeys()).toEqual(['cart', 'profile']);
    expect(manager.getState('cart')).toEqual({ count: 1 });
    expect(manager.getCurrentStateKey()).toBe('profile');
    expect(manager.getCurrentState()).toEqual({ name: 'Ada' });
  });

  it('applies deltas immutably to the addressed state', () => {
    const manager = new StateManagerImpl();
    manager.handleStateEvent({
      type: AGUIEventType.STATE_SNAPSHOT,
      snapshot: { cart: { count: 1, stable: { id: 1 } } },
    });
    const before = manager.getState<{ count: number; stable: { id: number } }>('cart')!;
    manager.handleStateEvent({
      type: AGUIEventType.STATE_DELTA,
      delta: [{ op: 'replace', path: '/cart/count', value: 2 }],
    });

    const after = manager.getState<{ count: number; stable: { id: number } }>('cart')!;
    expect(after).toEqual({ count: 2, stable: { id: 1 } });
    expect(after).not.toBe(before);
    expect(after.stable).toBe(before.stable);
  });

  it('notifies latest and key-bound subscribers and supports unsubscribe', () => {
    const manager = new StateManagerImpl();
    const latest = vi.fn();
    const cart = vi.fn();
    const stopLatest = manager.subscribe(latest);
    manager.subscribe(cart, 'cart');

    manager.handleStateEvent({
      type: AGUIEventType.STATE_SNAPSHOT,
      snapshot: { cart: { count: 1 }, other: { value: true } },
    });
    expect(cart).toHaveBeenCalledOnce();
    expect(latest).toHaveBeenLastCalledWith({ value: true }, 'other');

    stopLatest();
    manager.handleStateEvent({
      type: AGUIEventType.STATE_DELTA,
      delta: [{ op: 'replace', path: '/cart/count', value: 3 }],
    });
    expect(cart).toHaveBeenLastCalledWith({ count: 3 }, 'cart');
    expect(latest).toHaveBeenCalledTimes(2);
  });

  it('ignores deltas for unknown states and clears state and subscriptions', () => {
    const manager = new StateManagerImpl();
    const subscriber = vi.fn();
    manager.subscribe(subscriber);
    manager.handleStateEvent({
      type: AGUIEventType.STATE_DELTA,
      delta: [{ op: 'add', path: '/missing/value', value: 1 }],
    });
    manager.clear();
    manager.handleStateEvent({ type: AGUIEventType.STATE_SNAPSHOT, snapshot: { next: { value: 2 } } });

    expect(subscriber).not.toHaveBeenCalled();
    expect(manager.getAllStateKeys()).toEqual(['next']);
  });
});
