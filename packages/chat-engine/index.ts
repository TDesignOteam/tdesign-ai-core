/* eslint-disable no-param-reassign */
/* eslint-disable class-methods-use-this */
import { MessageStore } from './store/message';
import type { ChatEventBusOptions, IChatEventBus } from './event-bus';
import { ChatEngineEventType, ChatEventBus } from './event-bus';
import MessageProcessor from './processor';
import { LLMService } from './server';
import {
  createStreamHandler,
  type AGUIStreamHandler,
  type IStreamHandler,
  type OpenClawStreamHandler,
  type StreamContext,
} from './stream-handlers';
import type {
  AIMessageContent,
  ChatMessagesData,
  ChatMessageSetterMode,
  ChatRequestParams,
  ChatServiceConfig,
  ChatServiceConfigSetter,
  ChatStatus,
  IChatEngine,
  SystemMessage,
} from './type';

/**
 * 聊天引擎主类。
 *
 * 负责生命周期、消息编排、传输层连接，以及协议 StreamHandler 的调度。
 * 业务层通常只需要使用 public 方法；协议细节（AG-UI / OpenClaw）通过
 * {@link ChatEngine.agui} / {@link ChatEngine.openclaw} 快捷访问器或
 * {@link ChatEngine.getStreamHandler} 获取。
 */
export default class ChatEngine implements IChatEngine {
  // ──────────────────────────────────────────────
  // Fields
  // ──────────────────────────────────────────────

  /** 消息仓库，负责所有消息 CRUD 与对应事件广播 */
  public readonly messageStore: MessageStore;

  /** 事件总线，支持无 UI 场景下的事件分发 */
  public readonly eventBus: IChatEventBus;

  /** 消息处理器，承载内容块合并策略 */
  public readonly messageProcessor: MessageProcessor;

  private llmService!: LLMService;

  private config!: ChatServiceConfig;

  /** 流式处理策略，由协议类型决定（Strategy 模式） */
  private streamHandler!: IStreamHandler;

  private lastRequestParams: ChatRequestParams | undefined;

  private stopReceive = false;

  /** 防止 React StrictMode 等场景下重复调用 init */
  private initialized = false;

  /** connect() 去重：正在进行中的连接 Promise */
  private _connectingPromise: Promise<void> | null = null;

  // ──────────────────────────────────────────────
  // Constructor
  // ──────────────────────────────────────────────

  constructor(eventBusOptions?: ChatEventBusOptions) {
    this.eventBus = new ChatEventBus(eventBusOptions);
    this.messageProcessor = new MessageProcessor();
    this.messageStore = new MessageStore(this.eventBus);
  }

  // ──────────────────────────────────────────────
  // Accessors
  // ──────────────────────────────────────────────

  /** 当前所有消息 */
  public get messages(): ChatMessagesData[] {
    return this.messageStore.messages;
  }

  /** 当前聊天状态（取最后一条消息的状态，无消息时为 `'idle'`） */
  public get status(): ChatStatus {
    return this.messages.at(-1)?.status || 'idle';
  }

  /**
   * AG-UI 协议快捷访问器：协议匹配时返回 handler 实例，否则返回 `null`。
   *
   * @example
   * engine.agui?.handleEvent(chunk, {});
   * engine.agui?.getToolcallByName('search');
   */
  public get agui(): AGUIStreamHandler | null {
    return this.streamHandler?.protocol === 'agui' ? (this.streamHandler as AGUIStreamHandler) : null;
  }

  /**
   * OpenClaw 协议快捷访问器：协议匹配时返回 handler 实例，否则返回 `null`。
   *
   * @example
   * engine.openclaw?.getAdapter()?.invokeAction(...);
   */
  public get openclaw(): OpenClawStreamHandler | null {
    return this.streamHandler?.protocol === 'openclaw' ? (this.streamHandler as OpenClawStreamHandler) : null;
  }

  // ──────────────────────────────────────────────
  // Lifecycle
  // ──────────────────────────────────────────────

  /**
   * 初始化聊天引擎。
   *
   * 设置初始消息、配置服务参数，并根据协议类型创建对应的 StreamHandler。
   * 幂等：重复调用会被忽略（React StrictMode 友好）。
   */
  public async init(configSetter: ChatServiceConfigSetter, initialMessages?: ChatMessagesData[]) {
    if (this.initialized) return;
    this.initialized = true;

    // 清理上一次 init 遗留的 handler（StrictMode 重复调用导致的孤儿连接）
    if (this.streamHandler) {
      try {
        await this.streamHandler.destroy?.();
      } catch {
        // 旧连接可能尚在 CONNECTING 阶段，忽略关闭时的异常
      }
    }

    this.messageStore.initialize(this.convertMessages(initialMessages));
    this.config = typeof configSetter === 'function' ? configSetter() : configSetter || {};
    this.llmService = new LLMService();

    this.streamHandler = createStreamHandler({
      protocol: this.config.protocol,
      llmService: this.llmService,
    });

    // 协议级生命周期初始化（如 OpenClaw 预建 WS + 历史回填）
    // fire-and-forget：init 不阻塞协议握手
    void this.streamHandler.initialize?.(this.config, {
      messageStore: this.messageStore,
      eventBus: this.eventBus,
    });

    this.eventBus.emit(ChatEngineEventType.ENGINE_INIT, {
      timestamp: Date.now(),
    });
  }

  /** 销毁实例：中止请求、清理存储、关闭连接，释放所有资源 */
  public destroy(): void {
    this.eventBus.emit(ChatEngineEventType.ENGINE_DESTROY, {
      timestamp: Date.now(),
    });

    this.abortChat();
    this.llmService.destroy();
    this.messageStore.clearHistory();
    this.messageStore.destroy();
    this.streamHandler?.destroy?.();
    this.eventBus.destroy();
  }

  // ──────────────────────────────────────────────
  // Connection
  // ──────────────────────────────────────────────

  /**
   * 建立传输层连接（幂等 + 去重 + 可选重建）。
   *
   * 行为按 transport 分发：
   * - `ws`：建立 / 复用 WebSocket 连接
   * - `sse` / `fetch`：直接 resolve，本方法为 no-op
   *
   * 语义：
   * - 未传 `configOverrides`：
   *   - 已连接 → 立即返回
   *   - 正在建连 → 复用同一个 Promise（幂等去重）
   *   - 未连接 → 建立新连接并等待握手完成
   * - 传了 `configOverrides`：
   *   - 临时合并到当前 config（不写回 `this.config`）
   *   - 强制关闭现有连接后重建（用于切换会话等场景）
   *
   * 适合在用户开始输入时提前调用，让连接在发送前就绪。
   */
  public async connect(configOverrides?: Partial<ChatServiceConfig>): Promise<void> {
    const config = configOverrides ? { ...this.config, ...configOverrides } : this.config;
    const transport = LLMService.resolveTransport(config);
    if (transport !== 'ws' || !config.endpoint) return;

    // 无覆盖 + 已连接 → 幂等返回
    if (!configOverrides && this.llmService.isWSConnected()) return;

    // 有覆盖 → 强制重建：关闭现有连接并丢弃正在进行的连接 Promise
    if (configOverrides) {
      this.llmService.disconnectWS();
      this._connectingPromise = null;
    }

    if (!this._connectingPromise) {
      this._connectingPromise = this.llmService.initWSConnection(config).finally(() => {
        this._connectingPromise = null;
      });
    }
    return this._connectingPromise;
  }

  /**
   * 断开传输层连接。
   *
   * 先置 `stopReceive` 阻止已缓冲 chunk 继续被处理，再关闭底层连接。
   * 下次发送消息时会自动重置 `stopReceive` 并按需建立新连接。
   * 对 `sse` / `fetch` transport 为 no-op。
   */
  public disconnect(): void {
    this.stopReceive = true;
    this.llmService.disconnectWS();
  }

  /**
   * 声明式更新传输层端点地址。
   *
   * 仅写入 `config.endpoint`，不触发重连；后续按需建连或显式
   * {@link connect} 时会使用新值。
   */
  public updateEndpoint(endpoint: string): void {
    this.config.endpoint = endpoint;
  }

  // ──────────────────────────────────────────────
  // Messaging
  // ──────────────────────────────────────────────

  /**
   * 发送用户消息并获取 AI 回复。
   *
   * 同时创建 user / assistant 两条消息；可选择是否立即发起请求。
   * `prompt` 与 `attachments` 至少需要一个有效值。
   *
   * @param sendRequest 是否立即发送请求，默认 `true`
   */
  public async sendUserMessage(requestParams: ChatRequestParams, sendRequest = true) {
    const { prompt, attachments, ...customParams } = requestParams;

    const hasValidPrompt = prompt && prompt.trim() !== '';
    const hasValidAttachments = Array.isArray(attachments) && attachments.length > 0;
    if (!hasValidPrompt && !hasValidAttachments) {
      console.warn('[ChatEngine] sendUserMessage: 必须提供有效的 prompt 或 attachments');
      return;
    }

    const userMessage = this.messageProcessor.createUserMessage(prompt ?? '', attachments);
    const aiMessage = this.messageProcessor.createAssistantMessage();
    this.messageStore.createMultiMessages([userMessage, aiMessage]);

    if (sendRequest) {
      const params = {
        ...requestParams,
        messageID: aiMessage.id,
        ...customParams,
      };
      this.sendRequest(params);
    }
  }

  /** 发送系统消息（仅落库，不触发请求，通常用于设置上下文或控制对话流程） */
  public async sendSystemMessage(msg: string) {
    const systemMessage = {
      role: 'system',
      content: [
        {
          type: 'text',
          data: msg,
        },
      ],
    } as SystemMessage;
    this.messageStore.createMessage(systemMessage);
  }

  /**
   * 手动创建一条 AI 消息，可选同时发起请求。
   *
   * @param options.params      请求参数
   * @param options.content     初始内容块数组
   * @param options.sendRequest 是否立即发起请求，默认 `true`
   */
  public async sendAIMessage(
    options: { params?: ChatRequestParams; content?: AIMessageContent[]; sendRequest?: boolean } = {},
  ) {
    const { params, content, sendRequest = true } = options;
    await this.dispatchAssistantMessage({ content, params, sendRequest });
  }

  /**
   * 根据当前 transport 发送请求：
   * - `fetch` → 批量请求
   * - `sse` / `ws` → 流式请求
   *
   * 结果通过流回调或 {@link processMessageResult} 写入 store；
   * 异常统一经 {@link emitRequestError} 广播。
   */
  public async sendRequest(params: ChatRequestParams) {
    const { messageID: id } = params;

    this.eventBus.emit(ChatEngineEventType.REQUEST_START, {
      params,
      messageId: id,
    });

    try {
      const transport = LLMService.resolveTransport(this.config);

      if (transport === 'fetch') {
        await this.handleBatchRequest(params);
      } else {
        this.stopReceive = false;
        await this.handleStreamRequest(params);
      }
      this.lastRequestParams = params;
    } catch (error) {
      this.emitRequestError(id!, error, params);
      throw error;
    }
  }

  /**
   * 处理一次消息结果并广播 `MESSAGE_UPDATE` 事件。
   *
   * 支持：
   * - 单个 / 多个内容块
   * - 增量更新（委托 MessageProcessor 合并）
   * - 快照替换（数组带 `_isSnapshot` 标记，对应 `MESSAGES_SNAPSHOT` 语义）
   *
   * 一般由 StreamHandler 通过 {@link StreamContext.processMessageResult} 回调触发，
   * 不建议业务层直接调用。
   */
  public processMessageResult(messageId: string, result: AIMessageContent | AIMessageContent[] | null) {
    if (!result) return;

    if (Array.isArray(result) && (result as any)._isSnapshot) {
      // MESSAGES_SNAPSHOT：整体替换，避免与已有内容拼接冲突
      this.messageStore.replaceContent(messageId, result);
    } else {
      this.messageProcessor.applyContentUpdate(this.messageStore, messageId, result);
    }

    const message = this.messageStore.getMessageByID(messageId);
    if (message) {
      this.eventBus.emit(ChatEngineEventType.MESSAGE_UPDATE, {
        messageId,
        content: result,
        message,
      });

      // 协议级后处理（如 AG-UI 发布细粒度 activity / toolcall 事件）
      this.streamHandler.afterMessageUpdate?.(messageId, result, {
        messageStore: this.messageStore,
        eventBus: this.eventBus,
      });
    }
  }

  /**
   * 恢复未完成的 Agent 运行（断点续传）。
   *
   * 适用场景：用户离开页面后重新进入，后端 Agent 仍在运行。
   *
   * 流程：
   * 1. 创建一条空的 AI 消息承载后续推送
   * 2. 发起 SSE 连接
   * 3. 后端推 `MESSAGES_SNAPSHOT` 恢复已有内容（`replaceContent`）
   * 4. 后端推 `TEXT_MESSAGE_CONTENT` 等增量事件，Processor 正常 append
   * 5. 后端推 `RUN_FINISHED` 结束
   *
   * @param params 请求参数，应包含 `threadId` / `runId` 等续传所需的信息
   * @returns 新创建的 AI 消息 ID
   */
  public async resumeRun(params: ChatRequestParams = {}): Promise<string> {
    return this.dispatchAssistantMessage({
      content: [],
      status: 'pending',
      params,
      sendRequest: true,
    });
  }

  /**
   * 重新生成 AI 回复。
   *
   * @param keepVersion
   *   - `false`（默认）：删除最后一条 AI 消息后创建新消息重新请求
   *   - `true`：保留旧消息作为分支，创建分支消息重新请求
   */
  public async regenerateAIMessage(keepVersion = false) {
    const { lastAIMessage } = this.messageStore;
    if (!lastAIMessage) return;

    if (!keepVersion) {
      this.messageStore.removeMessage(lastAIMessage.id);
    } else {
      // TODO: 保留历史版本，创建新分支
      this.messageStore.createMessageBranch(lastAIMessage.id);
    }

    // 复用上次请求参数（messageID 由 dispatchAssistantMessage 统一注入）
    await this.dispatchAssistantMessage({
      params: {
        ...(this.lastRequestParams || {}),
        prompt: this.lastRequestParams?.prompt ?? '',
      },
      sendRequest: true,
    });
  }

  /**
   * 中止当前进行中的聊天请求。
   *
   * 停止接收流式响应、关闭连接，并调用 `config.onAbort` 回调。
   * ws 模式下通过 `config.abortRequest` 以 fire-and-forget 发送 `/stop`。
   */
  public async abortChat() {
    const transport = LLMService.resolveTransport(this.config);
    const lastAI = this.messageStore.lastAIMessage;

    if (this.config?.onAbort) {
      await this.config.onAbort();
    }

    try {
      if (transport === 'ws') {
        if (lastAI && (lastAI.status === 'streaming' || lastAI.status === 'pending')) {
          this.handleComplete(lastAI.id, true, this.lastRequestParams || ({} as ChatRequestParams));
        }

        if (this.config.abortRequest) {
          const savedParams = this.lastRequestParams;
          try {
            await this.sendRequest({ ...this.config.abortRequest });
          } catch (e) {
            console.warn('[ChatEngine] abort: sendRequest failed', e);
          }
          this.lastRequestParams = savedParams;
        }
      } else {
        this.stopReceive = true;
        this.llmService.closeConnect();
        this.streamHandler.abort?.();

        // 非流式 fetch 模式下，删除最后一条 AI 消息（保持 UI 干净）
        if (transport === 'fetch' && this.messageStore.lastAIMessage?.id) {
          this.messageStore.removeMessage(this.messageStore.lastAIMessage.id);
        }
      }
    } catch (error) {
      console.warn('Error during service cleanup:', error);
    }
  }

  // ──────────────────────────────────────────────
  // Store utilities
  // ──────────────────────────────────────────────

  /**
   * 批量设置消息列表，用于加载历史消息或重置对话。
   *
   * @param mode `'replace'`（替换，默认）/ `'prepend'`（前置）/ `'append'`（追加）
   */
  public setMessages(messages: ChatMessagesData[], mode: ChatMessageSetterMode = 'replace') {
    this.messageStore.setMessages(messages, mode);
  }

  /** 清空消息存储中的所有历史记录 */
  public clearMessages(): void {
    this.messageStore.clearHistory();
  }

  // ──────────────────────────────────────────────
  // Extension
  // ──────────────────────────────────────────────

  /**
   * 注册内容块合并策略，用于自定义不同类型内容的增量更新逻辑。
   *
   * @param type    内容类型（如 `'text'` / `'markdown'`）
   * @param handler 接收新块与现有块，返回合并后的内容块
   */
  public registerMergeStrategy<T extends AIMessageContent>(type: T['type'], handler: (chunk: T, existing?: T) => T) {
    this.messageProcessor.registerHandler(type, handler);
  }

  /**
   * 获取当前协议对应的 StreamHandler 实例（泛型友好通用入口）。
   *
   * 常见协议推荐使用 {@link agui} / {@link openclaw} 快捷访问器；
   * 本方法保留用于：
   * - 自定义扩展协议
   * - 需要在不关心具体协议的场景下访问基础能力（如 `protocol` 字段）
   *
   * 调用方需自行确保协议与期望类型匹配。
   */
  public getStreamHandler<T extends IStreamHandler = IStreamHandler>(): T {
    return this.streamHandler as T;
  }

  // ──────────────────────────────────────────────
  // Internals
  // ──────────────────────────────────────────────

  /**
   * 新建一条 AI 消息并入 store，按需发起 `sendRequest`。
   *
   * 收敛 `sendAIMessage` / `resumeRun` / `regenerateAIMessage` 中重复的
   * "createAssistantMessage → createMessage → sendRequest(带 messageID)" 模式。
   *
   * - `sendRequest=true`：status 默认 `'pending'`，await 等待请求链路结束
   * - `sendRequest=false`：status 默认 `'complete'`，仅落库不发起请求
   *
   * @returns 新建 AI 消息的 ID
   */
  private async dispatchAssistantMessage(options: {
    content?: AIMessageContent[];
    status?: ChatMessagesData['status'];
    params?: ChatRequestParams;
    sendRequest?: boolean;
  }): Promise<string> {
    const { content, status, params, sendRequest = true } = options;
    const aiMessage = this.messageProcessor.createAssistantMessage({
      content,
      status: status ?? (sendRequest ? 'pending' : 'complete'),
    });
    this.messageStore.createMessage(aiMessage);

    if (sendRequest) {
      await this.sendRequest({ ...(params || {}), messageID: aiMessage.id });
    }
    return aiMessage.id;
  }

  /** 非流式批量请求：一次性拿到完整结果后写入 store 并广播完成事件 */
  private async handleBatchRequest(params: ChatRequestParams) {
    const id = params.messageID;
    if (!id) return;

    this.messageStore.setMessageStatus(id, 'pending');
    const result = await this.llmService.handleBatchRequest(params, this.config);
    if (result) {
      this.processMessageResult(id, result);
      this.messageStore.setMessageStatus(id, 'complete');

      const message = this.messageStore.getMessageByID(id);
      if (message) {
        this.eventBus.emit(ChatEngineEventType.REQUEST_COMPLETE, {
          messageId: id,
          params,
          message,
        });
      }
    } else {
      this.emitRequestError(id, new Error('Batch request returned empty result'), params);
    }
  }

  /** 流式请求：委托给 StreamHandler（Default / AGUI / OpenClaw）处理 */
  private async handleStreamRequest(params: ChatRequestParams) {
    const id = params.messageID;
    if (id) {
      this.messageStore.setMessageStatus(id, 'streaming');
    }

    const context = this.buildStreamContext(id);
    await this.streamHandler.handleStream(params, context);
  }

  /**
   * 请求完成 / 中止的统一处理。
   *
   * 先让用户 `onComplete` 回调有机会自定义内容；否则按各内容块状态结算，
   * 并广播 `REQUEST_COMPLETE` 或 `REQUEST_ABORT` 事件。
   */
  private handleComplete(id: string, isAborted: boolean, params: ChatRequestParams, chunk?: unknown) {
    const customResult = this.config.onComplete?.(isAborted, params, chunk);
    if (Array.isArray(customResult) || (customResult && 'status' in customResult)) {
      this.processMessageResult(id, customResult);
    } else {
      // 任何内容块失败，即视为整体失败
      const allContentFailed = this.messageStore.messages.find((content) => content.status === 'error');
      // eslint-disable-next-line no-nested-ternary
      this.messageStore.setMessageStatus(id, isAborted ? 'stop' : allContentFailed ? 'error' : 'complete');
    }

    const message = this.messageStore.getMessageByID(id);
    if (message) {
      if (isAborted) {
        this.eventBus.emit(ChatEngineEventType.REQUEST_ABORT, {
          messageId: id,
          params,
        });
      } else {
        this.eventBus.emit(ChatEngineEventType.REQUEST_COMPLETE, {
          messageId: id,
          params,
          message,
        });
      }
    }
  }

  /** 运行时错误兜底：回调 + 广播 */
  private handleError(id: string, error: unknown) {
    this.config.onError?.(error as Error);
    this.emitRequestError(id, error);
  }

  /**
   * 统一的请求错误发布入口。
   *
   * 把消息状态置为 `'error'` 并广播 `REQUEST_ERROR` 事件。
   * 被 `sendRequest` catch / `handleBatchRequest` 空结果 / `handleError` 三处共用。
   */
  private emitRequestError(messageId: string, error: unknown, params?: ChatRequestParams) {
    this.messageStore.setMessageStatus(messageId, 'error');
    this.eventBus.emit(ChatEngineEventType.REQUEST_ERROR, {
      messageId,
      error,
      ...(params ? { params } : {}),
    });
  }

  /** 构建 StreamHandler 所需的上下文 */
  private buildStreamContext(messageId?: string): StreamContext {
    return {
      messageId,
      config: this.config,
      getStopReceive: () => this.stopReceive,
      processMessageResult: (id, result) => this.processMessageResult(id, result),
      handleError: (id, error) => this.handleError(id, error),
      handleComplete: (id, isAborted, params, chunk?) => this.handleComplete(id, isAborted, params, chunk),
      messageStore: this.messageStore,
      eventBus: this.eventBus,
    };
  }

  /** 把初始消息列表转成 store 所需的 `{ messageIds, messages }` 结构 */
  private convertMessages(messages?: ChatMessagesData[]) {
    if (!messages) return { messageIds: [], messages: [] };
    return {
      messageIds: messages.map((msg) => msg.id),
      messages,
    };
  }
}

export * from './utils';
export * from './adapters';
export * from './event-bus';
export * from './stream-handlers';
export type * from './type';
