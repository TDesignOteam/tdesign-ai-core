import { z } from 'zod';

import { AGUIMessageSchema, StateSchema } from '.';

export type ToolCallEventType =
  | 'TOOL_CALL_START'
  | 'TOOL_CALL_ARGS'
  | 'TOOL_CALL_END'
  | 'TOOL_CALL_CHUNK'
  | 'TOOL_CALL_RESULT';

export enum AGUIEventType {
  TEXT_MESSAGE_START = 'TEXT_MESSAGE_START',
  TEXT_MESSAGE_CONTENT = 'TEXT_MESSAGE_CONTENT',
  TEXT_MESSAGE_END = 'TEXT_MESSAGE_END',
  TEXT_MESSAGE_CHUNK = 'TEXT_MESSAGE_CHUNK',

  // Reasoning 事件（AG-UI 当前规范）
  // https://docs.ag-ui.com/concepts/reasoning
  REASONING_START = 'REASONING_START',
  REASONING_END = 'REASONING_END',
  REASONING_MESSAGE_START = 'REASONING_MESSAGE_START',
  REASONING_MESSAGE_CONTENT = 'REASONING_MESSAGE_CONTENT',
  REASONING_MESSAGE_END = 'REASONING_MESSAGE_END',
  REASONING_MESSAGE_CHUNK = 'REASONING_MESSAGE_CHUNK',
  REASONING_ENCRYPTED_VALUE = 'REASONING_ENCRYPTED_VALUE',

  /** @deprecated use REASONING_START */
  THINKING_START = 'THINKING_START',
  /** @deprecated use REASONING_END */
  THINKING_END = 'THINKING_END',
  /** @deprecated use REASONING_MESSAGE_START */
  THINKING_TEXT_MESSAGE_START = 'THINKING_TEXT_MESSAGE_START',
  /** @deprecated use REASONING_MESSAGE_CONTENT */
  THINKING_TEXT_MESSAGE_CONTENT = 'THINKING_TEXT_MESSAGE_CONTENT',
  /** @deprecated use REASONING_MESSAGE_END */
  THINKING_TEXT_MESSAGE_END = 'THINKING_TEXT_MESSAGE_END',

  TOOL_CALL_START = 'TOOL_CALL_START',
  TOOL_CALL_ARGS = 'TOOL_CALL_ARGS',
  TOOL_CALL_END = 'TOOL_CALL_END',
  TOOL_CALL_CHUNK = 'TOOL_CALL_CHUNK',
  TOOL_CALL_RESULT = 'TOOL_CALL_RESULT',

  ACTIVITY_SNAPSHOT = 'ACTIVITY_SNAPSHOT',
  ACTIVITY_DELTA = 'ACTIVITY_DELTA',

  STATE_SNAPSHOT = 'STATE_SNAPSHOT',
  STATE_DELTA = 'STATE_DELTA',
  MESSAGES_SNAPSHOT = 'MESSAGES_SNAPSHOT',
  RAW = 'RAW',
  CUSTOM = 'CUSTOM',
  RUN_STARTED = 'RUN_STARTED',
  RUN_FINISHED = 'RUN_FINISHED',
  RUN_ERROR = 'RUN_ERROR',
  STEP_STARTED = 'STEP_STARTED',
  STEP_FINISHED = 'STEP_FINISHED',
}

/**
 * 检查事件类型是否为文本消息相关
 * @param eventType 事件类型
 * @returns 是否为文本消息事件
 */
export function isTextMessageEvent(eventType: string): boolean {
  return ['TEXT_MESSAGE_START', 'TEXT_MESSAGE_CHUNK', 'TEXT_MESSAGE_CONTENT', 'TEXT_MESSAGE_END'].includes(eventType);
}

/**
 * 检查事件类型是否为 reasoning / thinking 相关
 *
 * 同时覆盖当前 AG-UI 规范的 REASONING_* 事件以及已废弃的 THINKING_* 事件，
 * 两者在内部按相同语义处理，直到上游彻底下线 THINKING_* 后可移除兼容分支。
 *
 * @param eventType 事件类型
 * @returns 是否为 reasoning 事件
 */
export function isReasoningEvent(eventType: string): boolean {
  return [
    'REASONING_START',
    'REASONING_END',
    'REASONING_MESSAGE_START',
    'REASONING_MESSAGE_CONTENT',
    'REASONING_MESSAGE_END',
    'REASONING_MESSAGE_CHUNK',
    'REASONING_ENCRYPTED_VALUE',
    // Deprecated thinking events - kept for backward compatibility
    'THINKING_START',
    'THINKING_END',
    'THINKING_TEXT_MESSAGE_START',
    'THINKING_TEXT_MESSAGE_CONTENT',
    'THINKING_TEXT_MESSAGE_END',
  ].includes(eventType);
}

/**
 * @deprecated use {@link isReasoningEvent}
 */
export const isThinkingEvent = isReasoningEvent;

/**
 * 检查事件类型是否为工具调用相关
 * @param eventType 事件类型
 * @returns 是否为工具调用事件
 */
export function isToolCallEvent(eventType: string): boolean {
  return ['TOOL_CALL_START', 'TOOL_CALL_ARGS', 'TOOL_CALL_CHUNK', 'TOOL_CALL_RESULT', 'TOOL_CALL_END'].includes(
    eventType,
  );
}

/**
 * 检查事件类型是否为活动相关
 * @param eventType 事件类型
 * @returns 是否为活动事件
 */
export function isActivityEvent(eventType: string): boolean {
  return ['ACTIVITY_SNAPSHOT', 'ACTIVITY_DELTA'].includes(eventType);
}

/**
 * 检查事件类型是否为状态相关
 * @param eventType 事件类型
 * @returns 是否为状态事件
 */
export function isStateEvent(eventType: string): boolean {
  return ['STATE_SNAPSHOT', 'STATE_DELTA'].includes(eventType);
}

const BaseEventSchema = z.object({
  type: z.nativeEnum(AGUIEventType),
  timestamp: z.number().optional(),
  rawEvent: z.any().optional(),
});

export const TextMessageStartEventSchema = BaseEventSchema.extend({
  type: z.literal(AGUIEventType.TEXT_MESSAGE_START),
  messageId: z.string(),
  role: z.literal('assistant'),
});

export const TextMessageContentEventSchema = BaseEventSchema.extend({
  type: z.literal(AGUIEventType.TEXT_MESSAGE_CONTENT),
  messageId: z.string(),
  delta: z.string().refine((s) => s.length > 0, 'Delta must not be an empty string'),
});

export const TextMessageEndEventSchema = BaseEventSchema.extend({
  type: z.literal(AGUIEventType.TEXT_MESSAGE_END),
  messageId: z.string(),
});

export const TextMessageChunkEventSchema = BaseEventSchema.extend({
  type: z.literal(AGUIEventType.TEXT_MESSAGE_CHUNK),
  messageId: z.string().optional(),
  role: z.literal('assistant').optional(),
  delta: z.string().optional(),
});

/**
 * @deprecated use {@link ReasoningMessageStartEventSchema}
 */
export const ThinkingTextMessageStartEventSchema = BaseEventSchema.extend({
  type: z.literal(AGUIEventType.THINKING_TEXT_MESSAGE_START),
});

/**
 * @deprecated use {@link ReasoningMessageContentEventSchema}
 */
export const ThinkingTextMessageContentEventSchema = TextMessageContentEventSchema.omit({
  messageId: true,
  type: true,
}).extend({
  type: z.literal(AGUIEventType.THINKING_TEXT_MESSAGE_CONTENT),
});

/**
 * @deprecated use {@link ReasoningMessageEndEventSchema}
 */
export const ThinkingTextMessageEndEventSchema = BaseEventSchema.extend({
  type: z.literal(AGUIEventType.THINKING_TEXT_MESSAGE_END),
});

// ===== Reasoning events (AG-UI current spec) =====

export const ReasoningStartEventSchema = BaseEventSchema.extend({
  type: z.literal(AGUIEventType.REASONING_START),
  messageId: z.string().optional(),
});

export const ReasoningEndEventSchema = BaseEventSchema.extend({
  type: z.literal(AGUIEventType.REASONING_END),
  messageId: z.string().optional(),
});

export const ReasoningMessageStartEventSchema = BaseEventSchema.extend({
  type: z.literal(AGUIEventType.REASONING_MESSAGE_START),
  messageId: z.string(),
  role: z.literal('reasoning').optional(),
});

export const ReasoningMessageContentEventSchema = BaseEventSchema.extend({
  type: z.literal(AGUIEventType.REASONING_MESSAGE_CONTENT),
  messageId: z.string(),
  delta: z.string(),
});

export const ReasoningMessageEndEventSchema = BaseEventSchema.extend({
  type: z.literal(AGUIEventType.REASONING_MESSAGE_END),
  messageId: z.string(),
});

export const ReasoningMessageChunkEventSchema = BaseEventSchema.extend({
  type: z.literal(AGUIEventType.REASONING_MESSAGE_CHUNK),
  messageId: z.string().optional(),
  role: z.literal('reasoning').optional(),
  delta: z.string().optional(),
});

export const ReasoningEncryptedValueEventSchema = BaseEventSchema.extend({
  type: z.literal(AGUIEventType.REASONING_ENCRYPTED_VALUE),
  subtype: z.union([z.literal('message'), z.literal('tool-call')]),
  entityId: z.string(),
  encryptedValue: z.string(),
});

export const ToolCallStartEventSchema = BaseEventSchema.extend({
  type: z.literal(AGUIEventType.TOOL_CALL_START),
  toolCallId: z.string(),
  toolCallName: z.string(),
  parentMessageId: z.string().optional(),
});

export const ToolCallArgsEventSchema = BaseEventSchema.extend({
  type: z.literal(AGUIEventType.TOOL_CALL_ARGS),
  toolCallId: z.string(),
  delta: z.string(),
});

export const ToolCallEndEventSchema = BaseEventSchema.extend({
  type: z.literal(AGUIEventType.TOOL_CALL_END),
  toolCallId: z.string(),
});

export const ToolCallResultEventSchema = BaseEventSchema.extend({
  messageId: z.string(),
  type: z.literal(AGUIEventType.TOOL_CALL_RESULT),
  toolCallId: z.string(),
  toolCallName: z.string(),
  content: z.string(),
  role: z.literal('tool').optional(),
});

export const ToolCallChunkEventSchema = BaseEventSchema.extend({
  type: z.literal(AGUIEventType.TOOL_CALL_CHUNK),
  toolCallId: z.string().optional(),
  toolCallName: z.string().optional(),
  parentMessageId: z.string().optional(),
  delta: z.string().optional(),
});

export const ActivitySnapshotEventSchema = BaseEventSchema.extend({
  type: z.literal(AGUIEventType.ACTIVITY_SNAPSHOT),
  messageId: z.string().optional(),
  activityType: z.string(),
  content: z.record(z.any()),
  replace: z.boolean().optional(),
});

export const ActivityDeltaEventSchema = BaseEventSchema.extend({
  type: z.literal(AGUIEventType.ACTIVITY_DELTA),
  messageId: z.string().optional(),
  activityType: z.string().optional(),
  patch: z.array(z.any()).optional(), // JSON Patch (RFC 6902)
});

export const ThinkingStartEventSchema = BaseEventSchema.extend({
  type: z.literal(AGUIEventType.THINKING_START),
  title: z.string().optional(),
});

export const ThinkingEndEventSchema = BaseEventSchema.extend({
  type: z.literal(AGUIEventType.THINKING_END),
  title: z.string().optional(),
});

export const StateSnapshotEventSchema = BaseEventSchema.extend({
  type: z.literal(AGUIEventType.STATE_SNAPSHOT),
  snapshot: StateSchema,
});

export const StateDeltaEventSchema = BaseEventSchema.extend({
  type: z.literal(AGUIEventType.STATE_DELTA),
  delta: z.array(z.any()), // JSON Patch (RFC 6902)
});

export const MessagesSnapshotEventSchema = BaseEventSchema.extend({
  type: z.literal(AGUIEventType.MESSAGES_SNAPSHOT),
  messages: z.array(AGUIMessageSchema),
});

export const RawEventSchema = BaseEventSchema.extend({
  type: z.literal(AGUIEventType.RAW),
  event: z.any(),
  source: z.string().optional(),
});

export const CustomEventSchema = BaseEventSchema.extend({
  type: z.literal(AGUIEventType.CUSTOM),
  name: z.string(),
  value: z.any(),
});

export const RunStartedEventSchema = BaseEventSchema.extend({
  type: z.literal(AGUIEventType.RUN_STARTED),
  threadId: z.string(),
  runId: z.string(),
});

export const RunFinishedEventSchema = BaseEventSchema.extend({
  type: z.literal(AGUIEventType.RUN_FINISHED),
  threadId: z.string(),
  runId: z.string(),
  result: z.any().optional(),
});

export const RunErrorEventSchema = BaseEventSchema.extend({
  type: z.literal(AGUIEventType.RUN_ERROR),
  message: z.string(),
  code: z.string().optional(),
});

export const StepStartedEventSchema = BaseEventSchema.extend({
  type: z.literal(AGUIEventType.STEP_STARTED),
  stepName: z.string(),
});

export const StepFinishedEventSchema = BaseEventSchema.extend({
  type: z.literal(AGUIEventType.STEP_FINISHED),
  stepName: z.string(),
});

export const EventSchemas = z.discriminatedUnion('type', [
  TextMessageStartEventSchema,
  TextMessageContentEventSchema,
  TextMessageEndEventSchema,
  TextMessageChunkEventSchema,
  ThinkingTextMessageStartEventSchema,
  ThinkingTextMessageContentEventSchema,
  ThinkingTextMessageEndEventSchema,
  ReasoningStartEventSchema,
  ReasoningEndEventSchema,
  ReasoningMessageStartEventSchema,
  ReasoningMessageContentEventSchema,
  ReasoningMessageEndEventSchema,
  ReasoningMessageChunkEventSchema,
  ReasoningEncryptedValueEventSchema,
  ToolCallStartEventSchema,
  ToolCallArgsEventSchema,
  ToolCallEndEventSchema,
  ToolCallChunkEventSchema,
  ToolCallResultEventSchema,
  ActivitySnapshotEventSchema,
  ActivityDeltaEventSchema,
  StateSnapshotEventSchema,
  StateDeltaEventSchema,
  MessagesSnapshotEventSchema,
  RawEventSchema,
  CustomEventSchema,
  RunStartedEventSchema,
  RunFinishedEventSchema,
  RunErrorEventSchema,
  StepStartedEventSchema,
  StepFinishedEventSchema,
]);

export type BaseEvent = z.infer<typeof BaseEventSchema>;
export type TextMessageStartEvent = z.infer<typeof TextMessageStartEventSchema>;
export type TextMessageContentEvent = z.infer<typeof TextMessageContentEventSchema>;
export type TextMessageEndEvent = z.infer<typeof TextMessageEndEventSchema>;
export type TextMessageChunkEvent = z.infer<typeof TextMessageChunkEventSchema>;
export type ThinkingTextMessageStartEvent = z.infer<typeof ThinkingTextMessageStartEventSchema>;
export type ThinkingTextMessageContentEvent = z.infer<typeof ThinkingTextMessageContentEventSchema>;
export type ThinkingTextMessageEndEvent = z.infer<typeof ThinkingTextMessageEndEventSchema>;
export type ToolCallStartEvent = z.infer<typeof ToolCallStartEventSchema>;
export type ToolCallArgsEvent = z.infer<typeof ToolCallArgsEventSchema>;
export type ToolCallEndEvent = z.infer<typeof ToolCallEndEventSchema>;
export type ToolCallChunkEvent = z.infer<typeof ToolCallChunkEventSchema>;
export type ToolCallResultEvent = z.infer<typeof ToolCallResultEventSchema>;
export type ActivitySnapshotEvent = z.infer<typeof ActivitySnapshotEventSchema>;
export type ActivityDeltaEvent = z.infer<typeof ActivityDeltaEventSchema>;
/** @deprecated use {@link ReasoningStartEvent} */
export type ThinkingStartEvent = z.infer<typeof ThinkingStartEventSchema>;
/** @deprecated use {@link ReasoningEndEvent} */
export type ThinkingEndEvent = z.infer<typeof ThinkingEndEventSchema>;
export type ReasoningStartEvent = z.infer<typeof ReasoningStartEventSchema>;
export type ReasoningEndEvent = z.infer<typeof ReasoningEndEventSchema>;
export type ReasoningMessageStartEvent = z.infer<typeof ReasoningMessageStartEventSchema>;
export type ReasoningMessageContentEvent = z.infer<typeof ReasoningMessageContentEventSchema>;
export type ReasoningMessageEndEvent = z.infer<typeof ReasoningMessageEndEventSchema>;
export type ReasoningMessageChunkEvent = z.infer<typeof ReasoningMessageChunkEventSchema>;
export type ReasoningEncryptedValueEvent = z.infer<typeof ReasoningEncryptedValueEventSchema>;
export type StateSnapshotEvent = z.infer<typeof StateSnapshotEventSchema>;
export type StateDeltaEvent = z.infer<typeof StateDeltaEventSchema>;
export type MessagesSnapshotEvent = z.infer<typeof MessagesSnapshotEventSchema>;
export type RawEvent = z.infer<typeof RawEventSchema>;
export type CustomEvent = z.infer<typeof CustomEventSchema>;
export type RunStartedEvent = z.infer<typeof RunStartedEventSchema>;
export type RunFinishedEvent = z.infer<typeof RunFinishedEventSchema>;
export type RunErrorEvent = z.infer<typeof RunErrorEventSchema>;
export type StepStartedEvent = z.infer<typeof StepStartedEventSchema>;
export type StepFinishedEvent = z.infer<typeof StepFinishedEventSchema>;
