import EventEmitter from '../utils/eventEmitter';
import { LoggerManager } from '../utils/logger';
import { ConnectionError, TimeoutError } from './errors';

/**
 * 批量请求客户端（非流式）
 */
export class BatchClient extends EventEmitter {
  private controller: AbortController | null = null;

  private logger = LoggerManager.getLogger();

  /**
   * 发送批量请求
   * @param endpoint API端点
   * @param request 请求参数
   * @param timeout 超时时间（毫秒）
   * @returns 响应数据
   */
  /**
   * 兼容历史契约：公开类型长期承诺 `Promise<T>`，但失败时运行时返回空值。
   * 实现签名保留真实的 `unknown` 返回，避免在内部伪造泛型值；后续大版本可统一错误契约。
   */
  async request<T>(endpoint: string, request: RequestInit, timeout?: number): Promise<T>;
  async request(endpoint: string, request: RequestInit, timeout = 1000000): Promise<unknown> {
    // 中止上一个请求
    this.abort();

    this.controller = new AbortController();
    const timeoutId = setTimeout(() => {
      if (!this.controller?.signal.aborted) {
        this.controller?.abort();
      }
      this.emit('error', new TimeoutError(`Request timed out after ${timeout}ms`));
    }, timeout);

    try {
      const response = await fetch(endpoint, {
        ...request,
        signal: this.controller.signal,
      });

      if (!response.ok) {
        this.emit('error', new ConnectionError(`HTTP error! status: ${response.status}`));
        return null;
      }
      return response.json();
    } catch (error: unknown) {
      if (!(error instanceof Error) || error.name !== 'AbortError') {
        this.logger.error('Batch request failed:', error);
        this.emit('error', error);
      }
      return undefined;
    } finally {
      clearTimeout(timeoutId);
      this.controller = null;
    }
  }

  /**
   * 中止当前请求
   */
  abort(): void {
    if (this.controller) {
      this.controller.abort();
      this.controller = null;
    }
  }
}
