import { describe, expect, it, vi } from 'vitest';

import * as shared from '../index';
import type { ImmutablePatchOperation, Logger } from '../index';

describe('共享包公共入口', () => {
  it('导出事件发射器和 Logger API', () => {
    const listener = vi.fn();
    const emitter = new shared.SimpleEventEmitter();
    const logger: Logger = new shared.ConsoleLogger();

    emitter.on('event', listener);
    emitter.emit('event', 'value');

    expect(listener).toHaveBeenCalledWith('value');
    expect(logger).toBeInstanceOf(shared.ConsoleLogger);
    expect(shared.LoggerManager.getLogger()).toBeDefined();
  });

  it('导出不可变补丁 API 和操作类型', () => {
    const operation: ImmutablePatchOperation = { op: 'replace', path: '/count', value: 2 };
    const original = { count: 1, stable: { id: 1 } };

    const immutableResult = shared.applyPatchImmutable(original, [operation]);
    const compatibilityResult = shared.applyPatch(original, [operation]);

    expect(immutableResult).toEqual({ count: 2, stable: { id: 1 } });
    expect(immutableResult.stable).toBe(original.stable);
    expect(compatibilityResult).toEqual({ newDocument: { count: 2, stable: { id: 1 } } });
    expect(original.count).toBe(1);
  });

  it('导出 JSON Patch 函数和错误别名', () => {
    expect(shared.JsonPatchError).toBe(shared.PatchError);
    expect(shared.deepClone).toBeTypeOf('function');
    expect(shared.applyOperation).toBeTypeOf('function');
    expect(shared.applyReducer).toBeTypeOf('function');
    expect(shared.getValueByPointer).toBeTypeOf('function');
    expect(shared.validate).toBeTypeOf('function');
    expect(shared.validator).toBeTypeOf('function');
  });

  it('导出 JSON Pointer 与辅助工具', () => {
    const value = { nested: { id: 1 } };

    expect(shared.escapePathComponent('a/b~c')).toBe('a~1b~0c');
    expect(shared.unescapePathComponent('a~1b~0c')).toBe('a/b~c');
    expect(shared.getPath(value, value.nested)).toBe('/nested/');
    expect(shared.hasOwnProperty(value, 'nested')).toBe(true);
    expect(shared.hasUndefined({ nested: [1, undefined] })).toBe(true);
    expect(shared.isInteger('12')).toBe(true);
  });
});
