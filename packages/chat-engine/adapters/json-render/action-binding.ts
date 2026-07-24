/**
 * A2UI Action 协议工具（框架无关）
 *
 * 提供两个纯函数：
 * 1. resolveActionParams：把 action.params 中的 `{ path: '/xxx' }` 引用替换为 data model 中的实际值
 * 2. normalizeActionBinding：把不同形态的 action 字段（字符串简写 / ActionBinding / 旧版 A2UI {name, context}）归一化为统一的 ActionBinding 形式
 *
 * 之所以放在 ai-core：
 * - 这两段逻辑只与协议和数据模型相关，不依赖 React
 * - 在自定义协议、Vue 适配、Node 端协议生成等非 React 场景同样需要
 */

import { getByPath } from '@json-render/core';
import type { ActionBinding } from '@json-render/core';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPathBinding(value: unknown): value is { path: string } {
  return isRecord(value) && typeof value.path === 'string' && Object.keys(value).length === 1;
}

function setActionParam(target: Record<string, unknown>, key: string, value: unknown): void {
  // 兼容历史 action params：constructor / prototype / __proto__ 都应作为普通业务参数保留。
  // 使用 defineProperty 写入，避免 `__proto__` 经过对象 setter 触发原型变更。
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

/**
 * resolveActionParams 配置
 */
export interface ResolveActionParamsOptions {
  /** 防止无限递归的最大深度，默认 10 */
  maxDepth?: number;
}

/**
 * 解析 action params 中的动态数据绑定
 *
 * 把 params 里形如 `{ path: '/userInfo/name' }` 的纯绑定对象替换为 data 中的实际值。
 * 含有额外字段的对象会被视为业务对象保留，避免误吞业务参数。
 * 支持嵌套对象，使用栈迭代实现，避免深递归调用栈过长。
 *
 * @param params 待解析的参数对象（一般来自 action.params 或 action.context）
 * @param data  当前数据模型
 * @param options 可选配置
 * @returns 解析后的新对象（不修改入参）
 *
 * @example
 * resolveActionParams(
 *   { name: { path: '/userInfo/name' }, kind: 'submit' },
 *   { userInfo: { name: 'Alice' } },
 * );
 * // => { name: 'Alice', kind: 'submit' }
 */
export function resolveActionParams(
  params: Record<string, unknown>,
  data: Record<string, unknown>,
  options: ResolveActionParamsOptions = {},
): Record<string, unknown> {
  const { maxDepth = 10 } = options;
  const resolved: Record<string, unknown> = {};

  // 用栈迭代代替递归，避免调用栈过深
  const stack: Array<{
    source: Record<string, unknown>;
    target: Record<string, unknown>;
    depth: number;
  }> = [{ source: params, target: resolved, depth: 0 }];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) break;
    const { source, target, depth } = current;

    if (depth >= maxDepth) {
      // 防止无限递归：超过深度后整个对象按值拷贝放入
      for (const [key, value] of Object.entries(source)) {
        setActionParam(target, key, value);
      }
      continue;
    }

    for (const [key, value] of Object.entries(source)) {
      if (isPathBinding(value)) {
        // 动态绑定：{ path: '/userInfo' } → 实际数据
        setActionParam(target, key, getByPath(data, value.path));
      } else if (isRecord(value)) {
        // 嵌套对象，加入栈处理
        const nestedTarget: Record<string, unknown> = {};
        setActionParam(target, key, nestedTarget);
        stack.push({
          source: value,
          target: nestedTarget,
          depth: depth + 1,
        });
      } else {
        // 静态值（含数组、原始值）直接保留
        setActionParam(target, key, value);
      }
    }
  }

  return resolved;
}

/**
 * 兼容旧版 A2UI 协议的 action 字段形态
 */
export type ActionLike =
  | string
  | {
      name?: string;
      context?: Record<string, unknown>;
      action?: string;
      params?: Record<string, unknown>;
      confirm?: ActionBinding['confirm'];
      onSuccess?: ActionBinding['onSuccess'];
      onError?: ActionBinding['onError'];
      preventDefault?: boolean;
    };

/**
 * 已归一化的 A2UI action。
 *
 * `params` 仍可能包含 A2UI 的 `{ path }` 绑定，调用方应先使用
 * {@link resolveActionParams} 解析后，再交给只接受 json-render `DynamicValue` 的 ActionBinding 消费者。
 */
export type NormalizedActionBinding = Omit<ActionBinding, 'params'> & {
  params: Record<string, unknown>;
};

/**
 * 把不同形态的 action 字段归一化为标准 ActionBinding
 *
 * 兼容三种输入：
 * 1. 字符串简写："submit" → { action: 'submit', params: {} }
 * 2. 标准 ActionBinding：{ action, params? }
 * 3. 旧版 A2UI / mock 数据：{ name, context? } → { action: name, params: context }
 *
 * @returns 归一化后的 A2UI action；当无法识别时返回 null（调用方应当报错）
 */
export function normalizeActionBinding(action: ActionLike | null | undefined): NormalizedActionBinding | null {
  if (!action) return null;

  if (typeof action === 'string') {
    return { action, params: {} };
  }

  const { name, context, action: explicitAction, params, ...bindingOptions } = action;
  const actionName = explicitAction ?? name ?? '';
  if (!actionName) return null;

  return {
    ...bindingOptions,
    action: actionName,
    params: params ?? context ?? {},
  };
}
