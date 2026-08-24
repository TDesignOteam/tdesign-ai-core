import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatRequestParams, ChatServiceConfig } from '../type';

const mocks = vi.hoisted(() => {
  const serviceInstances: Array<Record<string, ReturnType<typeof vi.fn>>> = [];
  const handlerInstances: Array<Record<string, unknown>> = [];
  const resolveTransport = vi.fn(
    (config: ChatServiceConfig) => config.transport ?? (config.stream === false ? 'fetch' : 'sse'),
  );

  return { handlerInstances, resolveTransport, serviceInstances };
});

vi.mock('../server', () => {
  class LLMService {
    static resolveTransport = mocks.resolveTransport;
    closeConnect = vi.fn();
    destroy = vi.fn();
    disconnectWS = vi.fn();
    handleBatchRequest = vi.fn();
    handleStreamRequest = vi.fn();
    initWSConnection = vi.fn(async () => undefined);
    isWSConnected = vi.fn(() => false);

    constructor() {
      mocks.serviceInstances.push(this as unknown as Record<string, ReturnType<typeof vi.fn>>);
    }
  }
  return { LLMService };
});

vi.mock('../stream-handlers', () => ({
  createStreamHandler: vi.fn(({ protocol }: { protocol?: string }) => {
    const handler = {
      protocol: protocol ?? 'default',
      initialize: vi.fn(),
      handleStream: vi.fn(async () => undefined),
      afterMessageUpdate: vi.fn(),
      abort: vi.fn(),
      destroy: vi.fn(),
    };
    mocks.handlerInstances.push(handler);
    return handler;
  }),
}));

import ChatEngine, { ChatEngineEventType } from '../index';
import { createStreamHandler } from '../stream-handlers';

const initialMessage = {
  id: 'initial-1',
  role: 'assistant' as const,
  status: 'complete' as const,
  content: [{ type: 'text' as const, data: 'existing' }],
};

describe('ChatEngine', () => {
  beforeEach(() => {
    mocks.handlerInstances.length = 0;
    mocks.serviceInstances.length = 0;
    mocks.resolveTransport.mockImplementation(
      (config: ChatServiceConfig) => config.transport ?? (config.stream === false ? 'fetch' : 'sse'),
    );
  });

  it('仅初始化一次，包含消息、协议处理器与生命周期事件', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    const engine = new ChatEngine();
    const onInit = vi.fn();
    engine.eventBus.on(ChatEngineEventType.ENGINE_INIT, onInit);
    const config = { protocol: 'agui' as const, endpoint: '/chat' };

    await engine.init(() => config, [initialMessage]);
    await engine.init({ protocol: 'openclaw' });

    expect(engine.messages).toEqual([initialMessage]);
    expect(createStreamHandler).toHaveBeenCalledOnce();
    expect(createStreamHandler).toHaveBeenCalledWith({ protocol: 'agui', llmService: mocks.serviceInstances[0] });
    expect(mocks.handlerInstances[0].initialize).toHaveBeenCalledWith(config, {
      messageStore: engine.messageStore,
      eventBus: engine.eventBus,
    });
    expect(engine.agui).toBe(mocks.handlerInstances[0]);
    expect(engine.openclaw).toBeNull();
    expect(onInit).toHaveBeenCalledWith({ timestamp: 1000 });
  });

  it('对并发的 WebSocket 连接去重，并在覆盖参数时重建', async () => {
    const engine = new ChatEngine();
    await engine.init({ transport: 'ws', endpoint: 'wss://first' });
    const service = mocks.serviceInstances[0];
    let release!: () => void;
    service.initWSConnection.mockReturnValueOnce(new Promise<void>((resolve) => (release = resolve)));

    const first = engine.connect();
    const second = engine.connect();
    expect(service.initWSConnection).toHaveBeenCalledOnce();
    release();
    await Promise.all([first, second]);

    await engine.connect({ endpoint: 'wss://second' });
    expect(service.disconnectWS).toHaveBeenCalledOnce();
    expect(service.initWSConnection).toHaveBeenLastCalledWith({ transport: 'ws', endpoint: 'wss://second' });
  });

  it('对非 WebSocket 传输方式和已存在的连接跳过连接操作', async () => {
    const engine = new ChatEngine();
    await engine.init({ transport: 'sse', endpoint: '/events' });
    const service = mocks.serviceInstances[0];
    await engine.connect();
    expect(service.initWSConnection).not.toHaveBeenCalled();

    mocks.resolveTransport.mockReturnValue('ws');
    service.isWSConnected.mockReturnValue(true);
    await engine.connect();
    expect(service.initWSConnection).not.toHaveBeenCalled();
  });

  it('按需创建用户与 AI 消息且不发起请求', async () => {
    const engine = new ChatEngine();
    await engine.init({ transport: 'sse' });
    const requestSpy = vi.spyOn(engine, 'sendRequest');

    await engine.sendUserMessage(
      { prompt: '  hello  ', tenant: 'one' } as Parameters<ChatEngine['sendUserMessage']>[0],
      false,
    );

    expect(engine.messages).toHaveLength(2);
    expect(engine.messages[0]).toEqual(expect.objectContaining({ role: 'user', status: 'complete' }));
    expect(engine.messages[0].content).toContainEqual({ type: 'text', data: '  hello  ' });
    expect(engine.messages[1]).toEqual(expect.objectContaining({ role: 'assistant', status: 'pending' }));
    expect(requestSpy).not.toHaveBeenCalled();
  });

  it('对空的用户请求给出警告并忽略', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const engine = new ChatEngine();
    await engine.init({});

    await engine.sendUserMessage({ prompt: '   ', attachments: [] });

    expect(engine.messages).toEqual([]);
    expect(warn).toHaveBeenCalledOnce();
  });

  it('通过选定的处理器上下文编排流式请求', async () => {
    const engine = new ChatEngine();
    await engine.init({ transport: 'sse' });
    await engine.sendAIMessage({ sendRequest: false });
    const messageId = engine.messages[0].id;
    const onStart = vi.fn();
    engine.eventBus.on(ChatEngineEventType.REQUEST_START, onStart);

    await engine.sendRequest({ prompt: 'hello', messageID: messageId });

    const handler = mocks.handlerInstances[0];
    expect(engine.status).toBe('streaming');
    expect(onStart).toHaveBeenCalledWith({ params: { prompt: 'hello', messageID: messageId }, messageId });
    expect(handler.handleStream).toHaveBeenCalledWith(
      { prompt: 'hello', messageID: messageId },
      expect.objectContaining({ messageId, messageStore: engine.messageStore, eventBus: engine.eventBus }),
    );
  });

  it('应用批量请求结果并派发完成事件', async () => {
    const engine = new ChatEngine();
    await engine.init({ transport: 'fetch' });
    await engine.sendAIMessage({ sendRequest: false });
    const messageId = engine.messages[0].id;
    const result = { type: 'text' as const, data: 'complete answer' };
    mocks.serviceInstances[0].handleBatchRequest.mockResolvedValue(result);
    const onComplete = vi.fn();
    engine.eventBus.on(ChatEngineEventType.REQUEST_COMPLETE, onComplete);

    await engine.sendRequest({ prompt: 'hello', messageID: messageId });

    expect(engine.status).toBe('complete');
    expect(engine.messages[0].content).toEqual([{ ...result, status: 'complete' }]);
    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({ messageId, params: { prompt: 'hello', messageID: messageId } }),
    );
  });

  it('标记并派发请求错误后再重新抛出', async () => {
    const engine = new ChatEngine();
    await engine.init({ transport: 'fetch' });
    await engine.sendAIMessage({ sendRequest: false });
    const messageId = engine.messages[0].id;
    const error = new Error('failed');
    mocks.serviceInstances[0].handleBatchRequest.mockRejectedValue(error);
    const onError = vi.fn();
    engine.eventBus.on(ChatEngineEventType.REQUEST_ERROR, onError);

    await expect(engine.sendRequest({ messageID: messageId })).rejects.toBe(error);
    expect(engine.status).toBe('error');
    expect(onError).toHaveBeenCalledWith({ messageId, error, params: { messageID: messageId } });
  });

  it('中止非 WS 传输并委托协议清理', async () => {
    const onAbort = vi.fn(async () => undefined);
    const engine = new ChatEngine();
    await engine.init({ transport: 'sse', onAbort });

    await engine.abortChat();

    expect(onAbort).toHaveBeenCalledOnce();
    expect(mocks.serviceInstances[0].closeConnect).toHaveBeenCalledOnce();
    expect(mocks.handlerInstances[0].abort).toHaveBeenCalledOnce();
  });

  it('中止 fetch 请求时移除末尾的 AI 消息', async () => {
    const engine = new ChatEngine();
    await engine.init({ transport: 'fetch' });
    await engine.sendAIMessage({ sendRequest: false });
    expect(engine.messages).toHaveLength(1);

    await engine.abortChat();

    expect(mocks.serviceInstances[0].closeConnect).toHaveBeenCalledOnce();
    expect(engine.messages).toEqual([]);
  });

  it('在 WebSocket 传输上完成流式消息并转发中止请求', async () => {
    const engine = new ChatEngine();
    await engine.init({ transport: 'ws', endpoint: 'ws://chat', abortRequest: { prompt: '/stop' } });
    const onAbortEvent = vi.fn();
    engine.eventBus.on(ChatEngineEventType.REQUEST_ABORT, onAbortEvent);

    await engine.sendAIMessage({ params: { prompt: 'hello' } });
    const messageId = engine.messages.at(-1)!.id;
    expect(engine.messages.at(-1)!.status).toBe('streaming');

    await engine.abortChat();

    expect(engine.messages.at(-1)!.status).toBe('stop');
    expect(onAbortEvent).toHaveBeenCalledWith({
      messageId,
      params: { prompt: 'hello', messageID: messageId },
    });
    expect(mocks.handlerInstances[0].handleStream).toHaveBeenLastCalledWith(
      expect.objectContaining({ prompt: '/stop' }),
      expect.anything(),
    );
    expect(mocks.serviceInstances[0].closeConnect).not.toHaveBeenCalled();
  });

  it('处理器完成流式时应用自定义 onComplete 内容', async () => {
    const customContent = [{ type: 'text' as const, data: 'custom answer' }];
    const engine = new ChatEngine();
    await engine.init({ transport: 'sse', onComplete: vi.fn(() => customContent) });
    const handler = mocks.handlerInstances[0] as unknown as { handleStream: ReturnType<typeof vi.fn> };
    handler.handleStream.mockImplementation(
      async (
        params: Parameters<ChatEngine['sendRequest']>[0],
        context: { messageId?: string; handleComplete: (id: string, isAborted: boolean, params: unknown) => void },
      ) => {
        context.handleComplete(context.messageId!, false, params);
      },
    );
    const onCompleteEvent = vi.fn();
    engine.eventBus.on(ChatEngineEventType.REQUEST_COMPLETE, onCompleteEvent);

    await engine.sendAIMessage({ params: { prompt: 'hello' } });
    const messageId = engine.messages.at(-1)!.id;

    expect(engine.messages.at(-1)!.content).toEqual(customContent);
    expect(onCompleteEvent).toHaveBeenCalledWith(expect.objectContaining({ messageId }));
  });

  it('以 pending 状态的 AI 消息恢复运行并返回其 id', async () => {
    const engine = new ChatEngine();
    await engine.init({ transport: 'sse' });

    const id = await engine.resumeRun({ threadId: 'thread-1' } as ChatRequestParams<{ threadId: string }>);

    expect(engine.messages).toHaveLength(1);
    expect(id).toBe(engine.messages[0].id);
    expect(engine.messages[0]).toEqual(expect.objectContaining({ role: 'assistant', status: 'streaming' }));
    expect(mocks.handlerInstances[0].handleStream).toHaveBeenCalledWith(
      { threadId: 'thread-1', messageID: id },
      expect.objectContaining({ messageId: id }),
    );
  });

  it('重新生成时替换最后一条 AI 消息并复用先前的参数', async () => {
    const engine = new ChatEngine();
    await engine.init({ transport: 'sse' }, [initialMessage]);
    await engine.sendRequest({ prompt: 'first', messageID: 'initial-1' });

    await engine.regenerateAIMessage();

    expect(engine.messages).toHaveLength(1);
    const regenerated = engine.messages[0];
    expect(regenerated.id).not.toBe('initial-1');
    expect(mocks.handlerInstances[0].handleStream).toHaveBeenLastCalledWith(
      expect.objectContaining({ prompt: 'first', messageID: regenerated.id }),
      expect.objectContaining({ messageId: regenerated.id }),
    );
  });

  it('存储系统消息且不触发请求', async () => {
    const engine = new ChatEngine();
    await engine.init({ transport: 'sse' });
    const requestSpy = vi.spyOn(engine, 'sendRequest');

    await engine.sendSystemMessage('be helpful');

    expect(engine.messages).toHaveLength(1);
    expect(engine.messages[0]).toEqual(expect.objectContaining({ role: 'system' }));
    expect(engine.messages[0].content).toContainEqual({ type: 'text', data: 'be helpful' });
    expect(requestSpy).not.toHaveBeenCalled();
    expect(mocks.handlerInstances[0].handleStream).not.toHaveBeenCalled();
  });

  it('以声明式方式更新端点并在下次连接时使用', async () => {
    const engine = new ChatEngine();
    await engine.init({ transport: 'ws', endpoint: 'wss://first' });

    engine.updateEndpoint('wss://second');
    await engine.connect();

    expect(mocks.serviceInstances[0].initWSConnection).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: 'wss://second' }),
    );
  });

  it('disconnect 拆除 WebSocket 但不中止处理器', async () => {
    const engine = new ChatEngine();
    await engine.init({ transport: 'ws', endpoint: 'ws://chat' });

    engine.disconnect();

    expect(mocks.serviceInstances[0].disconnectWS).toHaveBeenCalledOnce();
    expect(mocks.handlerInstances[0].abort).not.toHaveBeenCalled();
  });

  it('销毁已初始化的资源并清空消息', async () => {
    const engine = new ChatEngine();
    await engine.init({ transport: 'sse' }, [initialMessage]);
    const destroyEvent = vi.fn();
    engine.eventBus.on(ChatEngineEventType.ENGINE_DESTROY, destroyEvent);

    engine.destroy();

    expect(destroyEvent).toHaveBeenCalledOnce();
    expect(mocks.serviceInstances[0].destroy).toHaveBeenCalledOnce();
    expect(mocks.handlerInstances[0].destroy).toHaveBeenCalledOnce();
    expect(engine.messages).toEqual([]);
  });

  it.todo('destroy 在 init 之前调用是安全的（当前会解引用未初始化的 config 与 service 字段）');

  it.todo('sendUserMessage 等待并传播请求 promise（当前调用 sendRequest 时未等待其完成）');

  it.todo('完成消息时忽略无关的更早消息上的错误状态');
});
