/**
 * A2UI Action 协议工具（框架无关）
 *
 * 提供两个纯函数：
 * 1. resolveActionParams：把 action.params 中的 `{ path: '/xxx' }` 引用替换为 data model 中的实际值
 * 2. normalizeActionBinding：把不同形态的 action 字段归一化为统一的 ActionBinding 形式
 *
 * 之所以放在 ai-core：
 * - 这两段逻辑只与协议和数据模型相关，不依赖 React
 * - 在自定义协议、Vue 适配、Node 端协议生成等非 React 场景同样需要
 *
 * ---
 *
 * **A2UI Action 规范（v0.9.1 官方）**
 * 参考：https://a2ui.org/concepts/actions/
 *
 * A2UI v0.9.1 定义了两类 action，均包裹在组件 schema 的 `action` 属性对象里：
 *
 *   1) 服务端事件（发送给 Agent）—— 用 `event` 包装：
 *      ```json
 *      { "action": { "event": { "name": "submit", "context": { ... } } } }
 *      ```
 *
 *   2) 客户端本地函数（不发送 Agent，本地执行）—— 用 `functionCall` 包装：
 *      ```json
 *      { "action": { "functionCall": { "call": "openUrl", "args": { ... } } } }
 *      ```
 *
 * 我们把两种官方格式都归一化为**内部统一格式**：
 *   `{ action: string, params: Record<string, unknown>, kind?: 'event' | 'functionCall' }`
 * 其中 `kind` 字段用于业务层区分处理策略（是否路由到本地函数注册表）。
 *
 * 同时向后兼容三种历史/简写格式：
 *   - 字符串简写："submit"
 *   - 内部标准：`{ action, params? }`
 *   - v0.8/legacy 扁平：`{ name, context? }`（旧版 A2UI 及部分早期 mock 数据）
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
 * A2UI v0.9.1 官方服务端事件 payload
 * @see https://a2ui.org/concepts/actions/
 */
export interface A2UIEventAction {
  event: {
    name: string;
    context?: Record<string, unknown>;
  };
}

/**
 * A2UI v0.9.1 官方客户端本地函数 payload
 * @see https://a2ui.org/concepts/actions/
 */
export interface A2UIFunctionCallAction {
  functionCall: {
    call: string;
    args?: Record<string, unknown>;
  };
}

/**
 * 兼容多种 A2UI action 字段形态（v0.9.1 官方 + 历史/简写格式）
 */
export type ActionLike =
  | string
  | (Partial<A2UIEventAction> &
      Partial<A2UIFunctionCallAction> & {
        /** legacy 扁平：v0.8/早期 mock 用 name */
        name?: string;
        /** legacy 扁平：v0.8/早期 mock 用 context */
        context?: Record<string, unknown>;
        /** 内部标准 ActionBinding：action 字符串 */
        action?: string;
        /** 内部标准 ActionBinding：params 参数 */
        params?: Record<string, unknown>;
        confirm?: ActionBinding['confirm'];
        onSuccess?: ActionBinding['onSuccess'];
        onError?: ActionBinding['onError'];
        preventDefault?: boolean;
      });

/**
 * 已归一化的 A2UI action。
 *
 * `params` 仍可能包含 A2UI 的 `{ path }` 绑定，调用方应先使用
 * {@link resolveActionParams} 解析后，再交给只接受 json-render `DynamicValue` 的 ActionBinding 消费者。
 *
 * `kind` 字段用于区分 A2UI v0.9.1 官方定义的两种 action 类型：
 * - `'event'`（默认）：应上报到服务端（Agent）；旧格式和内部标准格式默认按此处理
 * - `'functionCall'`：应路由到本地函数注册表执行，不发消息给服务端
 */
export type NormalizedActionBinding = Omit<ActionBinding, 'params'> & {
  params: Record<string, unknown>;
  /** action 语义类型：v0.9.1 官方 event 或 functionCall（默认为 event） */
  kind?: 'event' | 'functionCall';
};

/**
 * 把不同形态的 action 字段归一化为标准 ActionBinding。
 *
 * 识别优先级（从高到低）：
 * 1. **A2UI v0.9.1 官方 event** ：`{ event: { name, context } }` → `{ action: name, params: context, kind: 'event' }`
 * 2. **A2UI v0.9.1 官方 functionCall**：`{ functionCall: { call, args } }` → `{ action: call, params: args, kind: 'functionCall' }`
 * 3. **内部标准 ActionBinding**：`{ action, params? }`（保留 kind 若已存在）
 * 4. **字符串简写**：`"submit"` → `{ action: 'submit', params: {} }`
 * 5. **legacy 扁平**：`{ name, context? }` → `{ action: name, params: context }`（兼容旧 mock 数据）
 *
 * 多字段共存时按上述优先级；无法识别时返回 null（调用方应当报错）。
 *
 * @returns 归一化后的 A2UI action；当无法识别时返回 null
 */
export function normalizeActionBinding(action: ActionLike | null | undefined): NormalizedActionBinding | null {
  if (!action) return null;

  // 字符串简写
  if (typeof action === 'string') {
    return { action, params: {} };
  }

  const {
    event,
    functionCall,
    name,
    context,
    action: explicitAction,
    params,
    ...bindingOptions
  } = action as {
    event?: A2UIEventAction['event'];
    functionCall?: A2UIFunctionCallAction['functionCall'];
    name?: string;
    context?: Record<string, unknown>;
    action?: string;
    params?: Record<string, unknown>;
    [key: string]: unknown;
  };

  // 1. v0.9.1 官方 event（最高优先级）
  if (isRecord(event) && typeof event.name === 'string' && event.name) {
    return {
      ...(bindingOptions as Omit<NormalizedActionBinding, 'action' | 'params' | 'kind'>),
      action: event.name,
      params: isRecord(event.context) ? event.context : {},
      kind: 'event',
    };
  }

  // 2. v0.9.1 官方 functionCall
  if (isRecord(functionCall) && typeof functionCall.call === 'string' && functionCall.call) {
    return {
      ...(bindingOptions as Omit<NormalizedActionBinding, 'action' | 'params' | 'kind'>),
      action: functionCall.call,
      params: isRecord(functionCall.args) ? functionCall.args : {},
      kind: 'functionCall',
    };
  }

  // 3-5. 扁平 / 简写 / legacy
  const actionName = explicitAction ?? name ?? '';
  if (!actionName) return null;

  return {
    ...(bindingOptions as Omit<NormalizedActionBinding, 'action' | 'params' | 'kind'>),
    action: actionName,
    params: params ?? context ?? {},
  };
}
