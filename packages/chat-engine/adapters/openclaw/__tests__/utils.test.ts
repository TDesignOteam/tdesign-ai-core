import { describe, expect, it, vi } from 'vitest';

import {
  calculateBackoffDelay,
  createRequestFrame,
  deepMerge,
  formatWebSocketUrl,
  generateUUID,
  parseFrame,
  safeJsonParse,
} from '../utils';

describe('OpenClaw 工具函数', () => {
  it('生成 RFC 4122 格式的版本 4 UUID', () => {
    expect(generateUUID()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('解析支持的帧并拒绝格式错误或不支持的值', () => {
    expect(parseFrame('{"type":"event","event":"tick"}')).toEqual({ type: 'event', event: 'tick' });
    expect(parseFrame({ type: 'res', id: '1', ok: true })).toMatchObject({ type: 'res', id: '1' });
    expect(parseFrame('{')).toBeNull();
    expect(parseFrame({ type: 'other' })).toBeNull();
  });

  it('使用显式与生成的 ID 创建请求帧', () => {
    expect(createRequestFrame('ping', { value: 1 }, 'fixed')).toEqual({
      type: 'req',
      id: 'fixed',
      method: 'ping',
      params: { value: 1 },
    });
    expect(createRequestFrame('ping', {}).id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it.each([
    ['ws://host/path', 'ws://host/path'],
    ['wss://host/path', 'wss://host/path'],
    ['http://host/path', 'ws://host/path'],
    ['https://host/path', 'wss://host/path'],
    ['host/path', 'ws://host/path'],
  ] as const)('将 %s 格式化为 %s', (input, expected) => {
    expect(formatWebSocketUrl(input)).toBe(expected);
  });

  it('计算带上限的指数退避与可控抖动', () => {
    expect(calculateBackoffDelay(3, 100, 1000, false)).toBe(225);
    expect(calculateBackoffDelay(20, 100, 500, false)).toBe(500);
    vi.spyOn(Math, 'random').mockReturnValue(1);
    expect(calculateBackoffDelay(1, 100, 1000, true)).toBe(110);
  });

  it('解析 JSON 提供回退并深合并普通对象', () => {
    expect(safeJsonParse('{"ok":true}', null)).toEqual({ ok: true });
    expect(safeJsonParse('bad', { ok: false })).toEqual({ ok: false });
    const target: Record<string, unknown> = { nested: { keep: 1, change: 1 }, list: [1], value: 'old' };
    expect(deepMerge(target, { nested: { change: 2 }, list: [2] })).toEqual({
      nested: { keep: 1, change: 2 },
      list: [2],
      value: 'old',
    });
    expect(target.nested).toEqual({ keep: 1, change: 1 });
  });
});
