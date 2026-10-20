// 这里的类型定义在官方Message Schema基础上扩展而来
// https://github.com/ag-ui-protocol/ag-ui/blob/main/sdks/typescript/packages/core/src/types.ts

import { z } from 'zod';
import type { ChatJSONValue, UserMessageContent } from '../../../type';

const isChatJSONValue = (value: unknown): value is ChatJSONValue => {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return true;
  if (Array.isArray(value)) return value.every(isChatJSONValue);
  return typeof value === 'object' && Object.values(value).every(isChatJSONValue);
};

export const ChatJSONValueSchema = z.custom<ChatJSONValue>(isChatJSONValue, 'Expected a JSON value');
export const ChatJSONObjectSchema = z.custom<Record<string, ChatJSONValue>>(
  (value): value is Record<string, ChatJSONValue> =>
    typeof value === 'object' && value !== null && !Array.isArray(value) && isChatJSONValue(value),
  'Expected a JSON object',
);

export const FunctionCallSchema = z.object({
  name: z.string(),
  arguments: z.string(),
});

export const ToolCallSchema = z.object({
  id: z.string(),
  type: z.literal('function'),
  function: FunctionCallSchema,
});

const BaseMessageSchema = z.object({
  id: z.string(),
  role: z.string(),
  content: z.string().optional(),
  name: z.string().optional(),
  timestamp: z.number().optional(), // 添加时间戳字段，用于历史消息
});

const DeveloperMessageSchema = BaseMessageSchema.extend({
  role: z.literal('developer'),
  content: z.string(),
});

const SystemMessageSchema = BaseMessageSchema.extend({
  role: z.literal('system'),
  content: z.string(),
});

const AssistantMessageSchema = BaseMessageSchema.extend({
  role: z.literal('assistant'),
  content: z.string().optional(),
  toolCalls: z.array(ToolCallSchema).optional(),
});

/**
 * 用户消息 Schema
 * content 支持两种格式：
 * 1. 字符串（标准 AG-UI 格式）
 * 2. 数组（已转换为 ChatEngine 的 UserMessageContent[] 格式）
 */
const UserMessageSchema = BaseMessageSchema.extend({
  role: z.literal('user'),
  content: z.union([z.string(), z.array(ChatJSONValueSchema)]),
});

// 扩展类型定义，支持两种 content 格式
export type AGUIUserMessageContent = string | UserMessageContent[];

const ToolMessageSchema = z.object({
  id: z.string(),
  content: z.string(),
  role: z.literal('tool'),
  toolCallId: z.string(),
  timestamp: z.number().optional(),
});

const ActivityMessageSchema = z.object({
  id: z.string(),
  role: z.literal('activity'),
  activityType: z.string(),
  content: ChatJSONObjectSchema,
  timestamp: z.number().optional(),
});

/**
 * Reasoning 消息 Schema（AG-UI Reasoning 规范）
 * - content: 可见的 reasoning 文本（可选，支持仅有 encryptedValue 的场景）
 * - encryptedValue: 加密 chain-of-thought，仅用于跨轮状态延续，客户端原样回传
 * - subtype: 'message' | 'tool-call'，encryptedValue 的归属类型（可选）
 * - entityId: 当 subtype='tool-call' 时指向对应 toolCallId（可选）
 * - title: 展示用的标题（非规范字段，便于 UI 展示）
 * https://docs.ag-ui.com/concepts/events#reasoningmessage
 */
const ReasoningMessageSchema = BaseMessageSchema.extend({
  role: z.literal('reasoning'),
  content: z.string().optional(),
  encryptedValue: z.string().optional(),
  subtype: z.union([z.literal('message'), z.literal('tool-call')]).optional(),
  entityId: z.string().optional(),
  title: z.string().optional(),
});

export const AGUIMessageSchema = z.discriminatedUnion('role', [
  DeveloperMessageSchema,
  SystemMessageSchema,
  AssistantMessageSchema,
  UserMessageSchema,
  ToolMessageSchema,
  ActivityMessageSchema,
  ReasoningMessageSchema,
]);

/**
 * 历史消息相关的类型定义
 *
 */
export const HistoryMessageSchema = z.discriminatedUnion('role', [
  UserMessageSchema,
  AssistantMessageSchema,
  ToolMessageSchema,
  ActivityMessageSchema,
  ReasoningMessageSchema,
]);

export const RoleSchema = z.union([
  z.literal('developer'),
  z.literal('system'),
  z.literal('assistant'),
  z.literal('user'),
  z.literal('tool'),
  z.literal('activity'),
  z.literal('reasoning'),
]);

export const ContextSchema = z.object({
  description: z.string(),
  value: z.string(),
});

export const ToolSchema = z.object({
  name: z.string(),
  description: z.string(),
  parameters: ChatJSONValueSchema, // JSON Schema for the tool parameters
});

/**
 * Interrupt reason 分类法核心值
 *
 * 允许自定义字符串（建议命名空间化，如 `<framework>:<name>`），`core:` 前缀为保留。
 * 客户端遇到未知 reason 不应报错，而应从 message / responseSchema / metadata 渲染。
 * https://docs.ag-ui.com/concepts/interrupts
 */
export const InterruptReason = {
  /** 绑定到特定工具调用的决策，必须设置 toolCallId */
  TOOL_CALL: 'tool_call',
  /** 需要结构化输入，应设置 responseSchema */
  INPUT_REQUIRED: 'input_required',
  /** 独立的是/否确认，responseSchema 可选 */
  CONFIRMATION: 'confirmation',
} as const;

export type InterruptReason = (typeof InterruptReason)[keyof typeof InterruptReason] | (string & {});

/**
 * 中断（Interrupt）Schema
 *
 * 运行在需要人工审批、结构化输入或等待外部决策时暂停，`RunFinished` 事件的
 * `outcome` 会携带一组待处理中断，客户端收集响应后通过下一轮请求的 `resume` 回传。
 * https://docs.ag-ui.com/concepts/interrupts
 */
export const InterruptSchema = z.object({
  /** 关联键，贯穿中断、恢复、幂等与审计 */
  id: z.string(),
  /** 分类路由提示（见 InterruptReason） */
  reason: z.string(),
  /** 人类可读提示，作为通用回退 UI 内容 */
  message: z.string().optional(),
  /** 绑定到之前 ToolCall* 序列的 toolCallId（reason='tool_call' 时必需） */
  toolCallId: z.string().optional(),
  /** 期望 resume.payload 满足的 JSON Schema */
  responseSchema: ChatJSONValueSchema.optional(),
  /** 可选 ISO-8601 有效期，过期后恢复会产生 RunError */
  expiresAt: z.string().optional(),
  /** 框架特定的自由数据 */
  metadata: ChatJSONObjectSchema.optional(),
  /** 引发该中断的子智能体归属 */
  subagentRunId: z.string().optional(),
});

/**
 * 恢复状态
 * - resolved：用户已响应，payload 携带答案（拒绝也在 payload 内表达，如 { approved: false }）
 * - cancelled：用户放弃，应省略 payload
 */
export const ResumeStatusSchema = z.union([z.literal('resolved'), z.literal('cancelled')]);

/**
 * 恢复项 Schema（下一轮 RunAgentInput.resume 的数组元素）
 */
export const ResumeInputSchema = z.object({
  /** 必须引用中断运行中某个 interrupt 的 id */
  interruptId: z.string(),
  status: ResumeStatusSchema,
  /** 用户响应载荷（依 responseSchema 校验），cancelled 时应省略 */
  payload: ChatJSONValueSchema.optional(),
  /** 关于响应的信封数据（如签名、路由键），`ag-ui` 键为保留键 */
  metadata: ChatJSONObjectSchema.optional(),
});

export const RunAgentInputSchema = z.object({
  threadId: z.string(),
  runId: z.string(),
  state: ChatJSONObjectSchema,
  messages: z.array(AGUIMessageSchema),
  tools: z.array(ToolSchema),
  context: z.array(ContextSchema),
  forwardedProps: ChatJSONObjectSchema,
  // 携带对上一轮中断的响应，用于恢复运行（interrupts）
  resume: z.array(ResumeInputSchema).optional(),
});

export const StateSchema = ChatJSONObjectSchema;

export type AGUIToolCall = z.infer<typeof ToolCallSchema>;
export type AGUIFunctionCall = z.infer<typeof FunctionCallSchema>;
export type AGUIDeveloperMessage = z.infer<typeof DeveloperMessageSchema>;
export type AGUISystemMessage = z.infer<typeof SystemMessageSchema>;
export type AGUIAssistantMessage = z.infer<typeof AssistantMessageSchema>;
export type AGUIUserMessage = z.infer<typeof UserMessageSchema>;
export type AGUIToolMessage = z.infer<typeof ToolMessageSchema>;
export type AGUIActivityMessage = z.infer<typeof ActivityMessageSchema>;
export type AGUIReasoningMessage = z.infer<typeof ReasoningMessageSchema>;
export type AGUIMessage = z.infer<typeof AGUIMessageSchema>;
export type AGUIContext = z.infer<typeof ContextSchema>;
export type AGUITool = z.infer<typeof ToolSchema>;
export type RunAgentInput = z.infer<typeof RunAgentInputSchema>;
export type AGUIState = z.infer<typeof StateSchema>;
export type AGUIRole = z.infer<typeof RoleSchema>;
export type Interrupt = z.infer<typeof InterruptSchema>;
export type ResumeStatus = z.infer<typeof ResumeStatusSchema>;
export type ResumeInput = z.infer<typeof ResumeInputSchema>;

// 历史消息类型别名，复用已有的类型
export type AGUIHistoryMessage = AGUIMessage;
export type AGUIUserHistoryMessage = AGUIUserMessage;
export type AGUIAssistantHistoryMessage = AGUIAssistantMessage;
export type AGUIToolHistoryMessage = AGUIToolMessage;
export type AGUIReasoningHistoryMessage = AGUIReasoningMessage;

export class AGUIError extends Error {
  constructor(message: string) {
    super(message);
  }
}
