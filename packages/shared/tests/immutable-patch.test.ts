import { describe, expect, it } from 'vitest';

import { applyPatch, applyPatchImmutable } from '../immutable-patch';

describe('applyPatchImmutable', () => {
  it('applies multiple nested operations without mutating the input', () => {
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

  it('rebuilds only ancestors of a changed nested value', () => {
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

  it('replaces and removes array elements immutably', () => {
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

  it('appends to an array with the dash segment', () => {
    const first = { id: 1 };
    const original = { items: [first], stable: { value: true } };

    const result = applyPatchImmutable(original, [{ op: 'add', path: '/items/-', value: { id: 2 } }]);

    expect(result.items).toEqual([{ id: 1 }, { id: 2 }]);
    expect(result.items[0]).toBe(first);
    expect(result.stable).toBe(original.stable);
    expect(original.items).toEqual([first]);
  });

  it('inserts an array add operation at the target index instead of replacing it', () => {
    const result = applyPatchImmutable({ items: ['a', 'c'] }, [{ op: 'add', path: '/items/1', value: 'b' }]);

    expect(result.items).toEqual(['a', 'b', 'c']);
  });

  it('supports escaped slash and tilde JSON Pointer segments', () => {
    const original = {
      'a/b': { '~key': { value: 1 }, stable: { id: 1 } },
      untouched: { id: 2 },
    };

    const result = applyPatchImmutable(original, [{ op: 'replace', path: '/a~1b/~0key/value', value: 2 }]);

    expect(result['a/b']['~key'].value).toBe(2);
    expect(result['a/b'].stable).toBe(original['a/b'].stable);
    expect(result.untouched).toBe(original.untouched);
  });

  it('appends strings and initializes missing or null values', () => {
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

  it('moves a nested value and removes its source', () => {
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

  it('deep-clones copied values while retaining unrelated references', () => {
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

  it('supports add, replace, append, and remove at the root', () => {
    const original = { value: 1 };

    expect(applyPatchImmutable(original, [{ op: 'add', path: '', value: { added: true } }])).toEqual({
      added: true,
    });
    expect(applyPatchImmutable(original, [{ op: 'replace', path: '/', value: 'replacement' }])).toBe('replacement');
    expect(applyPatchImmutable('hello', [{ op: 'append', path: '', value: ' world' }])).toBe('hello world');
    expect(applyPatchImmutable(original, [{ op: 'remove', path: '' }])).toBeUndefined();
    expect(original).toEqual({ value: 1 });
  });

  it('supports copy and move to the root', () => {
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

  it('returns the original document for an empty patch', () => {
    const original = { stable: { id: 1 } };

    expect(applyPatchImmutable(original, [])).toBe(original);
  });
});

describe('applyPatch', () => {
  it('wraps the immutable result in the legacy newDocument shape', () => {
    const original = { nested: { count: 1 }, stable: { id: 1 } };

    const result = applyPatch(original, [{ op: 'replace', path: '/nested/count', value: 2 }]);

    expect(result).toEqual({ newDocument: { nested: { count: 2 }, stable: { id: 1 } } });
    expect(result.newDocument.stable).toBe(original.stable);
    expect(original.nested.count).toBe(1);
  });
});
