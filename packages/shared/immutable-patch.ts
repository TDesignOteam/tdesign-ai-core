/**
 * Immutable JSON Patch with Structural Sharing
 *
 * 核心特性：
 * - 只重建被修改路径上的节点
 * - 未修改的节点保持原引用（实现结构共享）
 * - 支持标准 JSON Patch 操作：add, remove, replace, move, copy
 * - 支持扩展操作：append（字符串追加）
 *
 * 性能优势：
 * - 配合 React.memo / useSyncExternalStore 使用时，未变化的组件不会重渲染
 * - 避免深拷贝带来的性能开销
 */

export type Operation =
  | { op: 'add'; path: string; value: JsonValue }
  | { op: 'remove'; path: string }
  | { op: 'replace'; path: string; value: JsonValue }
  | { op: 'move'; path: string; from: string }
  | { op: 'copy'; path: string; from: string }
  | { op: 'append'; path: string; value: string };

export type JsonValue = string | number | boolean | null | JsonObject | JsonArray;
export interface JsonObject {
  [key: string]: JsonValue;
}
export type JsonArray = JsonValue[];
type PatchValue = string | number | boolean | null | PatchObject | PatchArray | undefined;
interface PatchObject {
  [key: string]: PatchValue;
}
type PatchArray = PatchValue[];

function isPatchObject(value: PatchValue): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 解析 JSON Pointer 路径
 * "/elements/deep-progress/props/percentage" => ["elements", "deep-progress", "props", "percentage"]
 */
function parsePath(path: string): string[] {
  if (path === '' || path === '/') return [];
  return path
    .split('/')
    .slice(1)
    .map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
}

/**
 * 获取嵌套值
 */
function getByPath(obj: PatchValue, path: string[]): PatchValue {
  let current = obj;
  for (const key of path) {
    if (current == null) return undefined;
    if (Array.isArray(current)) {
      current = current[Number(key)];
    } else if (isPatchObject(current)) {
      current = current[key];
    } else {
      return undefined;
    }
  }
  return current;
}

/**
 * 不可变地设置嵌套值（结构共享）
 * 只重建路径上的节点，其他节点保持原引用
 */
function setByPath(obj: PatchValue, path: string[], value: PatchValue): PatchValue {
  if (path.length === 0) {
    return value;
  }

  const [head, ...tail] = path;

  if (Array.isArray(obj)) {
    const index = head === '-' ? obj.length : parseInt(head, 10);
    const newArr = [...obj];
    newArr[index] = tail.length === 0 ? value : setByPath(obj[index], tail, value);
    return newArr;
  }

  const current = isPatchObject(obj) ? obj : {};
  const newValue = tail.length === 0 ? value : setByPath(current[head], tail, value);
  return { ...current, [head]: newValue };
}

/**
 * 不可变地删除嵌套值（结构共享）
 */
function removeByPath(obj: PatchValue, path: string[]): PatchValue {
  if (path.length === 0) {
    return undefined;
  }

  const [head, ...tail] = path;

  if (Array.isArray(obj)) {
    const index = parseInt(head, 10);
    const newArr = [...obj];
    if (tail.length === 0) {
      newArr.splice(index, 1);
    } else {
      newArr[index] = removeByPath(obj[index], tail);
    }
    return newArr;
  }

  const current = isPatchObject(obj) ? obj : {};
  if (tail.length === 0) {
    const { [head]: _, ...rest } = current;
    return rest;
  }
  return { ...current, [head]: removeByPath(current[head], tail) };
}

/**
 * 应用单个操作（结构共享）
 */
function cloneJsonValue(value: PatchValue): JsonValue {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function applyOperationImmutable(document: PatchValue, operation: Operation): PatchValue {
  const path = parsePath(operation.path);

  switch (operation.op) {
    case 'add':
    case 'replace':
      return setByPath(document, path, operation.value);

    case 'remove':
      return removeByPath(document, path);

    case 'append': {
      const existing = getByPath(document, path);
      const newValue = existing == null ? operation.value : String(existing) + operation.value;
      return setByPath(document, path, newValue);
    }

    case 'move': {
      const fromPath = parsePath(operation.from);
      const value = getByPath(document, fromPath);
      const afterRemove = removeByPath(document, fromPath);
      return setByPath(afterRemove, path, value);
    }

    case 'copy': {
      const fromPath = parsePath(operation.from);
      const value = getByPath(document, fromPath);
      // 深拷贝 copy 的值，避免共享引用
      return setByPath(document, path, cloneJsonValue(value));
    }

    default:
      return document;
  }
}

/**
 * 应用 JSON Patch 数组（结构共享版本）
 *
 * @param document 原始文档
 * @param patch 操作数组
 * @returns 新文档（未修改的节点保持原引用）
 *
 * @example
 * const tree = { elements: { a: { props: { x: 1 } }, b: { props: { y: 2 } } } };
 * const newTree = applyPatchImmutable(tree, [
 *   { op: 'replace', path: '/elements/a/props/x', value: 10 }
 * ]);
 *
 * // 结构共享验证：
 * tree.elements.b === newTree.elements.b  // true - b 节点未变，保持原引用
 * tree.elements.a === newTree.elements.a  // false - a 节点被修改，是新引用
 */
/**
 * 兼容历史契约：旧 API 承诺补丁结果保持输入泛型 `T`，现有调用方依赖该签名。
 * 内部使用 `PatchValue` 表达 JSON Patch 可替换或删除根节点的真实语义，避免核心算法伪造类型。
 */
export function applyPatchImmutable<T>(document: T, patch: Operation[]): T;
export function applyPatchImmutable(document: unknown, patch: Operation[]): unknown {
  return patch.reduce((doc, op) => applyOperationImmutable(doc as PatchValue, op), document as PatchValue);
}

/**
 * 兼容原有 applyPatch 的返回格式
 */
export function applyPatch<T>(document: T, patch: Operation[]): { newDocument: T } {
  return {
    newDocument: applyPatchImmutable(document, patch),
  };
}
