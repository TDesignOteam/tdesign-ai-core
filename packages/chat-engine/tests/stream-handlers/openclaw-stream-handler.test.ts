import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatEngineEventType } from '../../event-bus';
import type { AIMessageContent, ChatMessagesData, ChatServiceConfig } from '../../type';
import type { StreamContext, StreamLifecycleContext } from '../../stream-handlers/types';

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

import { OpenClawStreamHandler } from '../../stream-handlers/openclaw-stream-handler';

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

  it('preconnects with auth and replaces the store when history arrives', async () => {
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

  it('reports but does not reject an initialization connection failure', async () => {
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

  it('connects, sends normalized request parameters, and handles stream callbacks', async () => {
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

  it('normalizes non-object onRequest results and rethrows send failures', async () => {
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

  it('aborts and destroys the owned adapter', async () => {
    const handler = new OpenClawStreamHandler({ llmService: {} as never });
    await handler.initialize({ endpoint: 'wss://gateway.example' }, lifecycleContext());
    const adapter = adapterState.instances[0];

    handler.abort();
    expect(adapter.abort).toHaveBeenCalledOnce();
    await handler.destroy();
    expect(adapter.destroy).toHaveBeenCalledOnce();
    expect(handler.getAdapter()).toBeNull();
  });
});
