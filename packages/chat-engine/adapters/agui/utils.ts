/**
 * AGUI适配器工具函数
 * 包含与类无关的纯函数，用于处理AGUI协议相关逻辑
 */

import type { AIMessageContent, AIMessageContentSnapshot, ChatBaseContent, SuggestionItem, ToolCall } from '../../type';
import type { JsonPatchOperation } from '../../utils/json-patch-operation';
import type { AGUIProtocolEvent, CustomEvent } from './types/events';
import type { AGUIMessage, AGUIToolCall } from './types/schema';

type ToolCallResultEntry = { toolCallId: string; result: string };

type StateDeltaEventLike = { type: string; delta?: JsonPatchOperation[] };

/**
 * 合并字符串内容，处理JSON和普通字符串
 * @param existing 现有内容
 * @param delta 增量内容
 * @returns 合并后的内容
 */
export function mergeStringContent(existing: string | undefined, delta: string): string {
  if (!existing) return delta;

  // 尝试解析为JSON，如果是有效的JSON则合并
  try {
    const existingObj = JSON.parse(existing);
    const deltaObj = JSON.parse(delta);

    // 如果是对象，进行深度合并
    if (typeof existingObj === 'object' && typeof deltaObj === 'object') {
      return JSON.stringify({ ...existingObj, ...deltaObj });
    }

    // 如果是数组，进行数组合并
    if (Array.isArray(existingObj) && Array.isArray(deltaObj)) {
      return JSON.stringify([...existingObj, ...deltaObj]);
    }

    // 其他情况，直接替换
    return delta;
  } catch (_error) {
    // 不是有效的JSON，按普通字符串处理
    return existing + delta;
  }
}

/**
 * 从delta事件中提取stateKey
 * @param event delta事件对象
 * @returns stateKey或null
 */
export function extractStateKeyFromDelta(event: StateDeltaEventLike): string | null {
  if (event.type === 'STATE_DELTA' && event.delta && event.delta.length > 0) {
    // 从第一个delta操作的路径中提取stateKey
    const firstDelta = event.delta[0];
    if (firstDelta && firstDelta.path) {
      const pathParts = firstDelta.path.split('/');
      return pathParts.length > 1 ? pathParts[1] : null;
    }
  }
  return null;
}

/**
 * 处理一组 AG-UI 标准格式的消息，转换为前端内部的 AIMessageContent[] 格式
 */
export function processMessageGroup(
  messages: AGUIMessage[],
  toolCallMap: Map<string, ToolCallResultEntry>,
): AIMessageContent[] {
  const allContent: AIMessageContent[] = [];

  messages.forEach((msg) => {
    if (msg.role === 'assistant') {
      // 处理文本内容
      if (typeof msg.content === 'string') {
        allContent.push({ type: 'markdown', data: msg.content });
      }

      // 处理工具调用内容（旧格式：toolCalls 独立字段 + 单独 tool 消息）
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        const toolCallContents = processToolCalls(msg.toolCalls, toolCallMap);
        allContent.push(...(toolCallContents as AIMessageContent[]));
      }
    } else if (msg.role === 'reasoning') {
      const extraExt = msg.encryptedValue
        ? {
            encryptedValue: msg.encryptedValue,
            ...(msg.subtype ? { subtype: msg.subtype } : {}),
            ...(msg.entityId ? { entityId: msg.entityId } : {}),
          }
        : undefined;
      allContent.push(
        createThinkingContent(
          { text: msg.content || '', title: msg.title || '思考结束' },
          'complete',
          'append',
          true,
          extraExt,
        ) as AIMessageContent,
      );
    } else if (msg.role === 'activity') {
      if (msg.activityType === 'CUSTOM') {
        const content = msg.content as Record<string, unknown> | undefined;
        allContent.push({
          type: 'custom',
          data: {
            name: typeof content?.name === 'string' ? content.name : '',
            value: content?.value,
          },
          status: 'complete',
        } as unknown as AIMessageContent);
      } else {
        allContent.push({
          type: `activity-${msg.activityType}`,
          data: {
            activityType: msg.activityType,
            content: msg.content,
          },
          status: 'complete',
        } as unknown as AIMessageContent);
      }
    }
  });

  return allContent;
}

/**
 * 处理消息快照
 */
export function handleMessagesSnapshot(messages: AGUIMessage[]): AIMessageContentSnapshot {
  if (!messages || messages.length === 0) return [];

  const toolCallMap = buildToolCallMap(messages);
  const result = processMessageGroup(messages, toolCallMap) as AIMessageContentSnapshot;

  if (result.length > 0) {
    result._isSnapshot = true;
  }

  return result;
}

/**
 * 处理自定义事件
 */
export function handleCustomEvent(event: CustomEvent): AIMessageContent {
  if (event.name === 'suggestion') {
    return {
      type: 'suggestion',
      data: Array.isArray(event.value) ? (event.value as SuggestionItem[]) : [],
      status: 'complete',
    } as AIMessageContent;
  }
  return {
    type: 'custom',
    data: {
      name: event.name,
      value: event.value,
    },
    status: 'complete',
  } as unknown as AIMessageContent;
}

/**
 * 解析SSE数据
 */
export function parseSSEData(data: unknown): AGUIProtocolEvent | null {
  if (typeof data === 'string') {
    try {
      const parsed: unknown = JSON.parse(data);
      return isValidEvent(parsed) ? parsed : null;
    } catch (error) {
      console.warn('Failed to parse SSE data:', error);
      return null;
    }
  }
  return isValidEvent(data) ? data : null;
}

/**
 * 验证事件对象
 */
export function isValidEvent(event: unknown): event is AGUIProtocolEvent {
  return typeof event === 'object' && event !== null && 'type' in event && typeof event.type === 'string';
}

/**
 * 生成连接ID
 */
export function generateConnectionId(prefix = 'sse'): string {
  const timestamp = Date.now();
  return `${prefix}_${timestamp}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * 格式化日志消息
 */
export function formatLogMessage(level: string, message: string, context?: unknown): string {
  const timestamp = new Date().toISOString();
  const contextStr = context ? ` [${JSON.stringify(context)}]` : '';
  return `[${timestamp}] [${level.toUpperCase()}] ${message}${contextStr}`;
}

/**
 * 创建基础的 AIMessageContent 对象
 */
export function createAIMessageContent(
  type: string,
  data: unknown,
  status: 'pending' | 'streaming' | 'complete' | 'error' = 'complete',
  strategy: 'append' | 'merge' = 'append',
  ext?: Record<string, unknown>,
): AIMessageContent {
  const content: ChatBaseContent<string, unknown> = {
    type,
    data,
    status,
    strategy,
  };

  if (ext) {
    content.ext = ext;
  }

  return content as unknown as AIMessageContent;
}

/**
 * 创建 thinking 类型的 AIMessageContent
 */
export function createThinkingContent(
  data: { text: string; title?: string },
  status: 'streaming' | 'complete' = 'streaming',
  strategy: 'append' | 'merge' = 'append',
  collapsed = false,
  extraExt?: Record<string, unknown>,
): AIMessageContent {
  const ext = extraExt ? { collapsed, ...extraExt } : { collapsed };
  return createAIMessageContent('thinking', data, status, strategy, ext);
}

/**
 * 创建 toolcall 类型的 AIMessageContent
 */
export function createToolCallContent(
  toolCall: ToolCall,
  status: 'pending' | 'streaming' | 'complete' = 'pending',
  strategy?: 'append' | 'merge',
): AIMessageContent {
  const type = `toolcall-${toolCall.toolCallName}-${toolCall.toolCallId}`;
  const finalStrategy = strategy || 'append';
  return createAIMessageContent(type, toolCall, status, finalStrategy);
}

/**
 * 创建 activity 类型的 AIMessageContent
 */
export function createActivityContent(
  activityType: string,
  content: Record<string, unknown>,
  status: 'streaming' | 'complete' = 'complete',
  strategy: 'append' | 'merge' = 'append',
  deltaInfo?: { fromIndex: number; toIndex: number },
): AIMessageContent {
  const type = `activity-${activityType}`;
  const ext = deltaInfo ? { deltaInfo } : undefined;

  return createAIMessageContent(
    type,
    {
      activityType,
      content,
    },
    status,
    strategy,
    ext,
  );
}

/**
 * 创建 markdown 类型的 AIMessageContent
 */
export function createMarkdownContent(
  data: string,
  status: 'streaming' | 'complete' = 'complete',
  strategy: 'append' | 'merge' = 'append',
  role?: 'assistant' | 'system',
): AIMessageContent {
  const notAssistant = role && role !== 'assistant';
  const content = createAIMessageContent(notAssistant ? `${role}-text` : 'markdown', data, status, strategy);
  if (notAssistant) {
    content.ext = { ...content.ext, role };
  }
  return content;
}

/**
 * 创建 suggestion 类型的 AIMessageContent
 */
export function createSuggestionContent(data: SuggestionItem[]): AIMessageContent {
  return createAIMessageContent('suggestion', data, 'complete', 'append');
}

/**
 * 创建 text 类型的 AIMessageContent
 */
export function createTextContent(
  data: string,
  status: 'streaming' | 'complete' | 'error' = 'complete',
): AIMessageContent {
  return createAIMessageContent('text', data, status, 'append');
}

/**
 * 更新工具调用对象
 */
export function updateToolCall(existingToolCall: ToolCall, updates: Partial<ToolCall>): ToolCall {
  return {
    ...existingToolCall,
    ...updates,
  };
}

/**
 * 处理 suggestion 工具调用的特殊逻辑
 */
export function handleSuggestionToolCall(toolCall: ToolCall): AIMessageContent | null {
  if (toolCall.toolCallName === 'suggestion') {
    try {
      const suggestionData = JSON.parse(toolCall.result || '{}') as SuggestionItem[];
      return createSuggestionContent(suggestionData);
    } catch (error) {
      console.warn('Failed to parse suggestion result:', error);
      return null;
    }
  }
  return null;
}

/**
 * 处理工具调用并创建对应的 AIMessageContent 数组
 */
export function processToolCalls(
  toolCalls: AGUIToolCall[],
  toolCallMap: Map<string, ToolCallResultEntry>,
): AIMessageContent[] {
  return toolCalls.map((toolCall) => {
    const toolResult = toolCallMap.get(toolCall.id)?.result || '';

    if (toolCall.function.name === 'suggestion') {
      return {
        type: 'suggestion' as const,
        data: (parseSSEData(toolResult) as SuggestionItem[] | null) || [],
      } as unknown as AIMessageContent;
    }

    const parsedResult = typeof toolResult === 'string' ? (parseSSEData(toolResult) ?? toolResult) : toolResult;

    const toolCallData: ToolCall = {
      toolCallId: toolCall.id,
      toolCallName: toolCall.function.name,
      args: toolCall.function.arguments,
      result: typeof parsedResult === 'string' ? parsedResult : JSON.stringify(parsedResult),
    };

    return {
      type: `toolcall-${toolCall.function.name}-${toolCall.id}` as const,
      data: toolCallData,
    } as unknown as AIMessageContent;
  });
}

/**
 * 构建工具调用结果映射
 */
export function buildToolCallMap(historyMessages: AGUIMessage[]): Map<string, ToolCallResultEntry> {
  const toolCallMap = new Map<string, ToolCallResultEntry>();

  historyMessages.forEach((msg) => {
    if (msg.role === 'tool') {
      toolCallMap.set(msg.toolCallId, {
        toolCallId: msg.toolCallId,
        result: msg.content,
      });
    }
  });

  return toolCallMap;
}
