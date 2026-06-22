import type { AIMessageContent, SSEChunkData, ToolCall } from '../../type';
import type { JsonPatchOperation } from '../../utils/json-patch-operation';
import {
  AGUIEventType,
  type AGUIProtocolEvent,
  type CustomEvent,
  isActivityEvent,
  isReasoningEvent,
  isStateEvent,
  isTextMessageEvent,
  isToolCallEvent,
} from './types/events';
import type { AGUIMessage } from './types/schema';
import { stateManager } from './StateManager';
import { activityManager, type AGUIActivityEvent } from './ActivityManager';
import {
  createActivityContent,
  createMarkdownContent,
  createTextContent,
  createThinkingContent,
  createToolCallContent,
  handleCustomEvent,
  handleMessagesSnapshot,
  handleSuggestionToolCall,
  mergeStringContent,
  parseSSEData,
  updateToolCall,
} from './utils';

function eventString(event: AGUIProtocolEvent, key: string, fallback = ''): string {
  const value = event[key];
  return typeof value === 'string' ? value : fallback;
}

function eventOptionalString(event: AGUIProtocolEvent, key: string): string | undefined {
  const value = event[key];
  return typeof value === 'string' ? value : undefined;
}

function eventRecord(event: AGUIProtocolEvent, key: string): Record<string, unknown> | undefined {
  const value = event[key];
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function toActivityEvent(event: AGUIProtocolEvent): AGUIActivityEvent {
  return {
    type: event.type,
    activityType: eventString(event, 'activityType', 'unknown'),
    content: eventRecord(event, 'content'),
    patch: Array.isArray(event.patch) ? (event.patch as JsonPatchOperation[]) : undefined,
    messageId: eventOptionalString(event, 'messageId'),
  };
}

function toCustomEvent(event: AGUIProtocolEvent): CustomEvent {
  return {
    type: AGUIEventType.CUSTOM,
    name: eventString(event, 'name'),
    value: event.value,
  };
}

/**
 * AGUIEventMapper
 * 将AG-UI协议事件（SSEChunkData）转换为AIContentChunkUpdate
 * 支持多轮对话、增量文本、工具调用、思考、状态快照、消息快照等基础事件
 * 同时提供状态变更和步骤生命周期事件的分发机制
 *
 * 支持简化模式：
 * - TEXT_MESSAGE_CHUNK：自动补全 Start → Content → End 生命周期
 * - TOOL_CALL_CHUNK：自动补全 Start → Args → End 生命周期
 * - REASONING_MESSAGE_CHUNK：自动补全 Start → Content → End 生命周期
 */
export class AGUIEventMapper {
  private toolCallMap: Record<string, ToolCall> = {};

  private toolCallEnded: Set<string> = new Set(); // 记录已经TOOL_CALL_END的工具调用

  /**
   * 暴露 activityManager，供 AGUIAdapter 访问
   */
  public get activityManager() {
    return activityManager;
  }

  // 简化模式状态跟踪
  private currentTextMessageId: string | null = null; // 当前正在处理的文本消息 ID

  private currentTextMessageRole: 'assistant' | 'system' | null = null; // 当前正在处理的文本消息角色

  private toolCallChunkStarted: Set<string> = new Set(); // 已自动触发 TOOL_CALL_START 的 toolCallId

  // Reasoning 消息状态跟踪（和 currentTextMessageId 风格对齐）
  // 首次出现 messageId 时 append 新块；同 messageId → merge；不同 messageId → append 新块。
  private currentReasoningMessageId: string | null = null;

  // REASONING_START 携带的 title 暂存，由首个创建块的事件（MESSAGE_START / MESSAGE_CHUNK）消费。
  // REASONING_START 自身不再直接 append 空块，避免 CHUNK 模式下产生一个悬空的 streaming 块。
  private pendingReasoningTitle: string | null = null;

  /**
   * 主入口：将SSE事件转换为AIContentChunkUpdate
   *
   * @param chunk SSE数据块，其中data字段可能是字符串（需要解析）或已解析的对象
   */
  mapEvent(chunk: SSEChunkData): AIMessageContent | AIMessageContent[] | null {
    // 处理data字段，可能是字符串或已解析的对象
    const event = parseSSEData(chunk.data);

    if (!event?.type) return null;

    // 根据事件类型分发到不同的处理函数
    if (isTextMessageEvent(event.type)) {
      return this.handleTextMessageEvent(event);
    }

    if (isReasoningEvent(event.type)) {
      return this.handleReasoningEvent(event);
    }

    if (isToolCallEvent(event.type)) {
      return this.handleToolCallEvent(event);
    }

    if (isActivityEvent(event.type)) {
      return this.handleActivityEvent(event);
    }

    if (isStateEvent(event.type)) {
      return this.handleStateEvent(event);
    }

    // 处理其他事件类型
    return this.handleOtherEvent(event);
  }

  /**
   * 获取当前所有工具调用
   */
  getToolCalls(): ToolCall[] {
    return Object.values(this.toolCallMap);
  }

  /**
   * 清除指定工具调用
   */
  clearToolCall(toolCallId: string): void {
    delete this.toolCallMap[toolCallId];
    this.toolCallEnded.delete(toolCallId);
    this.toolCallChunkStarted.delete(toolCallId);
  }

  /**
   * 获取指定工具调用
   */
  getToolCall(toolCallId: string): ToolCall | undefined {
    return this.toolCallMap[toolCallId];
  }

  /**
   * 检查工具调用是否已结束
   */
  isToolCallEnded(toolCallId: string): boolean {
    return this.toolCallEnded.has(toolCallId);
  }

  reset() {
    this.toolCallMap = {};
    this.toolCallEnded.clear();
    // 重置简化模式状态
    this.currentTextMessageId = null;
    this.currentTextMessageRole = null;
    this.toolCallChunkStarted.clear();
    this.currentReasoningMessageId = null;
    this.pendingReasoningTitle = null;
    // 清理 activityManager 状态
    activityManager.clear();
  }

  /**
   * 处理文本消息事件
   *
   * 支持两种模式：
   * 1. 标准模式：TEXT_MESSAGE_START → TEXT_MESSAGE_CONTENT → TEXT_MESSAGE_END
   * 2. 简化模式：仅发送 TEXT_MESSAGE_CHUNK，自动补全生命周期
   */
  private handleTextMessageEvent(event: AGUIProtocolEvent): AIMessageContent | null {
    switch (event.type) {
      case AGUIEventType.TEXT_MESSAGE_START:
        this.currentTextMessageId = typeof event.messageId === 'string' ? event.messageId : null;
        return createMarkdownContent('', 'streaming', 'append') as AIMessageContent;

      case AGUIEventType.TEXT_MESSAGE_CHUNK:
        return this.handleTextMessageChunk(event);

      case AGUIEventType.TEXT_MESSAGE_CONTENT:
        return createMarkdownContent(
          typeof event.delta === 'string' ? event.delta : '',
          'streaming',
          'merge',
        ) as AIMessageContent;

      case AGUIEventType.TEXT_MESSAGE_END:
        this.currentTextMessageId = null;
        return createMarkdownContent(
          typeof event.delta === 'string' ? event.delta : '',
          'complete',
          'merge',
        ) as AIMessageContent;

      default:
        return null;
    }
  }

  /**
   * 处理简化模式的 TEXT_MESSAGE_CHUNK 事件
   * 自动补全 Start → Content → End 生命周期
   *
   * 关键：通过 messageId 区分不同的文本块，
   * 当 messageId 变化时创建新的内容块
   */
  private handleTextMessageChunk(event: AGUIProtocolEvent): AIMessageContent | null {
    const messageId = typeof event.messageId === 'string' ? event.messageId : 'default';
    const role = event.role === 'assistant' || event.role === 'system' ? event.role : 'assistant';

    // 如果是新的 messageId，需要创建新的内容块
    if (this.currentTextMessageId !== messageId) {
      this.currentTextMessageId = messageId;
      this.currentTextMessageRole = role;
      // 创建新内容块，使用 append 策略，通过 ext.role 传递角色信息
      return createMarkdownContent(
        typeof event.delta === 'string' ? event.delta : '',
        'streaming',
        'append',
        role,
      ) as AIMessageContent;
    }

    // 同一个 messageId，使用 merge 策略追加内容
    return createMarkdownContent(
      typeof event.delta === 'string' ? event.delta : '',
      'streaming',
      'merge',
      this.currentTextMessageRole || role,
    ) as AIMessageContent;
  }

  /**
   * 处理 reasoning / thinking 相关事件
   *
   * 当前 AG-UI 规范使用 REASONING_* 事件；保留 THINKING_* 作为向后兼容的别名，
   * 两者在内部收敛为同一条 ThinkingContent（`{ text, title }`）。
   *
   * 设计与 handleTextMessageChunk 对齐：以 `currentReasoningMessageId` 为主键，
   * 首次出现 messageId 时 append 新块，相同 messageId merge；
   * CHUNK / START 都是"产出新块"的入口，无需额外的 phase 开关。
   *
   * - `REASONING_START`             → 仅记录 title 到 pendingReasoningTitle，不创建块
   * - `REASONING_MESSAGE_START`     → append 新块（消费 pendingReasoningTitle 作为 title）
   * - `REASONING_MESSAGE_CONTENT`   → merge delta 到当前块
   * - `REASONING_MESSAGE_END`       → 释放 currentReasoningMessageId，块保持 streaming
   * - `REASONING_MESSAGE_CHUNK`     → 新 messageId append、同 messageId merge、空 delta 关闭当前消息（自动补全生命周期）
   * - `REASONING_ENCRYPTED_VALUE`   → encryptedValue 存入 thinking.ext，供业务下轮透传
   * - `REASONING_END`               → 当前块 complete，title 置为 '思考结束'
   */
  private handleReasoningEvent(event: AGUIProtocolEvent): AIMessageContent | null {
    switch (event.type) {
      case AGUIEventType.REASONING_START:
      case AGUIEventType.THINKING_START:
        this.pendingReasoningTitle = eventString(event, 'title', '思考中...');
        this.currentReasoningMessageId = null;
        return null;

      case AGUIEventType.REASONING_MESSAGE_START:
      case AGUIEventType.THINKING_TEXT_MESSAGE_START:
        return this.openReasoningBlock(
          eventOptionalString(event, 'messageId') ?? null,
          eventOptionalString(event, 'title'),
          '',
        );

      case AGUIEventType.REASONING_MESSAGE_CONTENT:
      case AGUIEventType.THINKING_TEXT_MESSAGE_CONTENT:
        return createThinkingContent(
          { text: eventString(event, 'delta') },
          'streaming',
          'merge',
          false,
        ) as AIMessageContent;

      case AGUIEventType.REASONING_MESSAGE_END:
      case AGUIEventType.THINKING_TEXT_MESSAGE_END:
        this.currentReasoningMessageId = null;
        return null;

      case AGUIEventType.REASONING_MESSAGE_CHUNK:
        return this.handleReasoningMessageChunk(event);

      case AGUIEventType.REASONING_ENCRYPTED_VALUE:
        return createThinkingContent({ text: '' }, 'streaming', 'merge', false, {
          encryptedValue: eventString(event, 'encryptedValue'),
          subtype: eventString(event, 'subtype'),
          entityId: eventString(event, 'entityId'),
        }) as AIMessageContent;

      case AGUIEventType.REASONING_END:
      case AGUIEventType.THINKING_END:
        this.currentReasoningMessageId = null;
        this.pendingReasoningTitle = null;
        return createThinkingContent(
          { text: '', title: eventString(event, 'title', '思考结束') },
          'complete',
          'merge',
          true,
        ) as AIMessageContent;

      default:
        return null;
    }
  }

  /**
   * 处理简化模式的 REASONING_MESSAGE_CHUNK 事件
   * 自动补全 Start → Content → End 生命周期（与 handleTextMessageChunk 风格一致）
   *
   * 关键：
   * - 通过 messageId 区分不同的 reasoning 消息，messageId 变化 append 新块、相同 merge
   * - 空 delta 显式关闭当前 reasoning 消息（AG-UI 规范定义的 chunk 关闭信号，仅作用于自身 messageId）
   *   参考: https://docs.ag-ui.com/concepts/events#reasoningmessagechunk
   */
  private handleReasoningMessageChunk(event: AGUIProtocolEvent): AIMessageContent | null {
    const messageId = eventOptionalString(event, 'messageId') ?? null;
    const delta = eventString(event, 'delta');

    if (delta === '' && messageId && this.currentReasoningMessageId === messageId) {
      this.currentReasoningMessageId = null;
      return createThinkingContent({ text: '', title: '思考结束' }, 'complete', 'merge', true) as AIMessageContent;
    }

    if (this.currentReasoningMessageId !== messageId) {
      return this.openReasoningBlock(messageId, eventOptionalString(event, 'title'), delta);
    }
    return createThinkingContent({ text: delta }, 'streaming', 'merge', false) as AIMessageContent;
  }

  private openReasoningBlock(messageId: string | null, title: string | undefined, text: string): AIMessageContent {
    this.currentReasoningMessageId = messageId;
    const resolvedTitle = title || this.pendingReasoningTitle || '思考中...';
    this.pendingReasoningTitle = null;
    return createThinkingContent({ text, title: resolvedTitle }, 'streaming', 'append', false) as AIMessageContent;
  }

  /**
   * 处理工具调用事件
   *
   * 支持两种模式：
   * 1. 标准模式：TOOL_CALL_START → TOOL_CALL_ARGS → TOOL_CALL_END
   * 2. 简化模式：仅发送 TOOL_CALL_CHUNK，自动补全生命周期
   */
  private handleToolCallEvent(event: AGUIProtocolEvent): AIMessageContent | null {
    switch (event.type) {
      case AGUIEventType.TOOL_CALL_START:
        return this.handleToolCallStart(event);
      case AGUIEventType.TOOL_CALL_ARGS:
        return this.handleToolCallArgs(event);
      case AGUIEventType.TOOL_CALL_CHUNK:
        return this.handleToolCallChunk(event);
      case AGUIEventType.TOOL_CALL_RESULT:
        return this.handleToolCallResult(event);
      case AGUIEventType.TOOL_CALL_END:
        return this.handleToolCallEnd(event);
      default:
        return null;
    }
  }

  /**
   * 处理活动事件
   * 委托给 activityManager 进行状态管理和订阅通知
   *
   * 支持两种模式：
   * 1. 标准模式：先收到 ACTIVITY_SNAPSHOT，后续 ACTIVITY_DELTA 基于 snapshot 增量更新
   * 2. 纯增量模式：没有 ACTIVITY_SNAPSHOT，直接收到 ACTIVITY_DELTA，自动初始化空内容
   *
   * 注意：不同 activityType 的活动是独立管理的，互不影响
   */
  private handleActivityEvent(event: AGUIProtocolEvent): AIMessageContent | null {
    const activityType = eventString(event, 'activityType', 'unknown');
    const activityData = activityManager.handleActivityEvent(toActivityEvent(event));
    if (!activityData) {
      return null;
    }

    const isSnapshot = event.type === AGUIEventType.ACTIVITY_SNAPSHOT;
    const isFirstDelta = event.type === AGUIEventType.ACTIVITY_DELTA && !activityManager.getActivity(activityType);

    return createActivityContent(
      activityType,
      activityData.content,
      'streaming',
      isSnapshot || isFirstDelta ? 'append' : 'merge',
      activityData.deltaInfo,
    ) as AIMessageContent;
  }

  private handleStateEvent(event: AGUIProtocolEvent): null {
    stateManager.handleStateEvent({
      type: event.type,
      snapshot: eventRecord(event, 'snapshot'),
      delta: Array.isArray(event.delta) ? (event.delta as JsonPatchOperation[]) : undefined,
    });
    return null;
  }

  private handleOtherEvent(event: AGUIProtocolEvent): AIMessageContent | AIMessageContent[] | null {
    switch (event.type) {
      case AGUIEventType.MESSAGES_SNAPSHOT: {
        const messages = event.messages;
        if (!Array.isArray(messages)) return null;
        return handleMessagesSnapshot(messages as AGUIMessage[]);
      }
      case AGUIEventType.CUSTOM:
        return handleCustomEvent(toCustomEvent(event)) as AIMessageContent;
      case AGUIEventType.RUN_ERROR:
        return [
          createTextContent(
            eventString(event, 'message', eventString(event, 'error', '系统未知错误')),
            'error',
          ) as AIMessageContent,
        ];
      default:
        return null;
    }
  }

  /**
   * 处理工具调用开始事件
   */
  private handleToolCallStart(event: AGUIProtocolEvent): AIMessageContent | null {
    const toolCallId = eventString(event, 'toolCallId');
    this.toolCallChunkStarted.add(toolCallId);

    this.toolCallMap[toolCallId] = {
      eventType: 'TOOL_CALL_START',
      toolCallId,
      toolCallName: eventString(event, 'toolCallName'),
      parentMessageId: eventString(event, 'parentMessageId'),
    };

    return createToolCallContent(this.toolCallMap[toolCallId], 'pending', 'append') as AIMessageContent;
  }

  private handleToolCallArgs(event: AGUIProtocolEvent): AIMessageContent | null {
    const toolCallId = eventString(event, 'toolCallId');
    if (!this.toolCallMap[toolCallId]) return null;

    const currentArgs = this.toolCallMap[toolCallId].args || '';
    const newArgs = mergeStringContent(currentArgs, eventString(event, 'delta'));

    this.toolCallMap[toolCallId] = updateToolCall(this.toolCallMap[toolCallId], {
      eventType: 'TOOL_CALL_ARGS',
      args: newArgs,
    });

    return this.updateToolCallInContext(toolCallId, 'streaming');
  }

  private handleToolCallChunk(event: AGUIProtocolEvent): AIMessageContent | null {
    const toolCallId =
      eventOptionalString(event, 'toolCallId') || `auto_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;

    const isFirstChunk = !this.toolCallChunkStarted.has(toolCallId) && !this.toolCallMap[toolCallId];

    if (isFirstChunk) {
      this.toolCallChunkStarted.add(toolCallId);
      this.currentTextMessageId = null;

      this.toolCallMap[toolCallId] = {
        eventType: 'TOOL_CALL_START',
        toolCallId,
        toolCallName: eventString(event, 'toolCallName', 'unknown'),
        parentMessageId: eventString(event, 'parentMessageId'),
        args: eventString(event, 'delta'),
      };

      return createToolCallContent(this.toolCallMap[toolCallId], 'streaming', 'append') as AIMessageContent;
    }

    if (!this.toolCallMap[toolCallId]) return null;

    const currentArgs = this.toolCallMap[toolCallId].args || '';
    const newArgs = mergeStringContent(currentArgs, eventString(event, 'delta'));

    this.toolCallMap[toolCallId] = updateToolCall(this.toolCallMap[toolCallId], {
      eventType: 'TOOL_CALL_CHUNK',
      args: newArgs,
    });

    return this.updateToolCallInContext(toolCallId, 'streaming');
  }

  private handleToolCallResult(event: AGUIProtocolEvent): AIMessageContent | null {
    const toolCallId = eventString(event, 'toolCallId');
    if (!this.toolCallMap[toolCallId]) return null;

    const currentResult = this.toolCallMap[toolCallId].result || '';
    const newResult = mergeStringContent(currentResult, eventString(event, 'content'));

    this.toolCallMap[toolCallId] = updateToolCall(this.toolCallMap[toolCallId], {
      eventType: AGUIEventType.TOOL_CALL_RESULT,
      result: newResult,
    });

    const suggestionContent = handleSuggestionToolCall(this.toolCallMap[toolCallId]);
    if (suggestionContent) {
      return suggestionContent as AIMessageContent;
    }

    return this.updateToolCallInContext(toolCallId, 'complete');
  }

  private handleToolCallEnd(event: AGUIProtocolEvent) {
    const toolCallId = eventString(event, 'toolCallId');
    this.toolCallEnded.add(toolCallId);

    if (this.toolCallMap[toolCallId]) {
      this.toolCallMap[toolCallId] = {
        ...this.toolCallMap[toolCallId],
        eventType: AGUIEventType.TOOL_CALL_END,
      };
    }

    return this.updateToolCallInContext(toolCallId, 'complete');
  }

  private updateToolCallInContext(toolCallId: string, status: 'streaming' | 'complete'): AIMessageContent | null {
    return createToolCallContent(this.toolCallMap[toolCallId], status, 'merge') as AIMessageContent;
  }
}

export default AGUIEventMapper;
