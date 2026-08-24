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

describe('JSON Patch 辅助函数', () => {
  describe('对象辅助函数', () => {
    it('在 null 原型和同名遮蔽对象上安全检查自有属性', () => {
      const nullPrototype = Object.assign(Object.create(null) as Record<string, number>, { value: 1 });
      const shadowed = { hasOwnProperty: false, value: 1 };

      expect(hasOwnProperty(nullPrototype, 'value')).toBe(true);
      expect(hasOwnProperty(shadowed, 'value')).toBe(true);
      expect(hasOwnProperty(Object.create({ inherited: true }), 'inherited')).toBe(false);
    });

    it('返回对象的可枚举自有键', () => {
      const object = Object.create({ inherited: true }) as Record<string, unknown>;
      object.first = 1;
      Object.defineProperty(object, 'hidden', { value: 2, enumerable: false });

      expect(_objectKeys(object)).toEqual(['first']);
    });

    it('返回全部位置数组键，包括稀疏数组位置', () => {
      const array = new Array(3);
      array[1] = 'present';
      (array as any).extra = true;

      expect(_objectKeys(array)).toEqual(['0', '1', '2']);
    });
  });

  describe('克隆', () => {
    it('深克隆 JSON 对象和数组', () => {
      const original = { nested: [{ value: 1 }] };
      const clone = _deepClone(original);

      expect(clone).toEqual(original);
      expect(clone).not.toBe(original);
      expect(clone.nested).not.toBe(original.nested);
      expect(clone.nested[0]).not.toBe(original.nested[0]);
    });

    it('对 undefined 值使用 JSON 序列化语义', () => {
      expect(_deepClone({ omitted: undefined, retained: 1 })).toEqual({ retained: 1 });
      expect(_deepClone([undefined])).toEqual([null]);
      expect(_deepClone(undefined)).toBeNull();
    });

    it.each([{ value: null }, { value: 'text' }, { value: 2 }, { value: true }])(
      '克隆 JSON 基本类型 $value',
      ({ value }) => {
        expect(_deepClone(value)).toBe(value);
      },
    );
  });

  describe('整数解析', () => {
    it.each(['0', '1', '01', '1234567890'])('接受十进制数字字符串：%s', (value) => {
      expect(isInteger(value)).toBe(true);
    });

    it.each(['-1', '+1', '1.0', '1e2', ' 1', '1 ', 'a'])('拒绝非数字字符串：%s', (value) => {
      expect(isInteger(value)).toBe(false);
    });

    it.fails('拒绝空字符串作为数组索引', () => {
      expect(isInteger('')).toBe(false);
    });
  });

  describe('JSON Pointer 组件', () => {
    it.each([
      { raw: 'plain', escaped: 'plain' },
      { raw: 'a/b', escaped: 'a~1b' },
      { raw: 'a~b', escaped: 'a~0b' },
      { raw: '~/~', escaped: '~0~1~0' },
      { raw: '', escaped: '' },
    ])('转义与反转义 $raw', ({ raw, escaped }) => {
      expect(escapePathComponent(raw)).toBe(escaped);
      expect(unescapePathComponent(escaped)).toBe(raw);
    });

    it('未识别的转义序列保持不变', () => {
      expect(unescapePathComponent('a~2b')).toBe('a~2b');
    });
  });

  describe('对象路径', () => {
    it('为根对象返回根路径', () => {
      const root = { value: 1 };

      expect(getPath(root, root)).toBe('/');
    });

    it('查找嵌套对象并转义每个路径组件', () => {
      const target = { value: true };
      const root = { 'a/b': { '~child': target } };

      expect(_getPathRecursive(root, target)).toBe('a~1b/~0child/');
      expect(getPath(root, target)).toBe('/a~1b/~0child/');
    });

    it('按索引查找数组成员', () => {
      const target = { value: true };
      const root = { items: [target] };

      expect(getPath(root, target)).toBe('/items/0/');
    });

    it('对象不在根中时抛出异常', () => {
      expect(() => getPath({ nested: {} }, {})).toThrow('Object not found in root');
    });
  });

  describe('undefined 检测', () => {
    it.each([
      { value: undefined, expected: true },
      { value: { nested: undefined }, expected: true },
      { value: [1, { nested: undefined }], expected: true },
      { value: new Array(1), expected: true },
      { value: { nested: null }, expected: false },
      { value: [0, false, ''], expected: false },
      { value: null, expected: false },
    ])('对 $value 返回 $expected', ({ value, expected }) => {
      expect(hasUndefined(value)).toBe(expected);
    });

    it('忽略继承的 undefined 属性', () => {
      const value = Object.create({ inherited: undefined }) as Record<string, unknown>;
      value.own = true;

      expect(hasUndefined(value)).toBe(false);
    });
  });

  describe('PatchError', () => {
    it('保留结构化上下文并格式化进消息', () => {
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
