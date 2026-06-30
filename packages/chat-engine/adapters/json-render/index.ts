/**
 * json-render 适配器模块
 * 框架无关的 json-render 核心逻辑
 */

// A2UI 适配器
export * from './a2ui-to-jsonrender';
export * from './types/a2ui';

export { SurfaceStateManager, surfaceStateManager } from './SurfaceStateManager';

// A2UI Action 协议工具（resolveActionParams / normalizeActionBinding）
export * from './action-binding';

// A2UI 消息分析工具（extractSurfaceId / isUIMessages / hasDeletionMessages / hasCreationMessages / groupMessagesBySurface）
export * from './message-helpers';

// 类型定义
export * from './types';
