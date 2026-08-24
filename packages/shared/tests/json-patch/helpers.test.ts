import { describe, expect, it } from 'vitest';

import {
  _deepClone,
  _getPathRecursive,
  _objectKeys,
  escapePathComponent,
  getPath,
  hasOwnProperty,
  hasUndefined,
  isInteger,
  PatchError,
  unescapePathComponent,
} from '../../json-patch/helpers';

describe('JSON Patch helpers', () => {
  describe('object helpers', () => {
    it('checks own properties safely on null-prototype and shadowing objects', () => {
      const nullPrototype = Object.assign(Object.create(null) as Record<string, number>, { value: 1 });
      const shadowed = { hasOwnProperty: false, value: 1 };

      expect(hasOwnProperty(nullPrototype, 'value')).toBe(true);
      expect(hasOwnProperty(shadowed, 'value')).toBe(true);
      expect(hasOwnProperty(Object.create({ inherited: true }), 'inherited')).toBe(false);
    });

    it('returns enumerable own object keys', () => {
      const object = Object.create({ inherited: true }) as Record<string, unknown>;
      object.first = 1;
      Object.defineProperty(object, 'hidden', { value: 2, enumerable: false });

      expect(_objectKeys(object)).toEqual(['first']);
    });

    it('returns every positional array key including sparse positions', () => {
      const array = new Array(3);
      array[1] = 'present';
      (array as any).extra = true;

      expect(_objectKeys(array)).toEqual(['0', '1', '2']);
    });
  });

  describe('cloning', () => {
    it('deeply clones JSON objects and arrays', () => {
      const original = { nested: [{ value: 1 }] };
      const clone = _deepClone(original);

      expect(clone).toEqual(original);
      expect(clone).not.toBe(original);
      expect(clone.nested).not.toBe(original.nested);
      expect(clone.nested[0]).not.toBe(original.nested[0]);
    });

    it('uses JSON serialization semantics for undefined values', () => {
      expect(_deepClone({ omitted: undefined, retained: 1 })).toEqual({ retained: 1 });
      expect(_deepClone([undefined])).toEqual([null]);
      expect(_deepClone(undefined)).toBeNull();
    });

    it.each([{ value: null }, { value: 'text' }, { value: 2 }, { value: true }])(
      'clones the JSON primitive $value',
      ({ value }) => {
        expect(_deepClone(value)).toBe(value);
      },
    );
  });

  describe('integer parsing', () => {
    it.each(['0', '1', '01', '1234567890'])('accepts decimal digit strings: %s', (value) => {
      expect(isInteger(value)).toBe(true);
    });

    it.each(['-1', '+1', '1.0', '1e2', ' 1', '1 ', 'a'])('rejects non-digit strings: %s', (value) => {
      expect(isInteger(value)).toBe(false);
    });

    it.fails('rejects an empty string as an array index', () => {
      expect(isInteger('')).toBe(false);
    });
  });

  describe('JSON Pointer components', () => {
    it.each([
      { raw: 'plain', escaped: 'plain' },
      { raw: 'a/b', escaped: 'a~1b' },
      { raw: 'a~b', escaped: 'a~0b' },
      { raw: '~/~', escaped: '~0~1~0' },
      { raw: '', escaped: '' },
    ])('escapes and unescapes $raw', ({ raw, escaped }) => {
      expect(escapePathComponent(raw)).toBe(escaped);
      expect(unescapePathComponent(escaped)).toBe(raw);
    });

    it('leaves unrecognized escape sequences unchanged', () => {
      expect(unescapePathComponent('a~2b')).toBe('a~2b');
    });
  });

  describe('object paths', () => {
    it('returns the root path for the root object', () => {
      const root = { value: 1 };

      expect(getPath(root, root)).toBe('/');
    });

    it('finds nested objects and escapes each path component', () => {
      const target = { value: true };
      const root = { 'a/b': { '~child': target } };

      expect(_getPathRecursive(root, target)).toBe('a~1b/~0child/');
      expect(getPath(root, target)).toBe('/a~1b/~0child/');
    });

    it('finds array members by index', () => {
      const target = { value: true };
      const root = { items: [target] };

      expect(getPath(root, target)).toBe('/items/0/');
    });

    it('throws when the object is not contained in the root', () => {
      expect(() => getPath({ nested: {} }, {})).toThrow('Object not found in root');
    });
  });

  describe('undefined detection', () => {
    it.each([
      { value: undefined, expected: true },
      { value: { nested: undefined }, expected: true },
      { value: [1, { nested: undefined }], expected: true },
      { value: new Array(1), expected: true },
      { value: { nested: null }, expected: false },
      { value: [0, false, ''], expected: false },
      { value: null, expected: false },
    ])('returns $expected for $value', ({ value, expected }) => {
      expect(hasUndefined(value)).toBe(expected);
    });

    it('ignores inherited undefined properties', () => {
      const value = Object.create({ inherited: undefined }) as Record<string, unknown>;
      value.own = true;

      expect(hasUndefined(value)).toBe(false);
    });
  });

  describe('PatchError', () => {
    it('retains structured context and formats it into the message', () => {
      const operation = { op: 'remove', path: '/missing' };
      const tree = { existing: true };
      const error = new PatchError('Cannot remove value', 'OPERATION_PATH_UNRESOLVABLE', 3, operation, tree);

      expect(error).toBeInstanceOf(Error);
      expect(error).toMatchObject({
        name: 'OPERATION_PATH_UNRESOLVABLE',
        index: 3,
        operation,
        tree,
      });
      expect(error.message).toContain('Cannot remove value');
      expect(error.message).toContain('index: 3');
      expect(error.message).toContain('"path": "/missing"');
    });
  });
});
