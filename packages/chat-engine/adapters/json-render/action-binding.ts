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
 * 把 params 里形如 `{ path: '/userInfo/name' }` 的引用替换为 data 中的实际值。
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
      Object.assign(target, source);
      continue;
    }

    for (const [key, value] of Object.entries(source)) {
      if (value && typeof value === 'object' && 'path' in value) {
        // 动态绑定：{ path: '/userInfo' } → 实际数据
        const pathValue = (value as { path: string }).path;
        target[key] = getByPath(data as any, pathValue);
      } else if (value && typeof value === 'object' && !Array.isArray(value)) {
        // 嵌套对象，加入栈处理
        const nestedTarget: Record<string, unknown> = {};
        target[key] = nestedTarget;
        stack.push({
          source: value as Record<string, unknown>,
          target: nestedTarget,
          depth: depth + 1,
        });
      } else {
        // 静态值（含数组、原始值）直接保留
        target[key] = value;
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
  | (ActionBinding & { name?: string; context?: Record<string, unknown> })
  | { name?: string; context?: Record<string, unknown>; action?: string; params?: Record<string, unknown> };

/**
 * 把不同形态的 action 字段归一化为标准 ActionBinding
 *
 * 兼容三种输入：
 * 1. 字符串简写："submit" → { action: 'submit', params: {} }
 * 2. 标准 ActionBinding：{ action, params? }
 * 3. 旧版 A2UI / mock 数据：{ name, context? } → { action: name, params: context }
 *
 * @returns 归一化后的 ActionBinding；当无法识别时返回 null（调用方应当报错）
 */
export function normalizeActionBinding(action: ActionLike | null | undefined): ActionBinding | null {
  if (!action) return null;

  if (typeof action === 'string') {
    return { action, params: {} };
  }

  const raw = action as ActionBinding & { name?: string; context?: Record<string, unknown> };
  const actionName = raw.action ?? raw.name ?? '';
  if (!actionName) return null;

  return {
    ...raw,
    action: actionName,
    params: raw.params ?? raw.context ?? {},
  };
}
