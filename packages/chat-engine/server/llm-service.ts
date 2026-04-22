import type { AIMessageContent, ChatRequestParams, ChatServiceConfig, ChatTransport, SSEChunkData } from '../type';
import { LoggerManager } from '../utils/logger';
import { BatchClient } from './batch-client';
import { SSEClient } from './sse-client';
import { WebSocketClient } from './websocket-client';

// 与原有接口保持兼容
export interface ILLMService {
  /**
   * 处理批量请求（非流式）
   */
  handleBatchRequest(
    params: ChatRequestParams,
    config: ChatServiceConfig,
  ): Promise<AIMessageContent | AIMessageContent[]>;

  /**
   * 处理流式请求（SSE 或 WebSocket）
   */
  handleStreamRequest(params: ChatRequestParams, config: ChatServiceConfig): Promise<void>;
}

/**
 * LLM Service — 负责 Fetch / SSE / WebSocket 请求
 *
 * 根据 config.transport 自动选择传输方式：
 * - 'fetch': BatchClient（非流式）
 * - 'sse': SSEClient（流式，默认）
 * - 'ws': WebSocketClient（流式）
 *
 * 注意：OpenClaw WebSocket 连接已移至 OpenClawStreamHandler 管理，
 * LLMService 不再感知 OpenClaw 的存在。
 */
export class LLMService implements ILLMService {
  private sseClient: SSEClient | null = null;

  private wsClient: WebSocketClient | null = null;

  private batchClient: BatchClient | null = null;

  private isDestroyed = false;

  /** WS 长连接模式标记：initWSConnection 成功后设为 true，表示 WS 连接跨消息复用 */
  private wsPersistent = false;

  private logger = LoggerManager.getLogger();

  /**
   * 解析传输方式：优先使用 transport，兼容旧的 stream 字段
   */
  static resolveTransport(config: ChatServiceConfig): ChatTransport {
    if (config.transport) return config.transport;
    if (config.stream === false) return 'fetch';
    return 'sse';
  }

  /**
   * 处理批量请求（非流式）
   */
  async handleBatchRequest(
    params: ChatRequestParams,
    config: ChatServiceConfig,
  ): Promise<AIMessageContent | AIMessageContent[]> {
    // 确保只有一个客户端实例
    this.batchClient = this.batchClient || new BatchClient();
    this.batchClient.on('error', (error) => {
      config.onError?.(error);
    });

    const req = (await config.onRequest?.(params)) || params;

    try {
      const data = await this.batchClient.request<AIMessageContent>(
        config.endpoint!,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...req.headers,
          },
          body: req.body,
        },
        config.timeout,
      );
      if (data) {
        const result = config.onComplete?.(false, req, data);
        // 如果onComplete返回了内容，使用它；否则使用原始data
        return result || data;
      }
      // 如果没有data，返回空数组
      return [];
    } catch (error) {
      config.onError?.(error as Error | Response);
      throw error;
    }
  }

  /**
   * 初始化 WebSocket 连接
   *
   * 建立连接并绑定基础事件处理器（onStart / onMessage）。
   *
   * 基础 onMessage 绑定 config.onChunk，使 connectWS 建连后即可处理
   * 如后端主动推送的事件（如 HISTORY_MESSAGES）。
   */
  async initWSConnection(config: ChatServiceConfig): Promise<void> {
    if (!config.endpoint) return;

    // 清理旧连接（先取消重连，再关闭）
    if (this.wsClient) {
      this.wsClient.removeAllListeners();
      await this.wsClient.close().catch(() => {});
      this.wsClient = null;
    }

    this.wsClient = new WebSocketClient(config.endpoint);
    this.wsPersistent = true;

    // 设置基础事件处理器
    this.wsClient.on('start', (chunk) => {
      config.onStart?.(chunk);
    });

    // 绑定 onChunk 处理后端主动推送的事件（如 HISTORY_MESSAGES）
    this.wsClient.on('message', (msg) => {
      const chunk = msg as SSEChunkData;
      if (config.isValidChunk && !config.isValidChunk(chunk)) return;
      config.onChunk?.(chunk);
    });

    // 长连接模式下禁用客户端心跳超时检测，避免用户空闲时触发不必要的断连重连。
    // 连接保活依赖 WebSocket 协议层的 ping/pong 或服务端心跳。
    await this.wsClient.connect({
      ...config.ws,
      heartbeatInterval: 0,
    });

    this.logger.info(`WebSocket connection established to ${config.endpoint}`);
  }

  /**
   * 处理流式请求 — 根据 transport 自动选择 SSE 或 WebSocket
   *
   * 注意：OpenClaw 协议不再走此方法，而是由 OpenClawStreamHandler 直接管理。
   */
  async handleStreamRequest(params: ChatRequestParams, config: ChatServiceConfig): Promise<void> {
    if (!config.endpoint) return;

    const transport = LLMService.resolveTransport(config);

    if (transport === 'ws') {
      await this.handleWSStreamRequest(params, config);
    } else {
      await this.handleSSEStreamRequest(params, config);
    }
  }

  /**
   * SSE 流式请求（原有逻辑）
   */
  private async handleSSEStreamRequest(params: ChatRequestParams, config: ChatServiceConfig): Promise<void> {
    this.sseClient = new SSEClient(config.endpoint!);

    const req = (await config.onRequest?.(params)) || {};

    // 设置事件处理器
    this.sseClient.on('start', (chunk) => {
      config.onStart?.(chunk);
    });

    this.sseClient.on('message', (msg) => {
      const chunk = msg as SSEChunkData;
      // 如果配置了 isValidChunk 且返回 false，则跳过该 chunk
      if (config.isValidChunk && !config.isValidChunk(chunk)) return;
      config.onMessage?.(chunk);
    });

    this.sseClient.on('error', (error) => {
      config.onError?.(error);
    });

    this.sseClient.on('complete', (isAborted) => {
      config.onComplete?.(isAborted, req);
    });

    await this.sseClient.connect(req);
  }

  /**
   * WebSocket 流式请求
   * 
   * WS 消息格式需兼容 SSEChunkData（{ event, data }），
   * 以便上层 StreamHandler（AGUIStreamHandler / DefaultStreamHandler）无感知地处理。
   *
   * 按需建连：无连接时自动调用 initWSConnection 建立连接，
   * 重新绑定事件处理器 + 发送消息
   */
  private async handleWSStreamRequest(params: ChatRequestParams, config: ChatServiceConfig): Promise<void> {
    // 如果连接不存在或已断开，通过 initWSConnection 按需建连
    if (!this.wsClient || !this.wsClient.isConnected()) {
      await this.initWSConnection(config);
    }

    // 重新绑定事件处理器（每次发消息时用最新的 config 回调）
    this.wsClient!.removeAllListeners();

    // 设置事件处理器（与 SSE 事件模型一致）
    this.wsClient!.on('start', (chunk) => {
      config.onStart?.(chunk);
    });

    this.wsClient!.on('message', (msg) => {
      const chunk = msg as SSEChunkData;
      if (config.isValidChunk && !config.isValidChunk(chunk)) return;
      config.onMessage?.(chunk);
    });

    this.wsClient!.on('error', (error) => {
      config.onError?.(error);
    });

    this.wsClient!.on('complete', (isAborted) => {
      config.onComplete?.(isAborted, params);
    });

    // 发送请求
    const req = (await config.onRequest?.(params)) || params;
    this.wsClient!.send(req);
  }

  /**
   * 关闭所有客户端连接
   *
   * 注意：WS 长连接模式下（wsPersistent=true），不会关闭 WS 连接本身，
   * 只会移除事件监听器以停止当前消息的流式处理。WS 连接由 destroy() 统一销毁。
   */
  closeConnect(): void {
    if (this.sseClient) {
      this.sseClient.abort();
      this.sseClient = null;
    }
    if (this.wsClient) {
      if (this.wsPersistent) {
        // 长连接模式：只移除事件监听器，不关闭连接
        this.wsClient.removeAllListeners();
      } else {
        this.wsClient.close();
        this.wsClient = null;
      }
    }
    if (this.batchClient) {
      this.batchClient.abort();
      this.batchClient = null;
    }
  }

  /**
   * 获取 SSE 连接统计
   */
  getSSEStats(): { id: string; status: string; info: any } | null {
    if (!this.sseClient) return null;

    return {
      id: this.sseClient.connectionId,
      status: this.sseClient.getStatus(),
      info: this.sseClient.getInfo(),
    };
  }

  /**
   * 获取 WebSocket 连接统计
   */
  getWSStats(): { id: string; status: string; info: any } | null {
    if (!this.wsClient) return null;

    return {
      id: this.wsClient.connectionId,
      status: this.wsClient.getStatus(),
      info: this.wsClient.getInfo(),
    };
  }

  /**
   * 检查 WebSocket 是否处于已连接状态
   */
  isWSConnected(): boolean {
    return !!this.wsClient?.isConnected();
  }

  /**
   * 断开 WebSocket 长连接
   *
   * 与destroy方法的区别是，disconnectWS不会设置isDestroyed为true
   */
  disconnectWS(): void {
    this.wsPersistent = false;
    this.closeConnect();
  }

  /**
   * 销毁服务（彻底关闭所有连接，包括 WS 长连接）
   */
  async destroy(): Promise<void> {
    this.isDestroyed = true;
    this.wsPersistent = false; // 取消长连接模式，确保 closeConnect 能关闭 WS
    this.closeConnect();
    this.logger.info('LLM Service destroyed');
  }
}