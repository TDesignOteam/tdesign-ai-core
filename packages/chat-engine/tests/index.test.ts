import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatServiceConfig } from '../type';

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

  it('initializes once with messages, protocol handler, and lifecycle event', async () => {
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

  it('deduplicates concurrent websocket connects and rebuilds for overrides', async () => {
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

  it('skips connection work for non-websocket transports and existing connections', async () => {
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

  it('creates user and assistant messages without requesting when requested', async () => {
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

  it('warns and ignores an empty user request', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const engine = new ChatEngine();
    await engine.init({});

    await engine.sendUserMessage({ prompt: '   ', attachments: [] });

    expect(engine.messages).toEqual([]);
    expect(warn).toHaveBeenCalledOnce();
  });

  it('orchestrates stream requests through the selected handler context', async () => {
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

  it('applies a batch result and publishes completion', async () => {
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

  it('marks and publishes request errors before rethrowing', async () => {
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

  it('aborts non-WS transport and delegates protocol cleanup', async () => {
    const onAbort = vi.fn(async () => undefined);
    const engine = new ChatEngine();
    await engine.init({ transport: 'sse', onAbort });

    await engine.abortChat();

    expect(onAbort).toHaveBeenCalledOnce();
    expect(mocks.serviceInstances[0].closeConnect).toHaveBeenCalledOnce();
    expect(mocks.handlerInstances[0].abort).toHaveBeenCalledOnce();
  });

  it('destroys initialized resources and clears messages', async () => {
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

  it.todo('destroy is safe before init (currently dereferences uninitialized config and service fields)');

  it.todo(
    'sendUserMessage awaits and propagates the request promise (currently launches sendRequest without awaiting it)',
  );

  it.todo('completing a message ignores error statuses on unrelated earlier messages');
});
