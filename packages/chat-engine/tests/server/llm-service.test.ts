import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AIMessageContent, ChatRequestParams, ChatServiceConfig, SSEChunkData } from '../../type';
import { LLMService } from '../../server/llm-service';

const clientMocks = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => void;

  class ClientMock {
    static instances: ClientMock[] = [];

    listeners = new Map<string, Listener[]>();

    connect = vi.fn().mockResolvedValue(undefined);

    request = vi.fn();

    send = vi.fn();

    abort = vi.fn();

    close = vi.fn().mockResolvedValue(undefined);

    removeAllListeners = vi.fn(() => this.listeners.clear());

    isConnected = vi.fn(() => true);

    connectionId = 'client-1';

    getStatus = vi.fn(() => 'connected');

    getInfo = vi.fn(() => ({ id: this.connectionId }));

    constructor(public endpoint?: string) {
      ClientMock.instances.push(this);
    }

    on(event: string, listener: Listener): void {
      const listeners = this.listeners.get(event) || [];
      listeners.push(listener);
      this.listeners.set(event, listeners);
    }

    emit(event: string, ...args: unknown[]): void {
      this.listeners.get(event)?.forEach((listener) => listener(...args));
    }
  }

  class BatchClientMock extends ClientMock {
    static instances: BatchClientMock[] = [];

    constructor() {
      super();
      BatchClientMock.instances.push(this);
    }
  }

  class SSEClientMock extends ClientMock {
    static instances: SSEClientMock[] = [];

    constructor(endpoint: string) {
      super(endpoint);
      SSEClientMock.instances.push(this);
    }
  }

  class WebSocketClientMock extends ClientMock {
    static instances: WebSocketClientMock[] = [];

    constructor(endpoint: string) {
      super(endpoint);
      WebSocketClientMock.instances.push(this);
    }
  }

  return { ClientMock, BatchClientMock, SSEClientMock, WebSocketClientMock };
});

vi.mock('../../server/batch-client', () => ({ BatchClient: clientMocks.BatchClientMock }));
vi.mock('../../server/sse-client', () => ({ SSEClient: clientMocks.SSEClientMock }));
vi.mock('../../server/websocket-client', () => ({ WebSocketClient: clientMocks.WebSocketClientMock }));
vi.mock('../../utils/logger', () => ({
  LoggerManager: {
    getLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  },
}));

describe('LLMService', () => {
  beforeEach(() => {
    clientMocks.ClientMock.instances.length = 0;
    clientMocks.BatchClientMock.instances.length = 0;
    clientMocks.SSEClientMock.instances.length = 0;
    clientMocks.WebSocketClientMock.instances.length = 0;
  });

  it.each([
    [{ transport: 'ws' }, 'ws'],
    [{ transport: 'fetch', stream: true }, 'fetch'],
    [{ stream: false }, 'fetch'],
    [{ stream: true }, 'sse'],
    [{}, 'sse'],
  ] as const)('resolves transport for %o', (config, expected) => {
    expect(LLMService.resolveTransport(config)).toBe(expected);
  });

  it('performs batch requests, merges headers, and applies completion transforms', async () => {
    const service = new LLMService();
    const params = { prompt: 'hello' };
    const transformedRequest = { ...params, headers: { Authorization: 'Bearer token' }, body: '{"prompt":"hello"}' };
    const response: AIMessageContent = { type: 'text', data: 'raw' };
    const transformedResponse: AIMessageContent = { type: 'text', data: 'transformed' };
    const config: ChatServiceConfig = {
      endpoint: '/chat',
      timeout: 250,
      onRequest: vi.fn().mockResolvedValue(transformedRequest),
      onComplete: vi.fn(() => transformedResponse),
    };

    const pending = service.handleBatchRequest(params, config);
    const client = clientMocks.BatchClientMock.instances[0];
    client.request.mockResolvedValue(response);

    await expect(pending).resolves.toEqual(transformedResponse);
    expect(client.request).toHaveBeenCalledWith(
      '/chat',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
        body: transformedRequest.body,
      },
      250,
    );
    expect(config.onComplete).toHaveBeenCalledWith(false, transformedRequest, response);
  });

  it('forwards batch client errors and returns an empty result for no data', async () => {
    const service = new LLMService();
    const onError = vi.fn();
    const pending = service.handleBatchRequest({}, { endpoint: '/chat', onError });
    const client = clientMocks.BatchClientMock.instances[0];
    client.request.mockResolvedValue(undefined);
    const error = new Error('failed');
    client.emit('error', error);

    await expect(pending).resolves.toEqual([]);
    expect(onError).toHaveBeenCalledWith(error);
  });

  it('connects SSE, filters messages, and forwards lifecycle events', async () => {
    const service = new LLMService();
    const params = { prompt: 'hello' };
    const request = { body: 'serialized' } as ChatRequestParams & RequestInit;
    const config: ChatServiceConfig = {
      endpoint: '/events',
      onRequest: vi.fn().mockResolvedValue(request),
      onStart: vi.fn(),
      onMessage: vi.fn(),
      onError: vi.fn(),
      onComplete: vi.fn(),
      isValidChunk: vi.fn((chunk: SSEChunkData) => chunk.event === 'valid'),
    };

    const pending = service.handleStreamRequest(params, config);
    await Promise.resolve();
    const client = clientMocks.SSEClientMock.instances[0];
    await pending;

    client.emit('start', 'first');
    client.emit('message', { event: 'invalid', data: null });
    client.emit('message', { event: 'valid', data: 'answer' });
    client.emit('complete', false);

    expect(client.connect).toHaveBeenCalledWith(request);
    expect(config.onStart).toHaveBeenCalledWith('first');
    expect(config.onMessage).toHaveBeenCalledOnce();
    expect(config.onMessage).toHaveBeenCalledWith({ event: 'valid', data: 'answer' });
    expect(config.onComplete).toHaveBeenCalledWith(false, request);
  });

  it('initializes and reuses a persistent WebSocket connection', async () => {
    const service = new LLMService();
    const onMessage = vi.fn();
    const config: ChatServiceConfig = {
      endpoint: 'ws://chat',
      transport: 'ws',
      ws: { heartbeatInterval: 100, maxRetries: 2 },
      onMessage,
      onRequest: vi.fn(async (params: ChatRequestParams) => ({ ...params, body: 'wire-data' })),
    };

    await service.handleStreamRequest({ prompt: 'hello' }, config);
    const client = clientMocks.WebSocketClientMock.instances[0];
    client.emit('message', { event: 'message', data: 'answer' });

    expect(clientMocks.WebSocketClientMock.instances).toHaveLength(1);
    expect(client.connect).toHaveBeenCalledWith({ heartbeatInterval: 0, maxRetries: 2 });
    expect(client.send).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'hello', body: 'wire-data' }));
    expect(onMessage).toHaveBeenCalledWith({ event: 'message', data: 'answer' });
    expect(service.isWSConnected()).toBe(true);
    expect(service.getWSStats()).toEqual({ id: 'client-1', status: 'connected', info: { id: 'client-1' } });
  });

  it('keeps a persistent WebSocket open on closeConnect and closes it on destroy', async () => {
    const service = new LLMService();
    await service.initWSConnection({ endpoint: 'ws://chat' });
    const client = clientMocks.WebSocketClientMock.instances[0];

    service.closeConnect();
    expect(client.removeAllListeners).toHaveBeenCalled();
    expect(client.close).not.toHaveBeenCalled();

    await service.destroy();
    expect(client.close).toHaveBeenCalledOnce();
  });

  it('does nothing for stream requests without an endpoint', async () => {
    const service = new LLMService();

    await service.handleStreamRequest({}, {});

    expect(clientMocks.SSEClientMock.instances).toHaveLength(0);
    expect(clientMocks.WebSocketClientMock.instances).toHaveLength(0);
  });
});
