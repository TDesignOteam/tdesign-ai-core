import { describe, expect, it } from 'vitest';

import { normalizeActionBinding, resolveActionParams } from '../action-binding';

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

  describe('A2UI v0.9.1 官方规范', () => {
    it('识别官方 event 格式：{ event: { name, context } } → { action, params, kind: "event" }', () => {
      expect(
        normalizeActionBinding({
          event: {
            name: 'submitBooking',
            context: { topic: { path: '/booking/topic' }, attendees: 5 },
          },
        }),
      ).toEqual({
        action: 'submitBooking',
        params: { topic: { path: '/booking/topic' }, attendees: 5 },
        kind: 'event',
      });
    });

    it('event.context 缺省时归一化为空对象', () => {
      expect(normalizeActionBinding({ event: { name: 'reset' } })).toEqual({
        action: 'reset',
        params: {},
        kind: 'event',
      });
    });

    it('识别官方 functionCall 格式：{ functionCall: { call, args } } → { action, params, kind: "functionCall" }', () => {
      expect(
        normalizeActionBinding({
          functionCall: {
            call: 'openUrl',
            args: { url: 'https://a2ui.org/help' },
          },
        }),
      ).toEqual({
        action: 'openUrl',
        params: { url: 'https://a2ui.org/help' },
        kind: 'functionCall',
      });
    });

    it('functionCall.args 缺省时归一化为空对象', () => {
      expect(normalizeActionBinding({ functionCall: { call: 'noop' } })).toEqual({
        action: 'noop',
        params: {},
        kind: 'functionCall',
      });
    });

    it('event 优先级高于 legacy 扁平结构（多字段共存时以官方为准）', () => {
      expect(
        normalizeActionBinding({
          event: { name: 'newFormat', context: { current: true } },
          name: 'legacyName',
          context: { old: true },
        }),
      ).toEqual({
        action: 'newFormat',
        params: { current: true },
        kind: 'event',
      });
    });

    it('event 优先级高于 functionCall（业务错误共存时以 event 为准）', () => {
      expect(
        normalizeActionBinding({
          event: { name: 'primaryEvent', context: { a: 1 } },
          functionCall: { call: 'secondary', args: { b: 2 } },
        }),
      ).toEqual({
        action: 'primaryEvent',
        params: { a: 1 },
        kind: 'event',
      });
    });

    it('保留 preventDefault / confirm / onSuccess / onError 等额外字段', () => {
      expect(
        normalizeActionBinding({
          event: { name: 'delete', context: { id: 1 } },
          preventDefault: true,
          confirm: { title: '确认删除？' },
        } as any),
      ).toMatchObject({
        action: 'delete',
        params: { id: 1 },
        kind: 'event',
        preventDefault: true,
        confirm: { title: '确认删除？' },
      });
    });

    it('无效的 event（缺 name）回退到 legacy 兜底逻辑', () => {
      // event.name 缺失 → 忽略 event 分支，尝试 legacy name / action
      expect(
        normalizeActionBinding({
          event: { context: { x: 1 } } as any,
          name: 'fallback',
        }),
      ).toEqual({ action: 'fallback', params: {} });
    });
  });
});
