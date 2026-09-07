import { describe, expect, it } from 'vitest';

import { applyPatch, applyPatchImmutable } from '../immutable-patch';

describe('applyPatchImmutable', () => {
  it('应用多个嵌套操作且不修改输入', () => {
    const original = {
      profile: { name: 'Ada', status: 'ready', obsolete: true },
      stable: { id: 1 },
    };

    const result = applyPatchImmutable(original, [
      { op: 'replace', path: '/profile/name', value: 'Grace' },
      { op: 'append', path: '/profile/status', value: ' now' },
      { op: 'add', path: '/profile/role', value: 'admin' },
      { op: 'remove', path: '/profile/obsolete' },
    ]);

    expect(result).toEqual({
      profile: { name: 'Grace', status: 'ready now', role: 'admin' },
      stable: { id: 1 },
    });
    expect(original.profile).toEqual({ name: 'Ada', status: 'ready', obsolete: true });
  });

  it('仅重建变更嵌套值的祖先节点', () => {
    const original = {
      changed: { nested: { value: 1 }, sibling: { retained: true } },
      untouched: { stable: true },
    };

    const result = applyPatchImmutable(original, [{ op: 'replace', path: '/changed/nested/value', value: 2 }]);

    expect(result).not.toBe(original);
    expect(result.changed).not.toBe(original.changed);
    expect(result.changed.nested).not.toBe(original.changed.nested);
    expect(result.changed.sibling).toBe(original.changed.sibling);
    expect(result.untouched).toBe(original.untouched);
  });

  it('不可变地替换和删除数组元素', () => {
    const retained = { id: 'retained' };
    const original = { items: [{ id: 'first' }, retained, { id: 'last' }], stable: { value: true } };

    const replaced = applyPatchImmutable(original, [{ op: 'replace', path: '/items/0/id', value: 'changed' }]);
    const removed = applyPatchImmutable(replaced, [{ op: 'remove', path: '/items/2' }]);

    expect(replaced.items).toEqual([{ id: 'changed' }, retained, { id: 'last' }]);
    expect(replaced.items).not.toBe(original.items);
    expect(replaced.items[1]).toBe(retained);
    expect(replaced.stable).toBe(original.stable);
    expect(removed.items).toEqual([{ id: 'changed' }, retained]);
    expect(removed.items[0]).toBe(replaced.items[0]);
    expect(original.items).toHaveLength(3);
  });

  it('通过 "-" 段向数组追加元素', () => {
    const first = { id: 1 };
    const original = { items: [first], stable: { value: true } };

    const result = applyPatchImmutable(original, [{ op: 'add', path: '/items/-', value: { id: 2 } }]);

    expect(result.items).toEqual([{ id: 1 }, { id: 2 }]);
    expect(result.items[0]).toBe(first);
    expect(result.stable).toBe(original.stable);
    expect(original.items).toEqual([first]);
  });

  it('数组的 add 操作在目标索引处插入而非替换', () => {
    const result = applyPatchImmutable({ items: ['a', 'c'] }, [{ op: 'add', path: '/items/1', value: 'b' }]);

    expect(result.items).toEqual(['a', 'b', 'c']);
  });

  it('数组的 copy 操作在目标索引处插入而非替换', () => {
    const result = applyPatchImmutable({ source: 'b', items: ['a', 'c'] }, [
      { op: 'copy', from: '/source', path: '/items/1' },
    ]);

    expect(result).toEqual({ source: 'b', items: ['a', 'b', 'c'] });
  });

  it('move 数组元素且不丢失目标索引之后的元素', () => {
    const result = applyPatchImmutable({ v: ['a', 'b', 'c'] }, [{ op: 'move', from: '/v/0', path: '/v/1' }]);

    expect(result.v).toEqual(['b', 'a', 'c']);
  });

  it('忽略对数组追加标记 "-" 的 remove 而非删除第一个元素', () => {
    const result = applyPatchImmutable({ items: ['a', 'b', 'c'] }, [{ op: 'remove', path: '/items/-' }]);

    expect(result.items).toEqual(['a', 'b', 'c']);
  });

  it('设置更深层路径时将原始类型父节点转换为对象', () => {
    const result = applyPatchImmutable({ name: 'x' }, [{ op: 'replace', path: '/name/first', value: 1 }]);

    expect(result).toEqual({ name: { first: 1 } });
  });

  it('copy 或 move 缺失来源时目标回退为 null 和 undefined', () => {
    const copied = applyPatchImmutable({ keep: 1 }, [{ op: 'copy', from: '/missing', path: '/dest' }]);
    const moved = applyPatchImmutable({ keep: 1 }, [{ op: 'move', from: '/missing', path: '/dest' }]);

    expect(copied).toEqual({ keep: 1, dest: null });
    expect(moved).toHaveProperty('dest', undefined);
    expect(moved).toEqual({ keep: 1, dest: undefined });
  });

  it('支持转义斜杠和波浪号的 JSON Pointer 段', () => {
    const original = {
      'a/b': { '~key': { value: 1 }, stable: { id: 1 } },
      untouched: { id: 2 },
    };

    const result = applyPatchImmutable(original, [{ op: 'replace', path: '/a~1b/~0key/value', value: 2 }]);

    expect(result['a/b']['~key'].value).toBe(2);
    expect(result['a/b'].stable).toBe(original['a/b'].stable);
    expect(result.untouched).toBe(original.untouched);
  });

  it('追加字符串并初始化缺失或为 null 的值', () => {
    const original = { existing: 'hello', empty: null, stable: { id: 1 } };

    const result = applyPatchImmutable(original, [
      { op: 'append', path: '/existing', value: ' world' },
      { op: 'append', path: '/empty', value: 'initialized' },
      { op: 'append', path: '/missing', value: 'created' },
    ]);

    expect(result).toEqual({
      existing: 'hello world',
      empty: 'initialized',
      missing: 'created',
      stable: { id: 1 },
    });
    expect(result.stable).toBe(original.stable);
  });

  it('move 嵌套值并删除其来源', () => {
    const original = {
      source: { movable: { id: 1 }, retained: { id: 2 } },
      target: { existing: true },
      stable: { id: 3 },
    };
    const moved = original.source.movable;

    const result = applyPatchImmutable(original, [
      { op: 'move', from: '/source/movable', path: '/target/moved' },
    ]) as unknown as {
      source: { retained: { id: number } };
      target: { existing: boolean; moved: { id: number } };
      stable: { id: number };
    };

    expect(result).toEqual({
      source: { retained: { id: 2 } },
      target: { existing: true, moved: { id: 1 } },
      stable: { id: 3 },
    });
    expect(result.target.moved).toBe(moved);
    expect(result.source.retained).toBe(original.source.retained);
    expect(result.stable).toBe(original.stable);
  });

  it('深拷贝复制的值并保留无关引用', () => {
    const original = {
      source: { nested: { id: 1 } },
      target: { existing: true },
      stable: { id: 2 },
    };

    const result = applyPatchImmutable(original, [
      { op: 'copy', from: '/source', path: '/target/copied' },
    ]) as unknown as {
      source: { nested: { id: number } };
      target: { existing: boolean; copied: { nested: { id: number } } };
      stable: { id: number };
    };

    expect(result.target.copied).toEqual(original.source);
    expect(result.target.copied).not.toBe(original.source);
    expect(result.target.copied.nested).not.toBe(original.source.nested);
    expect(result.source).toBe(original.source);
    expect(result.stable).toBe(original.stable);
  });

  it('支持在根上执行 add、replace、append 和 remove', () => {
    const original = { value: 1 };

    expect(applyPatchImmutable(original, [{ op: 'add', path: '', value: { added: true } }])).toEqual({
      added: true,
    });
    expect(applyPatchImmutable(original, [{ op: 'replace', path: '', value: 'replacement' }])).toBe('replacement');
    expect(applyPatchImmutable('hello', [{ op: 'append', path: '', value: ' world' }])).toBe('hello world');
    expect(applyPatchImmutable(original, [{ op: 'remove', path: '' }])).toBeUndefined();
    expect(original).toEqual({ value: 1 });
  });

  it('按 RFC 6902 将路径 "/" 视为空字符串键而非根', () => {
    const original = { value: 1 };

    expect(applyPatchImmutable(original, [{ op: 'replace', path: '/', value: 'replacement' }])).toEqual({
      '': 'replacement',
      value: 1,
    });
  });

  it('支持 copy 和 move 到根', () => {
    const original = { source: { nested: { value: 1 } }, stable: { id: 2 } };

    const copied = applyPatchImmutable(original, [
      { op: 'copy', from: '/source', path: '' },
    ]) as unknown as typeof original.source;
    const moved = applyPatchImmutable(original, [
      { op: 'move', from: '/source', path: '' },
    ]) as unknown as typeof original.source;

    expect(copied).toEqual({ nested: { value: 1 } });
    expect(copied).not.toBe(original.source);
    expect(copied.nested).not.toBe(original.source.nested);
    expect(moved).toBe(original.source);
    expect(original).toEqual({ source: { nested: { value: 1 } }, stable: { id: 2 } });
  });

  it('空补丁时返回原始文档', () => {
    const original = { stable: { id: 1 } };

    expect(applyPatchImmutable(original, [])).toBe(original);
  });
});

describe('applyPatch', () => {
  it('将不可变结果包装为旧版 newDocument 结构', () => {
    const original = { nested: { count: 1 }, stable: { id: 1 } };

    const result = applyPatch(original, [{ op: 'replace', path: '/nested/count', value: 2 }]);

    expect(result).toEqual({ newDocument: { nested: { count: 2 }, stable: { id: 1 } } });
    expect(result.newDocument.stable).toBe(original.stable);
    expect(original.nested.count).toBe(1);
  });
});
