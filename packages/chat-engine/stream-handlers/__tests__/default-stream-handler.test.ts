import { describe, expect, it, vi } from 'vitest';

import { ChatEngineEventType } from '../../event-bus';
import type { ChatRequestParams, ChatServiceConfig, SSEChunkData } from '../../type';
import { DefaultStreamHandler } from '../default-stream-handler';
import type { StreamContext } from '../types';

function setup(config: ChatServiceConfig = {}, messageId: string | undefined = 'assistant-1') {
  let requestConfig: ChatServiceConfig | undefined;
  const llmService = {
    handleStreamRequest: vi.fn(async (_params: ChatRequestParams, nextConfig: ChatServiceConfig) => {
      requestConfig = nextConfig;
    }),
  };
  const message = { id: 'assistant-1', role: 'assistant', content: [], status: 'streaming' } as const;
  const context = {
    messageId,
    config,
    getStopReceive: vi.fn(() => false),
    processMessageResult: vi.fn(),
    handleError: vi.fn(),
    handleComplete: vi.fn(),
    messageStore: { getMessageByID: vi.fn(() => message) },
    eventBus: { emit: vi.fn() },
  } as unknown as StreamContext;

  return {
    context,
    handler: new DefaultStreamHandler(llmService as never),
    llmService,
    getRequestConfig: () => requestConfig,
  };
}

describe('DefaultStreamHandler', () => {
  it('转发生命周期回调并处理每条消息结果', async () => {
    const result = { type: 'text', data: 'hello' } as const;
    const config: ChatServiceConfig = {
      onStart: vi.fn(),
      onMessage: vi.fn(() => result),
    };
    const { handler, context, llmService, getRequestConfig } = setup(config);
    const params = { prompt: 'Hi', messageID: 'assistant-1' };

    await handler.handleStream(params, context);

    expect(llmService.handleStreamRequest).toHaveBeenCalledWith(
      params,
      expect.objectContaining({
        onStart: expect.any(Function),
        onMessage: expect.any(Function),
        onError: expect.any(Function),
        onComplete: expect.any(Function),
      }),
    );
    const callbacks = getRequestConfig()!;
    const chunk: SSEChunkData = { event: 'message', data: 'raw' };
    callbacks.onStart?.('started');
    expect(callbacks.onMessage?.(chunk)).toEqual(result);
    callbacks.onError?.(new Error('network'));
    callbacks.onComplete?.(false, params);

    expect(config.onStart).toHaveBeenCalledWith('started');
    expect(config.onMessage).toHaveBeenCalledWith(chunk, expect.objectContaining({ id: 'assistant-1' }));
    expect(context.eventBus.emit).toHaveBeenCalledWith(ChatEngineEventType.REQUEST_STREAM, {
      messageId: 'assistant-1',
      chunk,
      content: result,
    });
    expect(context.processMessageResult).toHaveBeenCalledWith('assistant-1', result);
    expect(context.handleError).toHaveBeenCalledWith('assistant-1', expect.any(Error));
    expect(context.handleComplete).toHaveBeenCalledWith('assistant-1', false, params);
  });

  it('停止接收后忽略数据块', async () => {
    const stopped = true;
    const messageId = 'assistant-1';
    const config: ChatServiceConfig = { onMessage: vi.fn() };
    const { handler, context, getRequestConfig } = setup(config, messageId);
    vi.mocked(context.getStopReceive).mockReturnValue(stopped);

    await handler.handleStream({}, context);
    const value = getRequestConfig()!.onMessage!({ data: 'ignored' });

    expect(value).toBeNull();
    expect(config.onMessage).not.toHaveBeenCalled();
    expect(context.eventBus.emit).not.toHaveBeenCalled();
    expect(context.processMessageResult).not.toHaveBeenCalled();
  });
});
