/**
 * Core 适配器模块导出
 */

// 共享工具层
export * from './shared';

// AGUI 适配器
export * from './agui';

// json-render 适配器
export * from './json-render';

// OpenClaw 适配器（依赖 openclaw 协议实现，待适配后启用）
// export * from './openclaw';

// 注意：A2UI 协议已统一并入 json-render 适配器
// - 协议转换：convertA2UIMessagesToJsonRender / applyA2UIUpdates / applyA2UIDataUpdate
// - 状态管理：surfaceStateManager（含 updateSchema / updateData / subscribe 等）
