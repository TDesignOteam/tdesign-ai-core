/**
 * Surface 状态管理器（框架无关）
 *
 * 职责：
 * 1. 缓存已创建的 Surface Schema（跨消息/跨轮次）
 * 2. 提供订阅机制，当 Surface 数据更新时通知已渲染的组件
 *
 * 使用场景：
 * - 第一轮对话：createSurface + updateComponents → 创建完整 UI，注册到缓存
 * - 后续轮次：仅 updateDataModel → 更新缓存中的数据，通知订阅者重渲染
 *
 * 设计原则：
 * 1. 服务端是状态的单一数据源（updateDataModel 来自服务端）
 * 2. 本模块只负责存储和订阅，不负责 A2UI → JsonRender 的转换
 * 3. 转换逻辑由 a2ui-to-jsonrender.ts 中的函数完成
 * 4. A2UI v0.9.1 只要求 surfaceId 在当前活跃 Surface 中唯一，deleteSurface 后可复用
 */

import type { JsonRenderSchema } from './types/core';
import { applyA2UIDataUpdate } from './a2ui-to-jsonrender';

export interface SurfaceCache {
  /** Surface ID */
  surfaceId: string;
  /** Catalog ID */
  catalogId?: string;
  /** 当前的 json-render Schema */
  schema: JsonRenderSchema;
  /** 创建时间 */
  createdAt: number;
  /** 最后更新时间 */
  updatedAt: number;
}

/** 订阅者回调函数类型 */
export type SurfaceSubscriber = (schema: JsonRenderSchema) => void;

/**
 * Ownership 变化回调
 * @param isOwner 当前调用者是否仍是 owner
 */
export type OwnershipSubscriber = (isOwner: boolean) => void;

/**
 * Owner 令牌类型（推荐用 symbol，保证跨模块唯一）
 */
export type OwnerToken = symbol;

/**
 * Surface 状态管理器
 * 单例模式，全局共享 Surface 缓存
 * 框架无关，不依赖 React 或其他 UI 框架
 *
 * 三层状态管理：
 * 1. surfaces: Surface 数据缓存（schema + dataModel）—— 全局共享
 * 2. subscribers: schema 变化订阅 —— 用于 UI 响应数据变更
 * 3. owners: 显示权归属（每个 surfaceId 唯一 owner，"先到先得"语义）
 *    - 第一个创建 Surface 的 activity 块自动成为 owner，永久拥有显示权
 *    - 后续对同一 surfaceId 的更新会广播到 owner（通过 subscribers），实时反映到 UI
 *    - 产生新 activity 块的会话（用户点击按钮触发的后续 SSE 会话）claim 会失败，
 *      因此它们的 renderer 不渲染 UI —— 符合 A2UI 官方"surfaceId 全局唯一"的语义
 */
class SurfaceStateManager {
  private surfaces: Map<string, SurfaceCache> = new Map();
  /** 订阅者映射：surfaceId → Set<subscriber> */
  private subscribers: Map<string, Set<SurfaceSubscriber>> = new Map();
  /** Ownership 映射：surfaceId → 当前唯一 owner token */
  private owners: Map<string, OwnerToken> = new Map();
  /** Ownership 订阅者映射：surfaceId → Map<owner, callback> */
  private ownershipSubscribers: Map<string, Map<OwnerToken, OwnershipSubscriber>> = new Map();
  private debug: boolean = false;

  /**
   * 设置调试模式
   */
  setDebug(enabled: boolean): void {
    this.debug = enabled;
  }

  /**
   * 注册 Surface（由创建型消息调用）
   *
   * @param surfaceId Surface ID
   * @param schema 转换后的 json-render Schema
   * @param catalogId 可选的 Catalog ID
   */
  registerSurface(surfaceId: string, schema: JsonRenderSchema, catalogId?: string): void {
    const cache: SurfaceCache = {
      surfaceId,
      catalogId,
      schema,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.surfaces.set(surfaceId, cache);

    if (this.debug) {
      console.log('[SurfaceStateManager] 注册 Surface:', {
        surfaceId,
        elementsCount: Object.keys(schema.elements).length,
      });
    }
  }

  /**
   * 更新 Surface 数据（由更新型消息调用）
   *
   * @param surfaceId Surface ID
   * @param path JSON Pointer 路径
   * @param op 操作类型
   * @param value 值
   * @returns 是否成功（Surface 存在）
   */
  updateData(
    surfaceId: string,
    path: string | undefined,
    op: 'add' | 'replace' | 'remove' = 'replace',
    value?: unknown,
  ): boolean {
    const cache = this.surfaces.get(surfaceId);
    if (!cache) {
      if (this.debug) {
        console.warn('[SurfaceStateManager] updateData: Surface 不存在', surfaceId);
      }
      return false;
    }

    // 使用已有的增量更新函数
    cache.schema = applyA2UIDataUpdate(cache.schema, path, op, value);
    cache.updatedAt = Date.now();

    if (this.debug) {
      console.log('[SurfaceStateManager] 更新数据:', {
        surfaceId,
        path,
        op,
        value,
        newData: cache.schema.data,
      });
    }

    // 异步通知订阅者
    this.notifySubscribersAsync(surfaceId, cache.schema);

    return true;
  }

  /**
   * 直接替换 Surface 的 Schema（用于组件树变更后批量更新）
   *
   * 与 registerSurface 的差异：
   * - registerSurface 用于首次创建（不通知订阅者，因为还没有订阅者）
   * - updateSchema 用于已存在 Surface 的 schema 替换，会通知现有订阅者
   *
   * @param surfaceId Surface ID
   * @param schema 新的 json-render Schema
   * @returns 是否成功（Surface 存在）
   */
  updateSchema(surfaceId: string, schema: JsonRenderSchema): boolean {
    const cache = this.surfaces.get(surfaceId);
    if (!cache) {
      if (this.debug) {
        console.warn('[SurfaceStateManager] updateSchema: Surface 不存在', surfaceId);
      }
      return false;
    }

    cache.schema = schema;
    cache.updatedAt = Date.now();

    if (this.debug) {
      console.log('[SurfaceStateManager] 替换 Schema:', {
        surfaceId,
        elementsCount: Object.keys(schema.elements).length,
      });
    }

    this.notifySubscribersAsync(surfaceId, cache.schema);
    return true;
  }

  /**
   * 订阅 Surface 状态变化
   *
   * @param surfaceId Surface ID
   * @param subscriber 订阅者回调
   * @returns 取消订阅函数
   */
  subscribe(surfaceId: string, subscriber: SurfaceSubscriber): () => void {
    if (!this.subscribers.has(surfaceId)) {
      this.subscribers.set(surfaceId, new Set());
    }
    this.subscribers.get(surfaceId)!.add(subscriber);

    if (this.debug) {
      console.log('[SurfaceStateManager] 订阅 Surface:', surfaceId);
    }

    // 返回取消订阅函数
    return () => {
      const subs = this.subscribers.get(surfaceId);
      if (subs) {
        subs.delete(subscriber);
        if (subs.size === 0) {
          this.subscribers.delete(surfaceId);
        }
      }
      if (this.debug) {
        console.log('[SurfaceStateManager] 取消订阅 Surface:', surfaceId);
      }
    };
  }

  /**
   * 异步通知订阅者（避免在渲染期间调用回调）
   */
  private notifySubscribersAsync(surfaceId: string, schema: JsonRenderSchema): void {
    const subs = this.subscribers.get(surfaceId);
    if (!subs || subs.size === 0) {
      return;
    }

    if (this.debug) {
      console.log('[SurfaceStateManager] 准备通知订阅者:', { surfaceId, subscriberCount: subs.size });
    }

    // 使用 queueMicrotask 延迟到当前执行栈完成后执行
    queueMicrotask(() => {
      // 重新获取订阅者（可能在这期间已被取消）
      const currentSubs = this.subscribers.get(surfaceId);
      if (!currentSubs || currentSubs.size === 0) {
        return;
      }

      if (this.debug) {
        console.log('[SurfaceStateManager] 执行通知订阅者:', { surfaceId });
      }

      currentSubs.forEach((subscriber) => {
        try {
          subscriber(schema);
        } catch (e) {
          console.error('[SurfaceStateManager] 订阅者回调出错:', e);
        }
      });
    });
  }

  /**
   * 获取指定 Surface 的缓存
   */
  getSurface(surfaceId: string): SurfaceCache | undefined {
    return this.surfaces.get(surfaceId);
  }

  /**
   * 获取指定 Surface 的 Schema
   */
  getSchema(surfaceId: string): JsonRenderSchema | null {
    return this.surfaces.get(surfaceId)?.schema || null;
  }

  /**
   * 检查 Surface 是否存在
   */
  hasSurface(surfaceId: string): boolean {
    return this.surfaces.has(surfaceId);
  }

  /**
   * 获取所有 Surface ID
   */
  getAllSurfaceIds(): string[] {
    return Array.from(this.surfaces.keys());
  }

  /* ==================== Ownership 机制 ==================== */
  //
  // 用于解决聊天场景多轮对话下"同一 surfaceId 被多个 activity 块 attach，导致
  // 页面上出现多个相同 UI"的问题。"先到先得" 语义：
  //   - 第一个 create/attach 该 Surface 的 renderer 成为唯一 owner，永久显示 UI
  //   - 后续 activity 块的 renderer claim 会失败，它们不渲染 UI（只是消息通道）
  //   - 对该 Surface 的所有 update 通过 subscribers 广播到 owner 的 renderer，实时反映
  //   - owner 主动 unmount 或 deleteSurface 后，owner 位释放，下一个 renderer 可以接管
  //
  // 典型用法（Renderer 侧）：
  //   const myToken = Symbol('myOwner');
  //   surfaceStateManager.subscribeOwnership(surfaceId, myToken, isOwner => {
  //     setIsOwner(isOwner);  // 只有 owner 才渲染 UI
  //   });
  //   const success = surfaceStateManager.claimOwnership(surfaceId, myToken);
  //   // success=false 说明已有 owner，本 renderer 应保持隐藏
  //   // ...
  //   // 组件 unmount 时：
  //   surfaceStateManager.releaseOwnership(surfaceId, myToken);

  /**
   * 认领 Surface 的显示权（"先到先得"语义）
   *
   * 语义：一个 surfaceId 全局唯一 owner。**如果已有 owner，本次 claim 会失败**
   * （不会踢掉旧 owner）——这符合 A2UI "surfaceId 全局唯一" 的官方语义：
   * 一个 Surface 在 UI 上只有一处显示实体，后续对该 Surface 的所有更新都作用于
   * 这一处；产生新 activity 块的会话（比如用户交互触发的后续会话）只是消息通道，
   * 不应产生独立的 UI 显示。
   *
   * @returns 是否成功认领（true=本次成为 owner；false=已有其他 owner）
   */
  claimOwnership(surfaceId: string, token: OwnerToken): boolean {
    const previousOwner = this.owners.get(surfaceId);
    if (previousOwner === token) {
      // 本 token 已经是 owner，no-op
      return true;
    }
    if (previousOwner) {
      // 已有其他 owner，拒绝本次 claim
      if (this.debug) {
        console.log('[SurfaceStateManager] Ownership 已被占用，claim 失败:', surfaceId);
      }
      return false;
    }

    this.owners.set(surfaceId, token);

    if (this.debug) {
      console.log('[SurfaceStateManager] 认领 Surface 显示权（首次）:', surfaceId);
    }

    // 通知订阅了本 surfaceId 的 ownership 订阅者
    // 每个订阅者根据自己是不是当前 owner 得到不同的 isOwner 值
    const subs = this.ownershipSubscribers.get(surfaceId);
    if (subs && subs.size > 0) {
      const snapshot = new Map(subs);
      queueMicrotask(() => {
        snapshot.forEach((callback, owner) => {
          try {
            callback(owner === token);
          } catch (e) {
            console.error('[SurfaceStateManager] ownership 订阅者回调出错:', e);
          }
        });
      });
    }

    return true;
  }

  /**
   * 查询指定 token 是否仍是当前 owner
   */
  isOwner(surfaceId: string, token: OwnerToken): boolean {
    return this.owners.get(surfaceId) === token;
  }

  /**
   * 释放显示权
   *
   * 如果本 token 当前是 owner，则清空 owner 记录（此时 UI 上无任何显示者）；
   * 如果不是 owner，则 no-op（避免误清理别人的 owner 记录）。
   */
  releaseOwnership(surfaceId: string, token: OwnerToken): void {
    if (this.owners.get(surfaceId) === token) {
      this.owners.delete(surfaceId);
      if (this.debug) {
        console.log('[SurfaceStateManager] 释放 Surface 显示权:', surfaceId);
      }
    }
  }

  /**
   * 订阅 ownership 变化
   *
   * @param surfaceId 目标 Surface
   * @param token     订阅者的 token（同时也是 owner 身份标识）
   * @param callback  ownership 变化回调，参数为"本 token 是否仍是 owner"
   * @returns 取消订阅函数
   */
  subscribeOwnership(surfaceId: string, token: OwnerToken, callback: OwnershipSubscriber): () => void {
    if (!this.ownershipSubscribers.has(surfaceId)) {
      this.ownershipSubscribers.set(surfaceId, new Map());
    }
    this.ownershipSubscribers.get(surfaceId)!.set(token, callback);

    return () => {
      const subs = this.ownershipSubscribers.get(surfaceId);
      if (subs) {
        subs.delete(token);
        if (subs.size === 0) {
          this.ownershipSubscribers.delete(surfaceId);
        }
      }
    };
  }

  /* ==================== 生命周期结束 ==================== */

  /**
   * 删除 Surface（由 deleteSurface 消息调用）
   *
   * 关键设计：删除前先通知所有订阅者一次（用当前 schema 或触发 rerender）。
   * 订阅者拿到通知后会重新调用 getSchema/hasSurface，此时 Surface 已删 → 返回 null，
   * 订阅者据此卸载对应 UI。若不先通知就删除，订阅集合被清空后没人再能感知变化，
   * 导致已挂载的 UI 无法响应 Surface 被删除的事件。
   */
  deleteSurface(surfaceId: string): boolean {
    // 步骤 1：先取出订阅者引用（顺序敏感，后面会 delete 掉整个集合）
    const subs = this.subscribers.get(surfaceId);
    const cachedSchema = this.surfaces.get(surfaceId)?.schema;
    const ownershipSubs = this.ownershipSubscribers.get(surfaceId);

    // 步骤 2：从 surfaces 里删除，此时 getSchema/hasSurface 已返回 null/false
    const deleted = this.surfaces.delete(surfaceId);

    // 步骤 3：删除后通知订阅者（此时 getSchema 已返回 null，订阅者会自行卸载）
    // 用 queueMicrotask 保证在当前执行栈完成后执行，避免在 React commit 期间触发状态更新
    if (subs && subs.size > 0) {
      const subsSnapshot = new Set(subs);
      queueMicrotask(() => {
        subsSnapshot.forEach((subscriber) => {
          try {
            // 传入原 schema 只是为了兼容签名；订阅者应该通过 getSchema 重新读取来判断
            // Surface 是否还存在（此时会得到 null）
            subscriber(cachedSchema as JsonRenderSchema);
          } catch (e) {
            console.error('[SurfaceStateManager] deleteSurface 通知订阅者出错:', e);
          }
        });
      });
    }

    // 步骤 4：通知所有 ownership 订阅者"卸任"（用 isOwner=false 触发）
    if (ownershipSubs && ownershipSubs.size > 0) {
      const ownershipSnapshot = new Map(ownershipSubs);
      queueMicrotask(() => {
        ownershipSnapshot.forEach((callback) => {
          try {
            callback(false);
          } catch (e) {
            console.error('[SurfaceStateManager] deleteSurface 通知 ownership 订阅者出错:', e);
          }
        });
      });
    }

    // 步骤 5：清空各类订阅集合和 owner 记录
    this.subscribers.delete(surfaceId);
    this.ownershipSubscribers.delete(surfaceId);
    this.owners.delete(surfaceId);

    if (this.debug && deleted) {
      console.log('[SurfaceStateManager] 删除 Surface:', surfaceId, {
        notifiedSubscribers: subs?.size || 0,
        notifiedOwnershipSubscribers: ownershipSubs?.size || 0,
      });
    }

    return deleted;
  }

  /**
   * 清除所有 Surface 缓存
   */
  clearAll(): void {
    this.surfaces.clear();
    this.subscribers.clear();
    this.owners.clear();
    this.ownershipSubscribers.clear();
    if (this.debug) {
      console.log('[SurfaceStateManager] 清除所有缓存');
    }
  }

  /**
   * 获取缓存统计信息
   */
  getStats(): {
    count: number;
    surfaces: Array<{ id: string; elementsCount: number; updatedAt: number; subscriberCount: number }>;
  } {
    const surfaces = Array.from(this.surfaces.entries()).map(([id, cache]) => ({
      id,
      elementsCount: Object.keys(cache.schema.elements).length,
      updatedAt: cache.updatedAt,
      subscriberCount: this.subscribers.get(id)?.size || 0,
    }));

    return {
      count: this.surfaces.size,
      surfaces,
    };
  }
}

// 导出单例实例
export const surfaceStateManager = new SurfaceStateManager();

// 导出类供测试或创建独立实例
export { SurfaceStateManager };
