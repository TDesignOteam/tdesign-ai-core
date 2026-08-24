import { describe, expect, it } from 'vitest';

import { normalizeActionBinding, resolveActionParams } from '../../../adapters/json-render/action-binding';

describe('动作绑定工具函数', () => {
  it('解析嵌套的纯路径绑定且不修改输入', () => {
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

  it('在配置的深度处停止解析嵌套对象', () => {
    const binding = { path: '/value' };
    expect(resolveActionParams({ one: { two: binding } }, { value: 1 }, { maxDepth: 1 })).toEqual({
      one: { two: binding },
    });
  });

  it('将特殊属性名保留为自身数据属性', () => {
    const params = JSON.parse('{"__proto__":{"path":"/value"},"constructor":{"path":"/value"}}') as Record<
      string,
      unknown
    >;
    const result = resolveActionParams(params, { value: 'safe' });
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(Object.prototype.hasOwnProperty.call(result, '__proto__')).toBe(true);
    expect(result).toMatchObject({ __proto__: 'safe', constructor: 'safe' });
  });

  it('规范化字符串、标准与旧版绑定', () => {
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
