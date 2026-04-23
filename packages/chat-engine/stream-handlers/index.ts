/**
 * StreamHandler 模块
 *
 * 统一导出 + 工厂函数
 */
export type { IStreamHandler, StreamContext } from './types';
export { DefaultStreamHandler } from './default-stream-handler';
export { AGUIStreamHandler } from './agui-stream-handler';
export { OpenClawStreamHandler } from './openclaw-stream-handler';

import { LLMService } from '../server';
import type { IStreamHandler, StreamProtocol } from './types';
import { DefaultStreamHandler } from './default-stream-handler';
import { AGUIStreamHandler } from './agui-stream-handler';
import { OpenClawStreamHandler } from './openclaw-stream-handler';

export interface CreateStreamHandlerOptions {
  protocol?: StreamProtocol;
  llmService: LLMService;
}

/**
 * 工厂函数：根据协议类型创建对应的 StreamHandler
 *
 * 协议所需的适配器（如 AGUIAdapter）由对应 handler 内部自行创建和管理，
 * ChatEngine 不再持有协议特定适配器的引用。
 */
export function createStreamHandler(options: CreateStreamHandlerOptions): IStreamHandler {
  const { protocol, llmService } = options;

  switch (protocol) {
    case 'agui':
      return new AGUIStreamHandler(llmService);

    case 'openclaw':
      return new OpenClawStreamHandler({ llmService });

    default:
      return new DefaultStreamHandler(llmService);
  }
}
