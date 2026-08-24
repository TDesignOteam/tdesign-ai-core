import { describe, expect, it, vi } from 'vitest';

import {
  _areEquals,
  applyOperation,
  applyPatch,
  applyReducer,
  deepClone,
  getValueByPointer,
  JsonPatchError,
  type Operation,
  type Validator,
  validate,
  validator,
} from '../../json-patch';

function invalidOperation(operation: unknown): Operation {
  return operation as Operation;
}

function expectPatchError(run: () => unknown, name: string, index?: number) {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(JsonPatchError);
    expect(error).toMatchObject({ name, ...(index === undefined ? {} : { index }) });
    return error as InstanceType<typeof JsonPatchError>;
  }
  throw new Error(`Expected ${name} to be thrown`);
}

describe('JSON Patch 操作', () => {
  describe('对象', () => {
    it('add、replace 和 remove 对象属性', () => {
      const document = { keep: true, old: 1 };
      const result = applyPatch(document, [
        { op: 'add', path: '/added', value: { nested: true } },
        { op: 'replace', path: '/old', value: 2 },
        { op: 'remove', path: '/keep' },
      ]);

      expect(result.newDocument).toEqual({ old: 2, added: { nested: true } });
      expect(result[1].removed).toBe(1);
      expect(result[2].removed).toBe(true);
      expect(document).toBe(result.newDocument);
    });

    it('对空名称属性应用操作', () => {
      const document = { '': 'before' };

      const result = applyOperation(document, { op: 'replace', path: '/', value: 'after' }, true);

      expect(result).toMatchObject({ newDocument: { '': 'after' }, removed: 'before' });
    });
  });

  describe('数组', () => {
    it('在索引和数组末尾标记处插入', () => {
      const document = { values: ['a', 'c'] };

      applyPatch(
        document,
        [
          { op: 'add', path: '/values/1', value: 'b' },
          { op: 'add', path: '/values/-', value: 'd' },
        ],
        true,
      );

      expect(document.values).toEqual(['a', 'b', 'c', 'd']);
    });

    it('替换和删除数组元素且不留空洞', () => {
      const document = { values: ['a', 'b', 'c'] };
      const replaced = applyOperation(document, { op: 'replace', path: '/values/1', value: 'B' }, true);
      const removed = applyOperation(document, { op: 'remove', path: '/values/0' }, true);

      expect(replaced.removed).toBe('b');
      expect(removed.removed).toBe('a');
      expect(document.values).toEqual(['B', 'c']);
    });
  });

  describe('根', () => {
    it('add 和 replace 整个文档', () => {
      const added = applyOperation({ old: true }, { op: 'add', path: '', value: ['new'] });
      const original = { old: true };
      const replaced = applyOperation(original, { op: 'replace', path: '', value: { new: true } });

      expect(added.newDocument).toEqual(['new']);
      expect(replaced).toEqual({ newDocument: { new: true }, removed: original });
    });

    it('remove 整个文档', () => {
      const original = { value: 1 };

      expect(applyOperation(original, { op: 'remove', path: '' })).toEqual({
        newDocument: null,
        removed: original,
      });
    });

    it('copy 和 move 嵌套值到根', () => {
      const document = { nested: { value: 1 }, other: true };
      const copied = applyOperation(document, { op: 'copy', from: '/nested', path: '' });
      const moved = applyOperation(document, { op: 'move', from: '/nested', path: '' });

      expect(copied.newDocument).toBe(document.nested);
      expect(copied.removed).toBeUndefined();
      expect(moved).toEqual({ newDocument: document.nested, removed: document });
    });

    it('通过内部 get 操作获取整个文档', () => {
      const document = { value: 1 };
      const operation = invalidOperation({ op: '_get', path: '' }) as Extract<Operation, { op: '_get' }>;

      expect(applyOperation(document, operation).newDocument).toBe(document);
      expect(operation.value).toBe(document);
    });
  });

  describe('move 与 copy', () => {
    it('move 值并报告被覆盖的目标', () => {
      const destination = { replaced: true };
      const document = { source: { moved: true }, destination };

      const result = applyOperation(document, { op: 'move', from: '/source', path: '/destination' }, true);

      expect(document).toEqual({ destination: { moved: true } });
      expect(result.removed).toEqual(destination);
      expect(result.removed).not.toBe(destination);
    });

    it('基于移除后的目标索引 move 数组元素', () => {
      const document = { values: ['a', 'b', 'c'] };

      applyOperation(document, { op: 'move', from: '/values/0', path: '/values/2' }, true);

      expect(document.values).toEqual(['b', 'c', 'a']);
    });

    it('深拷贝值使源与目标相互独立', () => {
      const document = { source: { nested: { value: 1 } } } as Record<string, any>;

      applyOperation(document, { op: 'copy', from: '/source', path: '/copy' }, true);
      document.copy.nested.value = 2;

      expect(document.source.nested.value).toBe(1);
      expect(document.copy).not.toBe(document.source);
    });
  });

  describe('test 与 get', () => {
    it('基于结构相等性通过 test 操作', () => {
      const document = { value: { b: [1, 2], a: true } };

      expect(applyOperation(document, { op: 'test', path: '/value', value: { a: true, b: [1, 2] } })).toEqual({
        newDocument: document,
        test: true,
      });
    });

    it('test 失败时即使未启用校验也抛出补丁错误', () => {
      const operation = { op: 'test', path: '/value', value: 2 } as const;
      const error = expectPatchError(
        () => applyOperation({ value: 1 }, operation, false, true, true, 4),
        'TEST_OPERATION_FAILED',
        4,
      );

      expect(error.operation).toBe(operation);
      expect(error.tree).toEqual({ value: 1 });
    });

    it('通过 JSON Pointer 获取嵌套值和根值', () => {
      const document = { nested: { value: 1 } };
      const operation = invalidOperation({ op: '_get', path: '/nested/value' }) as Extract<Operation, { op: '_get' }>;

      applyOperation(document, operation, true);

      expect(operation.value).toBe(1);
      expect(getValueByPointer(document, '/nested')).toBe(document.nested);
      expect(getValueByPointer(document, '')).toBe(document);
    });
  });

  describe('append', () => {
    it('拼接字符串并将现有非 null 值字符串化', () => {
      const document = { text: 'Hello', count: 2 };

      applyPatch(
        document,
        [
          { op: 'append', path: '/text', value: ' world' },
          { op: 'append', path: '/count', value: ' items' },
        ],
        true,
      );

      expect(document).toEqual({ text: 'Hello world', count: '2 items' });
    });

    it.each([{ initial: null }, { initial: undefined }])('初始化 $initial 属性', ({ initial }) => {
      const document: { value?: string | null } = { value: initial };

      applyOperation(document, { op: 'append', path: '/value', value: 'first' }, true);

      expect(document.value).toBe('first');
    });

    it('初始化缺失属性并支持数组元素', () => {
      const document = { values: ['a'] } as { missing?: string; values: string[] };

      applyPatch(
        document,
        [
          { op: 'append', path: '/missing', value: 'created' },
          { op: 'append', path: '/values/0', value: 'b' },
        ],
        true,
      );

      expect(document).toEqual({ missing: 'created', values: ['ab'] });
    });

    it.each([
      { document: 'Hello', expected: 'Hello world' },
      { document: null, expected: ' world' },
    ])('在文档根上执行 append', ({ document, expected }) => {
      expect(applyOperation(document, { op: 'append', path: '', value: ' world' }, true).newDocument).toBe(expected);
    });
  });

  describe('变更控制', () => {
    it('mutateDocument 为 false 时非根操作前先克隆', () => {
      const original = { nested: { value: 1 }, untouched: { stable: true } };

      const result = applyOperation(original, { op: 'replace', path: '/nested/value', value: 2 }, true, false);

      expect(result.newDocument).toEqual({ nested: { value: 2 }, untouched: { stable: true } });
      expect(result.newDocument).not.toBe(original);
      expect(original.nested.value).toBe(1);
    });

    it('mutateDocument 为 false 时应用补丁前仅克隆一次', () => {
      const original = { values: [1], label: 'a' };

      const result = applyPatch(
        original,
        [
          { op: 'add', path: '/values/-', value: 2 },
          { op: 'append', path: '/label', value: 'b' },
        ],
        true,
        false,
      );

      expect(result.newDocument).toEqual({ values: [1, 2], label: 'ab' });
      expect(original).toEqual({ values: [1], label: 'a' });
      expect(result[0].newDocument).toBe(result[1].newDocument);
    });

    it('导出 JSON 兼容的克隆实现', () => {
      const original = { nested: { value: 1 } };
      const cloned = deepClone(original);

      expect(cloned).toEqual(original);
      expect(cloned.nested).not.toBe(original.nested);
    });
  });

  describe('JSON Pointer 与原型保护', () => {
    it('解析转义斜杠和波浪号的路径组件', () => {
      const document = { 'a/b': { '~key': 'before' } };

      applyOperation(document, { op: 'replace', path: '/a~1b/~0key', value: 'after' }, true);

      expect(document['a/b']['~key']).toBe('after');
      expect(getValueByPointer(document, '/a~1b/~0key')).toBe('after');
    });

    it.each(['/__proto__/polluted', '/constructor/prototype/polluted', '/~1safe/__proto__/polluted'])(
      '阻止通过 %s 修改原型',
      (path) => {
        expect(() => applyOperation({ '/safe': {} }, { op: 'add', path, value: true })).toThrow(TypeError);
        expect(({} as Record<string, unknown>).polluted).toBeUndefined();
      },
    );

    it('仅在显式禁用保护时允许寻址自有 __proto__ 键', () => {
      const document = JSON.parse('{"__proto__":{"value":1}}') as Record<string, any>;

      applyOperation(document, { op: 'replace', path: '/__proto__/value', value: 2 }, true, true, false);

      expect(document.__proto__.value).toBe(2);
      expect(Object.getPrototypeOf(document)).toBe(Object.prototype);
    });
  });
});

describe('校验', () => {
  it.each([
    { operation: null, name: 'OPERATION_NOT_AN_OBJECT' },
    { operation: [], name: 'OPERATION_NOT_AN_OBJECT' },
    { operation: { op: 'unknown', path: '' }, name: 'OPERATION_OP_INVALID' },
    { operation: { op: 'remove', path: 1 }, name: 'OPERATION_PATH_INVALID' },
    { operation: { op: 'remove', path: 'value' }, name: 'OPERATION_PATH_INVALID' },
    { operation: { op: 'move', path: '/value' }, name: 'OPERATION_FROM_REQUIRED' },
    { operation: { op: 'copy', path: '/value' }, name: 'OPERATION_FROM_REQUIRED' },
    { operation: { op: 'add', path: '/value' }, name: 'OPERATION_VALUE_REQUIRED' },
    { operation: { op: 'append', path: '/value' }, name: 'OPERATION_VALUE_REQUIRED' },
    {
      operation: { op: 'replace', path: '/value', value: { nested: undefined } },
      name: 'OPERATION_VALUE_CANNOT_CONTAIN_UNDEFINED',
    },
    { operation: { op: 'test', path: '/value', value: [undefined] }, name: 'OPERATION_VALUE_CANNOT_CONTAIN_UNDEFINED' },
  ])('对畸形操作报告 $name', ({ operation, name }) => {
    const error = validate([invalidOperation(operation)]);

    expect(error).toMatchObject({ name, index: 0, operation });
  });

  it('报告失败操作的索引和格式化上下文', () => {
    const operation = invalidOperation({ op: 'invalid', path: '' });
    const error = validate([{ op: 'remove', path: '/valid' }, operation]);

    expect(error).toMatchObject({ name: 'OPERATION_OP_INVALID', index: 1, operation });
    expect(error?.message).toContain('name: OPERATION_OP_INVALID');
    expect(error?.message).toContain('index: 1');
  });

  it('接受不带文档的结构合法操作', () => {
    expect(
      validate([
        { op: 'add', path: '/new', value: null },
        { op: 'move', from: '/old', path: '/new' },
        { op: 'append', path: '/text', value: '' },
      ]),
    ).toBeUndefined();
  });

  it.each([
    { operation: { op: 'replace', path: '/missing', value: 1 }, name: 'OPERATION_PATH_UNRESOLVABLE' },
    { operation: { op: 'remove', path: '/missing' }, name: 'OPERATION_PATH_UNRESOLVABLE' },
    { operation: { op: 'add', path: '/missing/child', value: 1 }, name: 'OPERATION_PATH_CANNOT_ADD' },
    { operation: { op: 'copy', from: '/missing', path: '/copy' }, name: 'OPERATION_FROM_UNRESOLVABLE' },
    { operation: { op: 'move', from: '/missing', path: '/moved' }, name: 'OPERATION_FROM_UNRESOLVABLE' },
  ])('基于文档校验路径：$name', ({ operation, name }) => {
    expect(validate([operation as Operation], { existing: true })).toMatchObject({ name });
  });

  it('拒绝遍历穿过原始值', () => {
    expectPatchError(
      () => applyOperation({ value: 1 }, { op: 'add', path: '/value/child', value: 2 }, true),
      'OPERATION_PATH_UNRESOLVABLE',
      0,
    );
  });

  it.each([
    { path: '/values/not-an-index', name: 'OPERATION_PATH_ILLEGAL_ARRAY_INDEX' },
    { path: '/values/3', name: 'OPERATION_VALUE_OUT_OF_BOUNDS' },
  ])('拒绝非法的数组 add 路径 $path', ({ path, name }) => {
    expectPatchError(() => applyOperation({ values: [1] }, { op: 'add', path, value: 2 }, true), name, 0);
  });

  it('启用校验时拒绝非数组的补丁序列', () => {
    expectPatchError(
      () => applyPatch({}, invalidOperation({ op: 'remove', path: '/x' }) as unknown as Operation[], true),
      'SEQUENCE_NOT_AN_ARRAY',
    );
    expect(validate(invalidOperation({}) as unknown as Operation[])).toMatchObject({ name: 'SEQUENCE_NOT_AN_ARRAY' });
  });

  it('使用自定义 validator 并传播其错误', () => {
    const customError = new Error('custom validation failed');
    const customValidator: Validator<{ value: number }> = vi.fn(() => {
      throw customError;
    });

    expect(() => applyOperation({ value: 1 }, { op: 'replace', path: '/value', value: 2 }, customValidator)).toThrow(
      customError,
    );
    expect(customValidator).toHaveBeenCalledWith(
      { op: 'replace', path: '/value', value: 2 },
      0,
      { value: 1 },
      '/value',
    );
  });

  it('可将感知文档的自定义校验委托给默认 validator', () => {
    const customValidator: Validator<{ value: number }> = vi.fn((operation, index, document, path) => {
      validator(operation, index, document, path);
    });

    expect(validate([{ op: 'replace', path: '/value', value: 2 }], { value: 1 }, customValidator)).toBeUndefined();
    expect(customValidator).toHaveBeenCalled();
  });

  it.fails('将每个操作的索引传递给自定义 validator', () => {
    const customValidator = vi.fn<Validator<{ first?: number; second?: number }>>();

    applyPatch(
      {},
      [
        { op: 'add', path: '/first', value: 1 },
        { op: 'add', path: '/second', value: 2 },
      ],
      customValidator,
    );

    expect(customValidator.mock.calls.some((call) => call[0].path === '/second' && call[1] === 1)).toBe(true);
  });
});

describe('reducer 与相等性', () => {
  it('通过 Array.reduce 应用操作序列', () => {
    const operations: Operation[] = [
      { op: 'add', path: '/count', value: 1 },
      { op: 'replace', path: '/label', value: 'b' },
      { op: 'append', path: '/label', value: 'c' },
      { op: 'remove', path: '/obsolete' },
    ];

    expect(operations.reduce(applyReducer, { label: 'a', obsolete: true } as Record<string, any>)).toEqual({
      count: 1,
      label: 'bc',
    });
  });

  it('支持在 reducer 中替换根', () => {
    expect(
      [{ op: 'replace', path: '', value: [1, 2] } as Operation].reduce(applyReducer, { old: true } as any),
    ).toEqual([1, 2]);
  });

  it.each([
    { left: 1, right: 1, equal: true },
    { left: Number.NaN, right: Number.NaN, equal: true },
    { left: { a: 1, b: [2, { c: true }] }, right: { b: [2, { c: true }], a: 1 }, equal: true },
    { left: [1, 2], right: [2, 1], equal: false },
    { left: { a: 1 }, right: { a: 1, b: 2 }, equal: false },
    { left: { a: 1 }, right: [1], equal: false },
    { left: null, right: {}, equal: false },
  ])('结构化比较类 JSON 值', ({ left, right, equal }) => {
    expect(_areEquals(left, right)).toBe(equal);
  });

  it.fails('比较包含自有 hasOwnProperty 键的对象', () => {
    const left = JSON.parse('{"hasOwnProperty":"left","value":1}');
    const right = JSON.parse('{"hasOwnProperty":"left","value":1}');

    expect(_areEquals(left, right)).toBe(true);
  });
});
