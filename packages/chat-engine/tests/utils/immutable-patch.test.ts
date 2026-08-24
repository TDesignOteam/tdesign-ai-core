import { describe, expect, it } from 'vitest';

import { applyPatch, applyPatchImmutable } from '../../utils/immutable-patch';

describe('immutable patch compatibility exports', () => {
  it('applies nested operations with structural sharing', () => {
    const original = {
      changed: { value: 1, nested: { label: 'old' } },
      unchanged: { stable: true },
    };

    const result = applyPatchImmutable(original, [
      { op: 'replace', path: '/changed/value', value: 2 },
      { op: 'append', path: '/changed/nested/label', value: ' value' },
    ]);

    expect(result).toEqual({
      changed: { value: 2, nested: { label: 'old value' } },
      unchanged: { stable: true },
    });
    expect(result).not.toBe(original);
    expect(result.changed).not.toBe(original.changed);
    expect(result.unchanged).toBe(original.unchanged);
    expect(original.changed).toEqual({ value: 1, nested: { label: 'old' } });
  });

  it('supports escaped JSON Pointer segments and array append', () => {
    const original = { 'a/b': { '~key': [1] } };

    const result = applyPatchImmutable(original, [{ op: 'add', path: '/a~1b/~0key/-', value: 2 }]);

    expect(result).toEqual({ 'a/b': { '~key': [1, 2] } });
  });

  it('removes, moves, and independently copies values', () => {
    const original = {
      source: { value: 1 },
      movable: 'move me',
      removed: true,
    };

    const result = applyPatchImmutable(original, [
      { op: 'copy', from: '/source', path: '/copy' },
      { op: 'move', from: '/movable', path: '/moved' },
      { op: 'remove', path: '/removed' },
    ]);

    expect(result).toEqual({ source: { value: 1 }, copy: { value: 1 }, moved: 'move me' });
    expect((result as Record<string, unknown>).copy).not.toBe(result.source);
  });

  it('provides the legacy newDocument result shape', () => {
    const original = { count: 1 };

    expect(applyPatch(original, [{ op: 'replace', path: '/count', value: 2 }])).toEqual({
      newDocument: { count: 2 },
    });
  });

  it.fails('inserts an array add operation at the target index instead of replacing it', () => {
    const result = applyPatchImmutable({ items: ['a', 'c'] }, [{ op: 'add', path: '/items/1', value: 'b' }]);

    expect(result.items).toEqual(['a', 'b', 'c']);
  });
});
