import { describe, expect, it } from 'vitest';

import { normalizeActionBinding, resolveActionParams } from '../../../adapters/json-render/action-binding';

describe('action binding utilities', () => {
  it('resolves nested path-only bindings without mutating input', () => {
    const params = {
      name: { path: '/user/name' },
      nested: { count: { path: '/stats/count' } },
      literal: { path: '/user/name', label: 'keep' },
      list: [{ path: '/user/name' }],
    };
    const result = resolveActionParams(params, { user: { name: 'Ada' }, stats: { count: 3 } });
    expect(result).toEqual({
      name: 'Ada',
      nested: { count: 3 },
      literal: { path: '/user/name', label: 'keep' },
      list: [{ path: '/user/name' }],
    });
    expect(params.name).toEqual({ path: '/user/name' });
  });

  it('stops resolving nested objects at the configured depth', () => {
    const binding = { path: '/value' };
    expect(resolveActionParams({ one: { two: binding } }, { value: 1 }, { maxDepth: 1 })).toEqual({
      one: { two: binding },
    });
  });

  it('preserves special property names as own data properties', () => {
    const params = JSON.parse('{"__proto__":{"path":"/value"},"constructor":{"path":"/value"}}') as Record<
      string,
      unknown
    >;
    const result = resolveActionParams(params, { value: 'safe' });
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(Object.prototype.hasOwnProperty.call(result, '__proto__')).toBe(true);
    expect(result).toMatchObject({ __proto__: 'safe', constructor: 'safe' });
  });

  it('normalizes string, standard, and legacy bindings', () => {
    expect(normalizeActionBinding('submit')).toEqual({ action: 'submit', params: {} });
    expect(normalizeActionBinding({ action: 'save', params: { id: 1 }, preventDefault: true })).toEqual({
      action: 'save',
      params: { id: 1 },
      preventDefault: true,
    });
    expect(normalizeActionBinding({ name: 'legacy', context: { id: 2 } })).toEqual({
      action: 'legacy',
      params: { id: 2 },
    });
    expect(
      normalizeActionBinding({ name: 'legacy', action: 'current', context: { old: true }, params: { current: true } }),
    ).toEqual({ action: 'current', params: { current: true } });
    expect(normalizeActionBinding(null)).toBeNull();
    expect(normalizeActionBinding({})).toBeNull();
  });
});
