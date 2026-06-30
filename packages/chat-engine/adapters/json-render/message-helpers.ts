/**
 * A2UI 消息分析工具（框架无关）
 *
 * 提供一组纯函数，用于在分发处理 A2UI v0.9.1 消息流前做"分类 / 分组 / 抽取"工作。
 * 这些工具不依赖 React，可在任意协议层 / SSR / 服务端复用。
 */

import type { A2UIMessage } from './types/a2ui';

/**
 * 从一批消息中抽取首个 surfaceId
 * 顺序：createSurface > updateComponents > updateDataModel > deleteSurface
 *
 * @returns 找到则返回 surfaceId，否则返回 null
 */
export function extractSurfaceId(messages: A2UIMessage[]): string | null {
  for (const msg of messages) {
    if (msg.createSurface) return msg.createSurface.surfaceId;
    if (msg.updateComponents) return msg.updateComponents.surfaceId;
    if (msg.updateDataModel) return msg.updateDataModel.surfaceId;
    if (msg.deleteSurface) return msg.deleteSurface.surfaceId;
  }
  return null;
}

/**
 * 判断这一批消息是否为"UI 型"——包含 createSurface / updateComponents / deleteSurface
 *
 * 反义：仅含 updateDataModel 的批次属于"纯数据型"，无需重新渲染 UI
 */
export function isUIMessages(messages: A2UIMessage[]): boolean {
  return messages.some((msg) => msg.createSurface || msg.updateComponents || msg.deleteSurface);
}

/**
 * 判断这一批消息是否包含删除操作
 */
export function hasDeletionMessages(messages: A2UIMessage[]): boolean {
  return messages.some((msg) => msg.deleteSurface);
}

/**
 * 判断这一批消息是否包含创建/更新操作（需要渲染 UI）
 */
export function hasCreationMessages(messages: A2UIMessage[]): boolean {
  return messages.some((msg) => msg.createSurface || msg.updateComponents);
}

/**
 * 把一批 A2UI 消息按 surfaceId 分组
 *
 * 对于多 Surface 同批到达的场景（一个 chunk 同时操作多个 Surface），
 * 调用方可以按组分别派发，避免互相干扰。
 *
 * 没有 surfaceId 的消息会被丢弃（理论上不应出现，做容错）。
 */
export function groupMessagesBySurface(messages: A2UIMessage[]): Map<string, A2UIMessage[]> {
  const map = new Map<string, A2UIMessage[]>();
  for (const msg of messages) {
    let surfaceId: string | undefined;
    if (msg.createSurface) surfaceId = msg.createSurface.surfaceId;
    else if (msg.updateComponents) surfaceId = msg.updateComponents.surfaceId;
    else if (msg.updateDataModel) surfaceId = msg.updateDataModel.surfaceId;
    else if (msg.deleteSurface) surfaceId = msg.deleteSurface.surfaceId;

    if (!surfaceId) continue;
    const arr = map.get(surfaceId);
    if (arr) arr.push(msg);
    else map.set(surfaceId, [msg]);
  }
  return map;
}
