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
   */
  private async handleWSStreamRequest(params: ChatRequestParams, config: ChatServiceConfig): Promise<void> {
    this.wsClient = new WebSocketClient(config.endpoint!);

    // 设置事件处理器（与 SSE 事件模型一致）
    this.wsClient.on('start', (chunk) => {
      config.onStart?.(chunk);
    });

    this.wsClient.on('message', (msg) => {
      const chunk = msg as SSEChunkData;
      if (config.isValidChunk && !config.isValidChunk(chunk)) return;
      config.onMessage?.(chunk);
    });

    this.wsClient.on('error', (error) => {
      config.onError?.(error);
    });

    this.wsClient.on('complete', (isAborted) => {
      config.onComplete?.(isAborted, params);
    });

    // 建立 WS 连接
    await this.wsClient.connect(config.ws);

    // 连接建立后发送请求
    const req = (await config.onRequest?.(params)) || params;
    this.wsClient.send(req);
  }

  /**
   * 关闭所有客户端连接
   */
  closeConnect(): void {
    if (this.sseClient) {
      this.sseClient.abort();
      this.sseClient = null;
    }
    if (this.wsClient) {
      this.wsClient.close();
      this.wsClient = null;
    }
    if (this.batchClient) {
      this.batchClient.abort();
      this.batchClient = null;
    }
  }

  /**
   * 获取连接统计
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
   * 销毁服务
   */
  async destroy(): Promise<void> {
    this.isDestroyed = true;
    this.closeConnect();
    this.logger.info('LLM Service destroyed');
  }
}
