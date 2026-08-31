import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatEngineEventType } from '../../event-bus';
import type { AIMessageContent, ChatMessagesData, ChatServiceConfig } from '../../type';
import type { StreamContext, StreamLifecycleContext } from '../types';

const adapterState = vi.hoisted(() => {
  class MockOpenClawAdapter {
    callbacks: Record<string, (...args: never[]) => unknown> = {};
    authenticated = false;
    abort = vi.fn();
    connect = vi.fn(async () => {
      this.authenticated = true;
    });
    destroy = vi.fn(async () => undefined);
    isAuthenticated = vi.fn(() => this.authenticated);
    sendMessage = vi.fn(async () => undefined);
    setCallbacks = vi.fn((callbacks: Record<string, (...args: never[]) => unknown>) => {
      this.callbacks = callbacks;
    });
    setConnectAuth = vi.fn();

    constructor(public config: unknown) {
      instances.push(this);
    }
  }
  const instances: MockOpenClawAdapter[] = [];
  return { Adapter: MockOpenClawAdapter, instances };
});

vi.mock('../../adapters/openclaw', () => ({ OpenClawAdapter: adapterState.Adapter }));
vi.mock('../../utils/logger', () => ({
  LoggerManager: { getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));

import { OpenClawStreamHandler } from '../openclaw-stream-handler';

function lifecycleContext() {
  return {
    messageStore: { setMessages: vi.fn() },
    eventBus: { emit: vi.fn() },
  } as unknown as StreamLifecycleContext;
}

function streamContext(config: ChatServiceConfig): StreamContext {
  return {
    messageId: 'assistant-1',
    config,
    getStopReceive: vi.fn(() => false),
    processMessageResult: vi.fn(),
    handleError: vi.fn(),
    handleComplete: vi.fn(),
    messageStore: { getMessageByID: vi.fn(() => ({ id: 'assistant-1' })) },
    eventBus: { emit: vi.fn() },
  } as unknown as StreamContext;
}

describe('OpenClawStreamHandler', () => {
  beforeEach(() => {
    adapterState.instances.length = 0;
  });

  it('带鉴权预连接，并在历史消息到达时替换 store', async () => {
    const history = [{ id: 'old-1', role: 'assistant', content: [] }] as ChatMessagesData[];
    const config: ChatServiceConfig = {
      endpoint: 'wss://gateway.example',
      timeout: 500,
      openclaw: { client: { id: 'client-1' } },
      onRequest: vi.fn(async () => ({ auth: { token: 'secret' } })),
      onHistoryLoaded: vi.fn(),
    };
    const context = lifecycleContext();
    const handler = new OpenClawStreamHandler({ llmService: {} as never });

    await handler.initialize(config, context);

    const adapter = adapterState.instances[0];
    expect(adapter.config).toEqual(
      expect.objectContaining({ endpoint: config.endpoint, timeout: 500, client: { id: 'client-1' } }),
    );
    expect(config.onRequest).toHaveBeenCalledWith({ prompt: '' });
    expect(adapter.setConnectAuth).toHaveBeenCalledWith({ token: 'secret' });
    expect(adapter.connect).toHaveBeenCalledOnce();
    adapter.callbacks.onHistoryLoaded(history as never);
    expect(context.messageStore.setMessages).toHaveBeenCalledWith(history, 'replace');
    expect(config.onHistoryLoaded).toHaveBeenCalledWith(history);
  });

  it('上报初始化连接失败但不 reject', async () => {
    const error = new Error('offline');
    let releaseAuth!: (value: void) => void;
    const config: ChatServiceConfig = {
      endpoint: 'wss://gateway.example',
      onError: vi.fn(),
      onRequest: vi.fn(() => new Promise<void>((resolve) => (releaseAuth = resolve))),
    };
    const handler = new OpenClawStreamHandler({ llmService: {} as never });
    const initialize = handler.initialize(config, lifecycleContext());
    adapterState.instances[0].connect.mockRejectedValueOnce(error);
    releaseAuth();

    await expect(initialize).resolves.toBeUndefined();
    expect(config.onError).toHaveBeenCalledWith(error);
  });

  it('连接、发送归一化的请求参数并处理流式回调', async () => {
    const custom = { type: 'markdown', data: 'custom' } as const;
    const config: ChatServiceConfig = {
      endpoint: 'wss://gateway.example',
      onRequest: vi
        .fn()
        .mockResolvedValueOnce({ auth: { token: 'secret' } })
        .mockResolvedValueOnce({ sessionKey: 'session-1' }),
      onStart: vi.fn(),
      onMessage: vi.fn(() => custom),
    };
    const context = streamContext(config);
    const params = { prompt: 'hello', messageID: 'assistant-1' };
    const handler = new OpenClawStreamHandler({ llmService: {} as never });

    await handler.handleStream(params, context);

    const adapter = adapterState.instances[0];
    expect(adapter.connect).toHaveBeenCalledOnce();
    expect(adapter.sendMessage).toHaveBeenCalledWith(params, { sessionKey: 'session-1' });
    adapter.callbacks.onStart();
    const content = { type: 'text', data: 'gateway' } as AIMessageContent;
    adapter.callbacks.onMessage(content as never);
    adapter.callbacks.onComplete(false as never, params as never);

    expect(config.onStart).toHaveBeenCalledWith('openclaw:stream:start');
    expect(config.onMessage).toHaveBeenCalledWith({ event: 'openclaw', data: content }, { id: 'assistant-1' }, content);
    expect(context.eventBus.emit).toHaveBeenCalledWith(ChatEngineEventType.REQUEST_STREAM, {
      messageId: 'assistant-1',
      chunk: { event: 'openclaw', data: content },
      content: custom,
    });
    expect(context.processMessageResult).toHaveBeenCalledWith('assistant-1', custom);
    expect(context.handleComplete).toHaveBeenCalledWith('assistant-1', false, params);
  });

  it('归一化非对象类型的 onRequest 结果并重新抛出发送失败', async () => {
    const error = new Error('send failed');
    const config = {
      endpoint: 'wss://gateway.example',
      onRequest: vi.fn().mockResolvedValue('invalid'),
    } as unknown as ChatServiceConfig;
    const context = streamContext(config);
    const handler = new OpenClawStreamHandler({ llmService: {} as never });
    await handler.initialize({ endpoint: 'wss://gateway.example' }, lifecycleContext());
    const adapter = adapterState.instances[0];
    adapter.authenticated = true;
    adapter.sendMessage.mockRejectedValueOnce(error);
    const promise = handler.handleStream({ prompt: 'hello' }, context);

    await expect(promise).rejects.toBe(error);
    expect(adapter.sendMessage).toHaveBeenCalledWith({ prompt: 'hello' }, {});
    expect(context.handleError).toHaveBeenCalledWith('assistant-1', error);
  });

  it('中止并销毁持有的适配器', async () => {
    const handler = new OpenClawStreamHandler({ llmService: {} as never });
    await handler.initialize({ endpoint: 'wss://gateway.example' }, lifecycleContext());
    const adapter = adapterState.instances[0];

    handler.abort();
    expect(adapter.abort).toHaveBeenCalledOnce();
    await handler.destroy();
    expect(adapter.destroy).toHaveBeenCalledOnce();
    expect(handler.getAdapter()).toBeNull();
  });

  it('初始化之前调用 abort 与 destroy 也能容错', async () => {
    const handler = new OpenClawStreamHandler({ llmService: {} as never });

    expect(() => handler.abort()).not.toThrow();
    await expect(handler.destroy()).resolves.toBeUndefined();
    expect(handler.getAdapter()).toBeNull();
  });

  it('没有端点时完全跳过预连接', async () => {
    const handler = new OpenClawStreamHandler({ llmService: {} as never });

    await handler.initialize({}, lifecycleContext());

    expect(adapterState.instances).toHaveLength(0);
    expect(handler.getAdapter()).toBeNull();
  });

  it('历史消息为空时保持 store 不变', async () => {
    const config: ChatServiceConfig = { endpoint: 'wss://gateway.example', onHistoryLoaded: vi.fn() };
    const context = lifecycleContext();
    const handler = new OpenClawStreamHandler({ llmService: {} as never });
    await handler.initialize(config, context);

    adapterState.instances[0].callbacks.onHistoryLoaded([] as never);

    expect(context.messageStore.setMessages).not.toHaveBeenCalled();
    expect(config.onHistoryLoaded).not.toHaveBeenCalled();
  });

  it('停止接收生效时忽略流式消息', async () => {
    const config: ChatServiceConfig = { endpoint: 'wss://gateway.example' };
    const context = streamContext(config);
    vi.mocked(context.getStopReceive).mockReturnValue(true);
    const handler = new OpenClawStreamHandler({ llmService: {} as never });
    await handler.initialize(config, lifecycleContext());
    adapterState.instances[0].authenticated = true;

    await handler.handleStream({ prompt: 'hello' }, context);
    adapterState.instances[0].callbacks.onMessage({ type: 'text', data: 'late' } as never);

    expect(context.eventBus.emit).not.toHaveBeenCalled();
    expect(context.processMessageResult).not.toHaveBeenCalled();
  });
});
