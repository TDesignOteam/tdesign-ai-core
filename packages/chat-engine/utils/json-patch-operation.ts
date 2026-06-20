/**
 * JSON Patch 操作类型（chat-engine 本地定义，避免 DTS 跨包引用 @tdesign/ai-shared）
 */
export type JsonPatchOperation =
  | { op: 'add'; path: string; value: unknown }
  | { op: 'remove'; path: string }
  | { op: 'replace'; path: string; value: unknown }
  | { op: 'move'; path: string; from: string }
  | { op: 'copy'; path: string; from: string }
  | { op: 'append'; path: string; value: string };
