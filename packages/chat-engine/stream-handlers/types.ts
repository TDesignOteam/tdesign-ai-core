/**
 * 流式处理策略接口
 *
 * 将不同协议（Default/AGUI/OpenClaw）的流式处理逻辑从 ChatEngine 中抽出，
 * 遵循策略模式，使 ChatEngine 专注于编排，新协议无需修改 ChatEngine。
 *
 * 生命周期（可选钩子）：
 *   initialize → handleStream(* n) → afterMessageUpdate(* n) → abort? → destroy?
 */
import type {
  AIMessageContent,
  ChatMessagesData,
  ChatRequestParams,
  ChatServiceConfig,
} from '../type';
import type { IChatEventBus } from '../event-bus';
import type { MessageStore } from '../store/message';

/**
 * 协议标识（开放字符串，方便扩展自定义协议）
 */
export type StreamProtocol = 'default' | 'agui' | 'openclaw' | (string & {});

/**
 * 流式处理上下文（单次请求级）
 *
 * 由 ChatEngine 在每次 handleStreamRequest 时构建，提供 StreamHandler 所需的引擎能力。
 */
export interface StreamContext {
  /** 当前 AI 消息 ID */
  messageId?: string;
  /** 聊天服务配置 */
  config: ChatServiceConfig;
  /** 是否停止接收 */
  getStopReceive: () => boolean;
  /** 处理消息结果（内容更新 + 事件发布） */
  processMessageResult: (messageId: string, result: AIMessageContent | AIMessageContent[] | null) => void;
  /** 错误处理 */
  handleError: (messageId: string, error: unknown) => void;
  /** 完成处理 */
  handleComplete: (messageId: string, isAborted: boolean, params: ChatRequestParams, chunk?: unknown) => void;
  /** 消息存储（用于获取消息） */
  messageStore: MessageStore;
  /** 事件总线 */
  eventBus: IChatEventBus;
}

/**
 * 生命周期上下文（引擎级，initialize / afterMessageUpdate 共享）
 */
export interface StreamLifecycleContext {
  /** 消息存储（用于历史回填等） */
  messageStore: MessageStore;
  /** 事件总线（用于细粒度事件分发） */
  eventBus: IChatEventBus;
}

/**
 * 流式处理策略接口
 */
export interface IStreamHandler {
  /**
   * 协议标识，便于外部通过 engine.getStreamHandler 做运行时识别
   */
  readonly protocol: StreamProtocol;

  /**
   * 引擎初始化阶段调用（engine.init 里触发）
   *
   * 协议如需预建立连接、注册回调、加载历史等，可在此实现；无需则不必提供。
   */
  initialize?(config: ChatServiceConfig, context: StreamLifecycleContext): Promise<void> | void;

  /**
   * 处理流式请求
   */
  handleStream(params: ChatRequestParams, context: StreamContext): Promise<void>;

  /**
   * 消息结果被写入 store 之后的协议级后处理（如发布协议细粒度事件）
   *
   * 返回值会被忽略；不要在此再次改写消息内容。
   */
  afterMessageUpdate?(
    messageId: string,
    result: AIMessageContent | AIMessageContent[],
    context: StreamLifecycleContext,
  ): void;

  /**
   * 中止当前请求（由 ChatEngine.abort 统一触发）
   *
   * 仅对跨请求级别的协议状态（如 OpenClaw 的 WS abort）有意义；
   * SSE/HTTP 的中止由 LLMService.closeConnect 统一处理。
   */
  abort?(): void | Promise<void>;

  /**
   * 销毁处理器，释放资源
   */
  destroy?(): void | Promise<void>;
}

/**
 * 历史消息回填回调（供需要预加载历史的协议使用）
 *
 * 不在 IStreamHandler 上作为必选字段，协议只需在 initialize 阶段通过
 * config.onHistoryLoaded + messageStore.setMessages 完成回填即可。
 */
export type HistoryMessagesCallback = (messages: ChatMessagesData[]) => void;
