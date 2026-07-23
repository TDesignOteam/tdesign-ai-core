import type {
  ActivityData,
  AIMessageContent,
  ChatBaseContent,
  ChatJSONObject,
  ChatJSONValue,
  CustomContent,
  DynamicActivityContent,
  DynamicToolCallContent,
  SuggestionItem,
  ToolCall,
} from '../../type';
import type { Operation } from '../../../shared/immutable-patch';
import type { AGUIHistoryMessage, AGUIToolCall } from './types';
import type { CustomEvent } from './types/events';

export type AGUIMessageContent = AIMessageContent | DynamicActivityContent | DynamicToolCallContent;
export type SnapshotMessageContent = AGUIMessageContent[] & { readonly _isSnapshot: true };
export type ToolCallResult = { toolCallId: string; result: string };

export function isSnapshotMessageContent(content: AGUIMessageContent[]): content is SnapshotMessageContent {
  return '_isSnapshot' in content && content._isSnapshot === true;
}

export function mergeStringContent(existing: string | undefined, delta: string): string {
  if (!existing) return delta;
  try {
    const existingValue = JSON.parse(existing) as ChatJSONValue;
    const deltaValue = JSON.parse(delta) as ChatJSONValue;
    if (isChatJSONObject(existingValue) && isChatJSONObject(deltaValue)) {
      return JSON.stringify({ ...existingValue, ...deltaValue });
    }
    if (Array.isArray(existingValue) && Array.isArray(deltaValue)) {
      return JSON.stringify([...existingValue, ...deltaValue]);
    }
    return delta;
  } catch {
    return existing + delta;
  }
}

export function extractStateKeyFromDelta(event: { type: string; delta?: Operation[] }): string | null {
  const firstDelta = event.type === 'STATE_DELTA' ? event.delta?.[0] : undefined;
  if (!firstDelta) return null;
  const pathParts = firstDelta.path.split('/');
  return pathParts.length > 1 ? pathParts[1] : null;
}

export function processMessageGroup(
  messages: AGUIHistoryMessage[],
  toolCallMap: Map<string, ToolCallResult>,
): AGUIMessageContent[] {
  const allContent: AGUIMessageContent[] = [];
  messages.forEach((message) => {
    if (message.role === 'assistant') {
      if (typeof message.content === 'string') allContent.push(createMarkdownContent(message.content));
      if (message.toolCalls?.length) allContent.push(...processToolCalls(message.toolCalls, toolCallMap));
      return;
    }
    if (message.role === 'reasoning') {
      allContent.push(
        createThinkingContent(
          { text: message.content || '', title: message.title || '思考结束' },
          'complete',
          'append',
          true,
          message.encryptedValue
            ? {
                encryptedValue: message.encryptedValue,
                ...(message.subtype ? { subtype: message.subtype } : {}),
                ...(message.entityId ? { entityId: message.entityId } : {}),
              }
            : undefined,
        ),
      );
      return;
    }
    if (message.role === 'activity') {
      if (message.activityType === 'CUSTOM') {
        const content = message.content;
        allContent.push(createCustomContent({ name: stringAt(content, 'name'), value: jsonAt(content, 'value') }));
      } else {
        allContent.push(createActivityContent(message.activityType, message.content, 'complete'));
      }
    }
  });
  return allContent;
}

export function handleMessagesSnapshot(messages: AGUIHistoryMessage[]): SnapshotMessageContent | [] {
  if (!messages.length) return [];
  const result = processMessageGroup(messages, buildToolCallMap(messages));
  return result.length ? Object.assign(result, { _isSnapshot: true as const }) : [];
}

export function handleCustomEvent(event: CustomEvent): CustomContent | ReturnType<typeof createSuggestionContent> {
  if (event.name === 'suggestion' && Array.isArray(event.value) && event.value.every(isSuggestionItem)) {
    return createSuggestionContent(event.value);
  }
  return createCustomContent({ name: event.name, value: event.value });
}

export function parseSSEData(data: string | ChatJSONValue): ChatJSONValue | null {
  if (typeof data !== 'string') return data;
  try {
    const value = JSON.parse(data) as ChatJSONValue;
    return isChatJSONValue(value) ? value : null;
  } catch {
    return null;
  }
}

export function isValidEvent(event: ChatJSONValue | null): event is ChatJSONObject & { type: string } {
  return isChatJSONObject(event) && typeof event.type === 'string';
}

export function generateConnectionId(prefix = 'sse'): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

export function formatLogMessage(level: string, message: string, context?: ChatJSONValue): string {
  const contextStr = context === undefined ? '' : ` [${JSON.stringify(context)}]`;
  return `[${new Date().toISOString()}] [${level.toUpperCase()}] ${message}${contextStr}`;
}

export function createAIMessageContent<T extends string, TData, TExt extends object = object>(
  type: T,
  data: TData,
  status: 'pending' | 'streaming' | 'complete' | 'error' = 'complete',
  strategy: 'append' | 'merge' = 'append',
  ext?: TExt,
): ChatBaseContent<T, TData, TExt> {
  return { type, data, status, strategy, ...(ext ? { ext } : {}) };
}

export function createThinkingContent(
  data: { text?: string; title?: string },
  status: 'streaming' | 'complete' = 'streaming',
  strategy: 'append' | 'merge' = 'append',
  collapsed = false,
  extraExt?: ChatJSONObject,
): Extract<AIMessageContent, { type: 'thinking' }> {
  return { type: 'thinking', data, status, strategy, ext: { collapsed, ...extraExt } };
}

export function createToolCallContent(
  toolCall: ToolCall,
  status: 'pending' | 'streaming' | 'complete' = 'pending',
  strategy: 'append' | 'merge' = 'append',
): DynamicToolCallContent {
  return { type: `toolcall-${toolCall.toolCallName}-${toolCall.toolCallId}`, data: toolCall, status, strategy };
}

export function createActivityContent(
  activityType: string,
  content: ChatJSONObject,
  status: 'streaming' | 'complete' = 'complete',
  strategy: 'append' | 'merge' = 'append',
  deltaInfo?: ActivityData<ChatJSONObject>['deltaInfo'],
): DynamicActivityContent {
  return {
    type: `activity-${activityType}`,
    data: { activityType, content },
    status,
    strategy,
    ...(deltaInfo ? { ext: { deltaInfo } } : {}),
  };
}

export function createMarkdownContent(
  data: string,
  status: 'streaming' | 'complete' = 'complete',
  strategy: 'append' | 'merge' = 'append',
  role: 'assistant' | 'system' = 'assistant',
): AIMessageContent {
  return role === 'system'
    ? { type: 'system-text', data, status, strategy, ext: { role } }
    : { type: 'markdown', data, status, strategy };
}

export function createSuggestionContent(data: SuggestionItem[]): Extract<AIMessageContent, { type: 'suggestion' }> {
  return { type: 'suggestion', data, status: 'complete', strategy: 'append' };
}

export function createTextContent(
  data: string,
  status: 'streaming' | 'complete' | 'error' = 'complete',
): Extract<AIMessageContent, { type: 'text' }> {
  return { type: 'text', data, status, strategy: 'append' };
}

export function updateToolCall(existingToolCall: ToolCall, updates: Partial<ToolCall>): ToolCall {
  return { ...existingToolCall, ...updates };
}

export function handleSuggestionToolCall(toolCall: ToolCall): ReturnType<typeof createSuggestionContent> | null {
  if (toolCall.toolCallName !== 'suggestion') return null;
  const data = parseSSEData(toolCall.result || '[]');
  return Array.isArray(data) && data.every(isSuggestionItem) ? createSuggestionContent(data) : null;
}

export function processToolCalls(
  toolCalls: AGUIToolCall[],
  toolCallMap: Map<string, ToolCallResult>,
): AGUIMessageContent[] {
  return toolCalls.map((toolCall) => {
    const result = toolCallMap.get(toolCall.id)?.result || '';
    if (toolCall.function.name === 'suggestion') {
      const value = parseSSEData(result);
      return Array.isArray(value) && value.every(isSuggestionItem)
        ? createSuggestionContent(value)
        : createSuggestionContent([]);
    }
    return createToolCallContent({
      toolCallId: toolCall.id,
      toolCallName: toolCall.function.name,
      args: toolCall.function.arguments,
      result,
    });
  });
}

export function buildToolCallMap(historyMessages: AGUIHistoryMessage[]): Map<string, ToolCallResult> {
  const toolCallMap = new Map<string, ToolCallResult>();
  historyMessages.forEach((message) => {
    if (message.role === 'tool')
      toolCallMap.set(message.toolCallId, { toolCallId: message.toolCallId, result: message.content });
  });
  return toolCallMap;
}

function createCustomContent(data: CustomContent['data']): CustomContent {
  return { type: 'custom', data, status: 'complete', strategy: 'append' };
}

function isSuggestionItem(value: ChatJSONValue): value is SuggestionItem {
  return (
    isChatJSONObject(value) &&
    typeof value.title === 'string' &&
    (value.prompt === undefined || typeof value.prompt === 'string')
  );
}

function isChatJSONObject(value: ChatJSONValue | null): value is ChatJSONObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isChatJSONValue(value: unknown): value is ChatJSONValue {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    return true;
  if (Array.isArray(value)) return value.every(isChatJSONValue);
  return typeof value === 'object' && Object.values(value).every(isChatJSONValue);
}

function stringAt(value: ChatJSONObject, key: string): string {
  const candidate = value[key];
  return typeof candidate === 'string' ? candidate : '';
}

function jsonAt(value: ChatJSONObject, key: string): ChatJSONValue {
  return value[key] ?? null;
}
