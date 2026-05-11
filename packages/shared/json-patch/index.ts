/*!
 * https://github.com/Starcounter-Jack/JSON-Patch
 * (c) 2013-2021 Joachim Wester
 * MIT license
 *
 * Modified by TDesign Team:
 * - Added `append` operation support for string concatenation
 *   The `append` op appends a string value to the existing value at the specified path.
 *   If the path does not exist or is null/undefined, it will be initialized with the value.
 *   Example: {"op": "append", "path": "/content", "value": "示例"}
 */
import { PatchError, _deepClone, isInteger, unescapePathComponent, hasUndefined } from './helpers';

export const JsonPatchError = PatchError;
export const deepClone = _deepClone;

type JsonObject = Record<string, any>;
type JsonContainer = JsonObject | any[];
type PatchOpContext = {
  path: string;
  value?: any;
  from?: string;
};

export type Operation =
  | AddOperation<any>
  | RemoveOperation
  | ReplaceOperation<any>
  | MoveOperation
  | CopyOperation
  | TestOperation<any>
  | GetOperation<any>
  | AppendOperation;

export interface Validator<T> {
  (operation: Operation, index: number, document: T, existingPathFragment: string): void;
}

export interface OperationResult<T> {
  removed?: any;
  test?: boolean;
  newDocument: T;
}

export interface BaseOperation {
  path: string;
}

export interface AddOperation<T> extends BaseOperation {
  op: 'add';
  value: T;
}

export interface RemoveOperation extends BaseOperation {
  op: 'remove';
}

export interface ReplaceOperation<T> extends BaseOperation {
  op: 'replace';
  value: T;
}

export interface MoveOperation extends BaseOperation {
  op: 'move';
  from: string;
}

export interface CopyOperation extends BaseOperation {
  op: 'copy';
  from: string;
}

export interface TestOperation<T> extends BaseOperation {
  op: 'test';
  value: T;
}

export interface GetOperation<T> extends BaseOperation {
  op: '_get';
  value: T;
}

export interface AppendOperation extends BaseOperation {
  op: 'append';
  value: string;
}
export interface PatchResult<T> extends Array<OperationResult<T>> {
  newDocument: T;
}

/* We use a Javascript hash to store each
 function. Each hash entry (property) uses
 the operation identifiers specified in rfc6902.
 In this way, we can map each patch operation
 to its dedicated function in efficient way.
 */

type PatchOpFn = (this: PatchOpContext, obj: JsonContainer, key: string | number, document: any) => OperationResult<any>;

/* The operations applicable to an object */
const objOps: Record<string, PatchOpFn> = {
  add: function (this: PatchOpContext, obj: JsonContainer, key: string | number, document: any) {
    (obj as JsonObject)[String(key)] = this.value;
    return { newDocument: document };
  },
  remove: function (this: PatchOpContext, obj: JsonContainer, key: string | number, document: any) {
    const target = obj as JsonObject;
    const removed = target[String(key)];
    delete target[String(key)];
    return { newDocument: document, removed };
  },
  replace: function (this: PatchOpContext, obj: JsonContainer, key: string | number, document: any) {
    const target = obj as JsonObject;
    const removed = target[String(key)];
    target[String(key)] = this.value;
    return { newDocument: document, removed };
  },
  move: function (this: PatchOpContext, obj: JsonContainer, key: string | number, document: any) {
    let removed = getValueByPointer(document, this.path);

    if (removed) {
      removed = _deepClone(removed);
    }

    const originalValue = applyOperation(document, { op: 'remove', path: this.from as string }).removed;

    applyOperation(document, { op: 'add', path: this.path, value: originalValue });

    return { newDocument: document, removed };
  },
  copy: function (this: PatchOpContext, obj: JsonContainer, key: string | number, document: any) {
    const valueToCopy = getValueByPointer(document, this.from as string);
    applyOperation(document, { op: 'add', path: this.path, value: _deepClone(valueToCopy) });
    return { newDocument: document };
  },
  test: function (this: PatchOpContext, obj: JsonContainer, key: string | number, document: any) {
    return { newDocument: document, test: _areEquals((obj as JsonObject)[String(key)], this.value) };
  },
  _get: function (this: PatchOpContext, obj: JsonContainer, key: string | number, document: any) {
    this.value = (obj as JsonObject)[String(key)];
    return { newDocument: document };
  },
  append: function (this: PatchOpContext, obj: JsonContainer, key: string | number, document: any) {
    const target = obj as JsonObject;
    const existing = target[String(key)];
    if (existing === undefined || existing === null) {
      target[String(key)] = this.value;
    } else {
      target[String(key)] = String(existing) + String(this.value);
    }
    return { newDocument: document };
  },
};

/* The operations applicable to an array. Many are the same as for the object */
const arrOps: Record<string, PatchOpFn> = {
  add: function (this: PatchOpContext, arr: JsonContainer, i: string | number, document: any) {
    if (isInteger(String(i))) {
      (arr as any[]).splice(Number(i), 0, this.value);
    } else {
      (arr as JsonObject)[String(i)] = this.value;
    }
    return { newDocument: document, index: i };
  },
  remove: function (this: PatchOpContext, arr: JsonContainer, i: string | number, document: any) {
    const removedList = (arr as any[]).splice(Number(i), 1);
    return { newDocument: document, removed: removedList[0] };
  },
  replace: function (this: PatchOpContext, arr: JsonContainer, i: string | number, document: any) {
    const target = arr as any[];
    const index = Number(i);
    const removed = target[index];
    target[index] = this.value;
    return { newDocument: document, removed };
  },
  move: objOps.move,
  copy: objOps.copy,
  test: objOps.test,
  _get: objOps._get,
  append: objOps.append,
};

/**
 * Retrieves a value from a JSON document by a JSON pointer.
 * Returns the value.
 *
 * @param document The document to get the value from
 * @param pointer an escaped JSON pointer
 * @return The retrieved value
 */
export function getValueByPointer(document: any, pointer: string): any {
  if (pointer == '') {
    return document;
  }
  const getOriginalDestination: GetOperation<any> = { op: '_get', path: pointer, value: undefined };
  applyOperation(document, getOriginalDestination);
  return getOriginalDestination.value;
}
/**
 * Apply a single JSON Patch Operation on a JSON document.
 * Returns the {newDocument, result} of the operation.
 * It modifies the `document` and `operation` objects - it gets the values by reference.
 * If you would like to avoid touching your values, clone them:
 * `jsonpatch.applyOperation(document, jsonpatch._deepClone(operation))`.
 *
 * @param document The document to patch
 * @param operation The operation to apply
 * @param validateOperation `false` is without validation, `true` to use default jsonpatch's validation, or you can pass a `validateOperation` callback to be used for validation.
 * @param mutateDocument Whether to mutate the original document or clone it before applying
 * @param banPrototypeModifications Whether to ban modifications to `__proto__`, defaults to `true`.
 * @return `{newDocument, result}` after the operation
 */
export function applyOperation<T>(
  document: T,
  operation: Operation,
  validateOperation: boolean | Validator<T> = false,
  mutateDocument: boolean = true,
  banPrototypeModifications: boolean = true,
  index: number = 0,
): OperationResult<T> {
  if (validateOperation) {
    if (typeof validateOperation == 'function') {
      validateOperation(operation, 0, document, operation.path);
    } else {
      validator(operation, 0);
    }
  }
  /* ROOT OPERATIONS */
  if (operation.path === '') {
    const returnValue: OperationResult<T> = { newDocument: document };
    if (operation.op === 'add') {
      returnValue.newDocument = operation.value;
      return returnValue;
    } else if (operation.op === 'replace') {
      returnValue.newDocument = operation.value;
      returnValue.removed = document; //document we removed
      return returnValue;
    } else if (operation.op === 'move' || operation.op === 'copy') {
      // it's a move or copy to root
      returnValue.newDocument = getValueByPointer(document, operation.from); // get the value by json-pointer in `from` field
      if (operation.op === 'move') {
        // report removed item
        returnValue.removed = document;
      }
      return returnValue;
    } else if (operation.op === 'test') {
      returnValue.test = _areEquals(document, operation.value);
      if (returnValue.test === false) {
        throw new JsonPatchError('Test operation failed', 'TEST_OPERATION_FAILED', index, operation, document);
      }
      returnValue.newDocument = document;
      return returnValue;
    } else if (operation.op === 'remove') {
      // a remove on root
      returnValue.removed = document;
      returnValue.newDocument = null as unknown as T;
      return returnValue;
    } else if (operation.op === '_get') {
      operation.value = document;
      return returnValue;
    } else if (operation.op === 'append') {
      const existing = document;
      if (existing === undefined || existing === null) {
        returnValue.newDocument = operation.value as T;
      } else {
        returnValue.newDocument = (String(existing) + String(operation.value)) as T;
      }
      return returnValue;
    } else {
      /* bad operation */
      if (validateOperation) {
        throw new JsonPatchError(
          'Operation `op` property is not one of operations defined in RFC-6902',
          'OPERATION_OP_INVALID',
          index,
          operation,
          document,
        );
      } else {
        return returnValue;
      }
    }
  } /* END ROOT OPERATIONS */ else {
    if (!mutateDocument) {
      document = _deepClone(document);
    }
    const path = operation.path || '';
    const keys = path.split('/');
    let obj: JsonContainer = document as JsonContainer;
    let t = 1; //skip empty element - http://jsperf.com/to-shift-or-not-to-shift
    const len = keys.length;
    let existingPathFragment: string | undefined = undefined;
    let key: string | number;
    let validateFunction: Validator<any>;
    if (typeof validateOperation == 'function') {
      validateFunction = validateOperation;
    } else {
      validateFunction = validator;
    }
    while (true) {
      key = keys[t] ?? '';
      if (key && key.indexOf('~') != -1) {
        key = unescapePathComponent(key);
      }

      if (
        banPrototypeModifications &&
        (key == '__proto__' || (key == 'prototype' && t > 0 && keys[t - 1] == 'constructor'))
      ) {
        throw new TypeError(
          'JSON-Patch: modifying `__proto__` or `constructor/prototype` prop is banned for security reasons, if this was on purpose, please set `banPrototypeModifications` flag false and pass it to this function. More info in fast-json-patch README',
        );
      }

      if (validateOperation) {
        if (existingPathFragment === undefined) {
          if ((obj as JsonObject)[String(key)] === undefined) {
            existingPathFragment = keys.slice(0, t).join('/');
          } else if (t == len - 1) {
            existingPathFragment = operation.path;
          }
          if (existingPathFragment !== undefined) {
            validateFunction(operation, 0, document, existingPathFragment);
          }
        }
      }
      t++;
      if (Array.isArray(obj)) {
        if (key === '-') {
          key = obj.length;
        } else {
          if (validateOperation && !isInteger(key)) {
            throw new JsonPatchError(
              'Expected an unsigned base-10 integer value, making the new referenced value the array element with the zero-based index',
              'OPERATION_PATH_ILLEGAL_ARRAY_INDEX',
              index,
              operation,
              document,
            );
          } // only parse key when it's an integer for `arr.prop` to work
          else if (isInteger(key)) {
            key = ~~Number(key);
          }
        }
        if (t >= len) {
          if (validateOperation && operation.op === 'add' && typeof key === 'number' && key > obj.length) {
            throw new JsonPatchError(
              'The specified index MUST NOT be greater than the number of elements in the array',
              'OPERATION_VALUE_OUT_OF_BOUNDS',
              index,
              operation,
              document,
            );
          }
          const returnValue = arrOps[operation.op].call(operation, obj, key, document); // Apply patch
          if (returnValue.test === false) {
            throw new JsonPatchError('Test operation failed', 'TEST_OPERATION_FAILED', index, operation, document);
          }
          return returnValue;
        }
      } else {
        if (t >= len) {
          const returnValue = objOps[operation.op].call(operation, obj, key, document); // Apply patch
          if (returnValue.test === false) {
            throw new JsonPatchError('Test operation failed', 'TEST_OPERATION_FAILED', index, operation, document);
          }
          return returnValue;
        }
      }
      obj = (obj as JsonObject)[String(key)] as JsonContainer;
      // If we have more keys in the path, but the next value isn't a non-null object,
      // throw an OPERATION_PATH_UNRESOLVABLE error instead of iterating again.
      if (validateOperation && t < len && (!obj || typeof obj !== 'object')) {
        throw new JsonPatchError(
          'Cannot perform operation at the desired path',
          'OPERATION_PATH_UNRESOLVABLE',
          index,
          operation,
          document,
        );
      }
    }
  }
}

/**
 * Apply a full JSON Patch array on a JSON document.
 * Returns the {newDocument, result} of the patch.
 * It modifies the `document` object and `patch` - it gets the values by reference.
 * If you would like to avoid touching your values, clone them:
 * `jsonpatch.applyPatch(document, jsonpatch._deepClone(patch))`.
 *
 * @param document The document to patch
 * @param patch The patch to apply
 * @param validateOperation `false` is without validation, `true` to use default jsonpatch's validation, or you can pass a `validateOperation` callback to be used for validation.
 * @param mutateDocument Whether to mutate the original document or clone it before applying
 * @param banPrototypeModifications Whether to ban modifications to `__proto__`, defaults to `true`.
 * @return An array of `{newDocument, result}` after the patch
 */
export function applyPatch<T>(
  document: T,
  patch: ReadonlyArray<Operation>,
  validateOperation?: boolean | Validator<T>,
  mutateDocument: boolean = true,
  banPrototypeModifications: boolean = true,
): PatchResult<T> {
  if (validateOperation) {
    if (!Array.isArray(patch)) {
      throw new JsonPatchError('Patch sequence must be an array', 'SEQUENCE_NOT_AN_ARRAY');
    }
  }
  if (!mutateDocument) {
    document = _deepClone(document);
  }
  const results = new Array(patch.length) as PatchResult<T>;

  for (let i = 0, length = patch.length; i < length; i++) {
    // we don't need to pass mutateDocument argument because if it was true, we already deep cloned the object, we'll just pass `true`
    results[i] = applyOperation(document, patch[i], validateOperation, true, banPrototypeModifications, i);
    document = results[i].newDocument; // in case root was replaced
  }
  results.newDocument = document;
  return results;
}

/**
 * Apply a single JSON Patch Operation on a JSON document.
 * Returns the updated document.
 * Suitable as a reducer.
 *
 * @param document The document to patch
 * @param operation The operation to apply
 * @return The updated document
 */
export function applyReducer<T>(document: T, operation: Operation, index: number): T {
  const operationResult: OperationResult<T> = applyOperation(document, operation);
  if (operationResult.test === false) {
    // failed test
    throw new JsonPatchError('Test operation failed', 'TEST_OPERATION_FAILED', index, operation, document);
  }
  return operationResult.newDocument;
}

/**
 * Validates a single operation. Called from `jsonpatch.validate`. Throws `JsonPatchError` in case of an error.
 * @param {object} operation - operation object (patch)
 * @param {number} index - index of operation in the sequence
 * @param {object} [document] - object where the operation is supposed to be applied
 * @param {string} [existingPathFragment] - comes along with `document`
 */
export function validator(operation: Operation, index: number, document?: any, existingPathFragment?: string): void {
  if (typeof operation !== 'object' || operation === null || Array.isArray(operation)) {
    throw new JsonPatchError('Operation is not an object', 'OPERATION_NOT_AN_OBJECT', index, operation, document);
  } else if (!objOps[operation.op]) {
    throw new JsonPatchError(
      'Operation `op` property is not one of operations defined in RFC-6902',
      'OPERATION_OP_INVALID',
      index,
      operation,
      document,
    );
  } else if (typeof operation.path !== 'string') {
    throw new JsonPatchError(
      'Operation `path` property is not a string',
      'OPERATION_PATH_INVALID',
      index,
      operation,
      document,
    );
  } else if (operation.path.indexOf('/') !== 0 && operation.path.length > 0) {
    // paths that aren't empty string should start with "/"
    throw new JsonPatchError(
      'Operation `path` property must start with "/"',
      'OPERATION_PATH_INVALID',
      index,
      operation,
      document,
    );
  } else if ((operation.op === 'move' || operation.op === 'copy') && typeof operation.from !== 'string') {
    throw new JsonPatchError(
      'Operation `from` property is not present (applicable in `move` and `copy` operations)',
      'OPERATION_FROM_REQUIRED',
      index,
      operation,
      document,
    );
  } else if (
    (operation.op === 'add' || operation.op === 'replace' || operation.op === 'test' || operation.op === 'append') &&
    operation.value === undefined
  ) {
    throw new JsonPatchError(
      'Operation `value` property is not present (applicable in `add`, `replace`, `test` and `append` operations)',
      'OPERATION_VALUE_REQUIRED',
      index,
      operation,
      document,
    );
  } else if (
    (operation.op === 'add' || operation.op === 'replace' || operation.op === 'test' || operation.op === 'append') &&
    hasUndefined(operation.value)
  ) {
    throw new JsonPatchError(
      'Operation `value` property is not present (applicable in `add`, `replace`, `test` and `append` operations)',
      'OPERATION_VALUE_CANNOT_CONTAIN_UNDEFINED',
      index,
      operation,
      document,
    );
  } else if (document) {
    if (operation.op == 'add' || operation.op == 'append') {
      const pathLen = operation.path.split('/').length;
      const existingPathLen = existingPathFragment!.split('/').length;
      if (pathLen !== existingPathLen + 1 && pathLen !== existingPathLen) {
        throw new JsonPatchError(
          'Cannot perform an `add` or `append` operation at the desired path',
          'OPERATION_PATH_CANNOT_ADD',
          index,
          operation,
          document,
        );
      }
    } else if (operation.op === 'replace' || operation.op === 'remove' || operation.op === '_get') {
      if (operation.path !== existingPathFragment) {
        throw new JsonPatchError(
          'Cannot perform the operation at a path that does not exist',
          'OPERATION_PATH_UNRESOLVABLE',
          index,
          operation,
          document,
        );
      }
    } else if (operation.op === 'move' || operation.op === 'copy') {
      const existingValue: GetOperation<any> = { op: '_get', path: operation.from, value: undefined };
      const error = validate([existingValue], document);
      if (error && error.name === 'OPERATION_PATH_UNRESOLVABLE') {
        throw new JsonPatchError(
          'Cannot perform the operation from a path that does not exist',
          'OPERATION_FROM_UNRESOLVABLE',
          index,
          operation,
          document,
        );
      }
    }
  }
}

/**
 * Validates a sequence of operations. If `document` parameter is provided, the sequence is additionally validated against the object document.
 * If error is encountered, returns a JsonPatchError object
 * @param sequence
 * @param document
 * @returns {JsonPatchError|undefined}
 */
export function validate<T>(
  sequence: ReadonlyArray<Operation>,
  document?: T,
  externalValidator?: Validator<T>,
): PatchError | undefined {
  try {
    if (!Array.isArray(sequence)) {
      throw new JsonPatchError('Patch sequence must be an array', 'SEQUENCE_NOT_AN_ARRAY');
    }
    if (document) {
      //clone document and sequence so that we can safely try applying operations
      applyPatch(_deepClone(document), _deepClone(sequence), externalValidator || true);
    } else {
      externalValidator = externalValidator || validator;
      for (let i = 0; i < sequence.length; i++) {
        externalValidator!(sequence[i], i, document!, undefined!);
      }
    }
  } catch (e) {
    if (e instanceof JsonPatchError) {
      return e;
    } else {
      throw e;
    }
  }
}

// based on https://github.com/epoberezkin/fast-deep-equal
// MIT License

// Copyright (c) 2017 Evgeny Poberezkin

// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:

// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.

// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
export function _areEquals(a: any, b: any): boolean {
  if (a === b) return true;

  if (a && b && typeof a == 'object' && typeof b == 'object') {
    const arrA = Array.isArray(a);
    const arrB = Array.isArray(b);

    if (arrA && arrB) {
      const left = a as any[];
      const right = b as any[];
      const length = left.length;
      if (length != right.length) return false;
      for (let i = length; i-- !== 0; ) if (!_areEquals(left[i], right[i])) return false;
      return true;
    }

    if (arrA != arrB) return false;

    const left = a as JsonObject;
    const right = b as JsonObject;
    const keys = Object.keys(left);
    const length = keys.length;

    if (length !== Object.keys(right).length) return false;

    for (let i = length; i-- !== 0; ) if (!Object.prototype.hasOwnProperty.call(right, keys[i])) return false;

    for (let i = length; i-- !== 0; ) {
      const key = keys[i];
      if (!_areEquals(left[key], right[key])) return false;
    }

    return true;
  }

  return a !== a && b !== b;
}
