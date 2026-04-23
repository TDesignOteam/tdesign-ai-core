/* eslint-disable class-methods-use-this */
import type { AIMessageContent, SSEChunkData, ToolCall } from '../../type';
import {
  AGUIEventType,
  isActivityEvent,
  isReasoningEvent,
  isStateEvent,
  isTextMessageEvent,
  isToolCallEvent,
} from './types/events';
import { stateManager } from './StateManager';
import { activityManager } from './ActivityManager';
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

  // Reasoning 简化模式状态跟踪（REASONING_MESSAGE_CHUNK 生命周期）
  private currentReasoningMessageId: string | null = null;

  // 标记当前是否处于一个 reasoning phase（REASONING_START..REASONING_END 之间）
  // 用于让 REASONING_MESSAGE_CHUNK / REASONING_MESSAGE_START 首个事件复用 START 创建的块，
  // 而不是再 append 一个空块。
  private reasoningBlockOpen = false;

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
    this.reasoningBlockOpen = false;
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
  private handleTextMessageEvent(event: any): AIMessageContent | null {
    switch (event.type) {
      case AGUIEventType.TEXT_MESSAGE_START:
        this.currentTextMessageId = event.messageId || null; // 标记当前消息 ID
        return createMarkdownContent('', 'streaming', 'append');

      case AGUIEventType.TEXT_MESSAGE_CHUNK:
        return this.handleTextMessageChunk(event);

      case AGUIEventType.TEXT_MESSAGE_CONTENT:
        return createMarkdownContent(event.delta || '', 'streaming', 'merge');

      case AGUIEventType.TEXT_MESSAGE_END:
        this.currentTextMessageId = null; // 重置状态
        return createMarkdownContent(event.delta || '', 'complete', 'merge');

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
  private handleTextMessageChunk(event: any): AIMessageContent | null {
    const messageId = event.messageId || 'default';
    const role = event?.role || 'assistant';
    
    // 如果是新的 messageId，需要创建新的内容块
    if (this.currentTextMessageId !== messageId) {
      this.currentTextMessageId = messageId;
      this.currentTextMessageRole = role;
      // 创建新内容块，使用 append 策略，通过 ext.role 传递角色信息
      return createMarkdownContent(event.delta || '', 'streaming', 'append', role);
    }

    // 同一个 messageId，使用 merge 策略追加内容
    return createMarkdownContent(event.delta || '', 'streaming', 'merge', this.currentTextMessageRole || role);
  }

  /**
   * 处理 reasoning / thinking 相关事件
   *
   * 当前 AG-UI 规范使用 REASONING_* 事件；保留 THINKING_* 作为向后兼容的别名，
   * 两者在内部收敛为同一条 ThinkingContent（`{ text, title }`）。
   *
   * 生命周期约定：
   * - `*_START`              → 新建一条 thinking，status=streaming
   * - `*_MESSAGE_START`      → 如果尚未开始则隐式新建 thinking
   * - `*_MESSAGE_CONTENT`    → delta 追加到 thinking.text
   * - `*_MESSAGE_END`        → 当前消息段结束，thinking 保持 streaming
   * - `*_END`                → thinking complete
   * - `REASONING_MESSAGE_CHUNK` → 自动补全 Start → Content → End 生命周期
   * - `REASONING_ENCRYPTED_VALUE` → encryptedValue 存入 thinking.ext，客户端需原样回传
   */
  private handleReasoningEvent(event: any): AIMessageContent | null {
    switch (event.type) {
      case AGUIEventType.REASONING_START:
      case AGUIEventType.THINKING_START:
        // 开启一个 reasoning phase，创建一个新的 thinking 块；
        // 后续首个 MESSAGE_START / MESSAGE_CHUNK 需要复用这个块，而不是 append 新块。
        this.currentReasoningMessageId = null;
        this.reasoningBlockOpen = true;
        return createThinkingContent({ title: event.title || '思考中...' }, 'streaming', 'append', false);

      case AGUIEventType.REASONING_MESSAGE_START:
      case AGUIEventType.THINKING_TEXT_MESSAGE_START: {
        const messageId = event.messageId || null;
        // 同一 phase 内切换到新的 messageId：append 新块
        if (messageId && this.currentReasoningMessageId && this.currentReasoningMessageId !== messageId) {
          this.currentReasoningMessageId = messageId;
          return createThinkingContent({ title: event.title || '思考中...' }, 'streaming', 'append', false);
        }
        // 裸 MESSAGE_START（没有被 REASONING_START 包裹）：主动开块
        if (!this.reasoningBlockOpen) {
          this.reasoningBlockOpen = true;
          this.currentReasoningMessageId = messageId;
          return createThinkingContent({ title: event.title || '思考中...' }, 'streaming', 'append', false);
        }
        // 在 phase 内首次出现 messageId：复用 START 创建的块
        this.currentReasoningMessageId = messageId;
        return null;
      }

      case AGUIEventType.REASONING_MESSAGE_CONTENT:
      case AGUIEventType.THINKING_TEXT_MESSAGE_CONTENT:
        return createThinkingContent({ text: event.delta || '' }, 'streaming', 'merge', false);

      case AGUIEventType.REASONING_MESSAGE_END:
      case AGUIEventType.THINKING_TEXT_MESSAGE_END:
        this.currentReasoningMessageId = null;
        return null;

      case AGUIEventType.REASONING_MESSAGE_CHUNK: {
        const messageId = event.messageId || null;
        // 已在 phase 内（REASONING_START 打开了块）
        if (this.reasoningBlockOpen) {
          // phase 内首个 chunk：复用 START 创建的块
          if (!this.currentReasoningMessageId) {
            this.currentReasoningMessageId = messageId;
            return createThinkingContent({ text: event.delta || '' }, 'streaming', 'merge', false);
          }
          // 同一 phase 内切换到不同 messageId：append 新块
          if (this.currentReasoningMessageId !== messageId) {
            this.currentReasoningMessageId = messageId;
            return createThinkingContent(
              { text: event.delta || '', title: '思考中...' },
              'streaming',
              'append',
              false,
            );
          }
          // 同 messageId：merge 追加
          return createThinkingContent({ text: event.delta || '' }, 'streaming', 'merge', false);
        }
        // 裸 chunk（没有 REASONING_START 包裹）：主动开块
        this.reasoningBlockOpen = true;
        this.currentReasoningMessageId = messageId;
        return createThinkingContent(
          { text: event.delta || '', title: '思考中...' },
          'streaming',
          'append',
          false,
        );
      }

      case AGUIEventType.REASONING_ENCRYPTED_VALUE:
        // encryptedValue 仅用于跨轮状态连续性，透传到 ext 由业务层在下一轮回传
        return createThinkingContent(
          {},
          'streaming',
          'merge',
          false,
          { encryptedValue: event.encryptedValue, subtype: event.subtype, entityId: event.entityId },
        );

      case AGUIEventType.REASONING_END:
      case AGUIEventType.THINKING_END:
        this.currentReasoningMessageId = null;
        this.reasoningBlockOpen = false;
        return createThinkingContent({ title: event.title || '思考结束' }, 'complete', 'merge', true);

      default:
        return null;
    }
  }

  /**
   * 处理工具调用事件
   * 
   * 支持两种模式：
   * 1. 标准模式：TOOL_CALL_START → TOOL_CALL_ARGS → TOOL_CALL_END
   * 2. 简化模式：仅发送 TOOL_CALL_CHUNK，自动补全生命周期
   */
  private handleToolCallEvent(event: any): AIMessageContent | null {
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
  private handleActivityEvent(event: any): AIMessageContent | null {
    const activityType = event.activityType || 'unknown';
    // 委托给 activityManager 处理
    const activityData = activityManager.handleActivityEvent(event);
    if (!activityData) {
      return null;
    }

    // 根据事件类型决定 strategy
    const isSnapshot = event.type === AGUIEventType.ACTIVITY_SNAPSHOT;
    const isFirstDelta = event.type === AGUIEventType.ACTIVITY_DELTA && !activityManager.getActivity(activityType);

    return createActivityContent(
      activityType,
      activityData.content,
      'streaming',
      // SNAPSHOT 或首次 DELTA 使用 append 创建新内容块，后续使用 merge
      isSnapshot || isFirstDelta ? 'append' : 'merge',
      activityData.deltaInfo,
    );
  }

  /**
   * 处理状态事件
   */
  private handleStateEvent(event: any): null {
    stateManager.handleStateEvent(event);
    return null;
  }

  /**
   * 处理其他事件
   */
  private handleOtherEvent(event: any): AIMessageContent | AIMessageContent[] | null {
    switch (event.type) {
      case AGUIEventType.MESSAGES_SNAPSHOT:
        return handleMessagesSnapshot(event.messages);
      case AGUIEventType.CUSTOM:
        return handleCustomEvent(event);
      case AGUIEventType.RUN_ERROR:
        return [createTextContent(event.message || event.error || '系统未知错误', 'error')];
      default:
        return null;
    }
  }

  /**
   * 处理工具调用开始事件
   */
  private handleToolCallStart(event: any): AIMessageContent | null {
    // 标记已显式开始（防止后续 chunk 重复触发 start）
    this.toolCallChunkStarted.add(event.toolCallId);

    // 初始化工具调用
    this.toolCallMap[event.toolCallId] = {
      eventType: 'TOOL_CALL_START',
      toolCallId: event.toolCallId,
      toolCallName: event.toolCallName,
      parentMessageId: event.parentMessageId || '',
    };

    // 每个 TOOL_CALL_START 都会开启一个新的独立内容块（append）
    return createToolCallContent(this.toolCallMap[event.toolCallId], 'pending', 'append');
  }

  /**
   * 处理工具调用参数事件
   */
  private handleToolCallArgs(event: any): AIMessageContent | null {
    if (!this.toolCallMap[event.toolCallId]) return null;

    const currentArgs = this.toolCallMap[event.toolCallId].args || '';
    const newArgs = mergeStringContent(currentArgs, event.delta || '');

    // 更新内部ToolCall对象
    this.toolCallMap[event.toolCallId] = updateToolCall(this.toolCallMap[event.toolCallId], {
      eventType: 'TOOL_CALL_ARGS',
      args: newArgs,
    });

    return this.updateToolCallInContext(event.toolCallId, 'streaming');
  }

  /**
   * 处理简化模式的 TOOL_CALL_CHUNK 事件
   * 自动补全 Start → Args → End 生命周期
   * 
   * TOOL_CALL_CHUNK 事件结构：
   * - toolCallId: 工具调用ID（可选，首次时自动生成）
   * - toolCallName: 工具名称（首次必需）
   * - delta: 参数增量内容
   * - parentMessageId: 父消息ID（可选）
   */
  private handleToolCallChunk(event: any): AIMessageContent | null {
    // 生成或使用 toolCallId
    const toolCallId = event.toolCallId || `auto_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;

    // 检查是否是该 toolCallId 的第一个 chunk
    const isFirstChunk = !this.toolCallChunkStarted.has(toolCallId) && !this.toolCallMap[toolCallId];

    if (isFirstChunk) {
      // 自动触发 TOOL_CALL_START 逻辑
      this.toolCallChunkStarted.add(toolCallId);

      // 重置当前文本消息 ID，确保后续文本消息创建新内容块
      this.currentTextMessageId = null;

      // 初始化工具调用
      this.toolCallMap[toolCallId] = {
        eventType: 'TOOL_CALL_START',
        toolCallId,
        toolCallName: event.toolCallName || 'unknown',
        parentMessageId: event.parentMessageId || '',
        args: event.delta || '', // 第一个 chunk 的 delta 作为初始 args
      };

      return createToolCallContent(this.toolCallMap[toolCallId], 'streaming', 'append');
    }

    // 后续 chunk：更新 args
    if (!this.toolCallMap[toolCallId]) return null;

    const currentArgs = this.toolCallMap[toolCallId].args || '';
    const newArgs = mergeStringContent(currentArgs, event.delta || '');

    this.toolCallMap[toolCallId] = updateToolCall(this.toolCallMap[toolCallId], {
      eventType: 'TOOL_CALL_CHUNK',
      args: newArgs,
    });

    return this.updateToolCallInContext(toolCallId, 'streaming');
  }

  /**
   * 处理工具调用结果事件
   */
  private handleToolCallResult(event: any): AIMessageContent | null {
    if (!this.toolCallMap[event.toolCallId]) return null;

    const currentResult = this.toolCallMap[event.toolCallId].result || '';
    const newResult = mergeStringContent(currentResult, event.content || '');

    // 更新内部ToolCall对象
    this.toolCallMap[event.toolCallId] = updateToolCall(this.toolCallMap[event.toolCallId], {
      eventType: AGUIEventType.TOOL_CALL_RESULT,
      result: newResult,
    });

    // 处理 suggestion 特殊情况
    const suggestionContent = handleSuggestionToolCall(this.toolCallMap[event.toolCallId]);
    if (suggestionContent) {
      return suggestionContent;
    }

    return this.updateToolCallInContext(event.toolCallId, 'complete');
  }

  /**
   * 处理工具调用结束事件
   */
  private handleToolCallEnd(event: any) {
    // 标记工具调用结束
    this.toolCallEnded.add(event.toolCallId);
    
    // 更新 toolCallMap 中的 eventType
    if (this.toolCallMap[event.toolCallId]) {
      this.toolCallMap[event.toolCallId] = {
        ...this.toolCallMap[event.toolCallId],
        eventType: AGUIEventType.TOOL_CALL_END,
      };
    }
    
    return this.updateToolCallInContext(event.toolCallId, 'complete');
  }

  /**
   * 更新独立的 toolcall 内容块
   *
   * 通过相同的 type (toolcall-${toolCallName}-${toolCallId}) 触发 merge 策略。
   */
  private updateToolCallInContext(toolCallId: string, status: 'streaming' | 'complete'): AIMessageContent | null {
    return createToolCallContent(this.toolCallMap[toolCallId], status, 'merge');
  }
}

export default AGUIEventMapper;
