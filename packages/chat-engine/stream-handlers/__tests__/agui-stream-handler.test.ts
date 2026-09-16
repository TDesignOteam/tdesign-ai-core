import { describe, expect, it, vi } from 'vitest';

import type { AGUIAdapter, AGUIAdapterCallbacks } from '../../adapters/agui';
import { AGUIEventType } from '../../adapters/agui/types/events';
import { ChatEngineEventType } from '../../event-bus';
import type { AIMessageContent, ChatRequestParams, ChatServiceConfig, SSEChunkData } from '../../type';
import { AGUIStreamHandler } from '../agui-stream-handler';
import type { StreamContext } from '../types';

function setup(config: ChatServiceConfig = {}) {
  let requestConfig: ChatServiceConfig | undefined;
  const llmService = {
    handleStreamRequest: vi.fn(async (_params: ChatRequestParams, nextConfig: ChatServiceConfig) => {
      requestConfig = nextConfig;
    }),
  };
  const adapter = {
    handleAGUIEvent: vi.fn(),
    getToolcallByName: vi.fn(),
    reset: vi.fn(),
  };
  const context = {
    messageId: 'assistant-1',
    config,
    getStopReceive: vi.fn(() => false),
    processMessageResult: vi.fn(),
    handleError: vi.fn(),
    handleComplete: vi.fn(),
    messageStore: { getMessageByID: vi.fn(() => ({ id: 'assistant-1' })) },
    eventBus: { emit: vi.fn() },
  } as unknown as StreamContext;

  return {
    adapter,
    context,
    handler: new AGUIStreamHandler(llmService as never, adapter as unknown as AGUIAdapter),
    getRequestConfig: () => requestConfig,
  };
}

describe('AGUIStreamHandler', () => {
  it('暴露适配器操作', () => {
    const { adapter, handler } = setup();
    const chunk: SSEChunkData = { data: 'event' };
    const callbacks = { onRunStart: vi.fn() };
    const mapped = { type: 'text', data: 'mapped' } as const;
    adapter.handleAGUIEvent.mockReturnValue(mapped);
    adapter.getToolcallByName.mockReturnValue({ toolCallId: 'tool-1' });

    expect(handler.getAdapter()).toBe(adapter);
    expect(handler.handleEvent(chunk, callbacks)).toBe(mapped);
    expect(adapter.handleAGUIEvent).toHaveBeenCalledWith(chunk, callbacks);
    expect(handler.getToolcallByName('search')).toEqual({ toolCallId: 'tool-1' });
    handler.resetAdapter();
    expect(adapter.reset).toHaveBeenCalledOnce();
  });

  it('映射前过滤数据块，并允许 onMessage 覆盖映射结果', async () => {
    const filtered: SSEChunkData = { event: 'filtered', data: 'clean' };
    const mapped = { type: 'text', data: 'mapped' } as const;
    const custom = { type: 'markdown', data: 'custom' } as const;
    const config: ChatServiceConfig = {
      onChunk: vi.fn(() => filtered),
      onMessage: vi.fn(() => custom),
    };
    const { adapter, context, handler, getRequestConfig } = setup(config);
    adapter.handleAGUIEvent.mockReturnValue(mapped);

    await handler.handleStream({ prompt: 'hello' }, context);
    const result = getRequestConfig()!.onMessage?.({ data: 'raw' });

    expect(config.onChunk).toHaveBeenCalledWith({ data: 'raw' });
    expect(config.onMessage).toHaveBeenCalledWith(filtered, { id: 'assistant-1' }, mapped);
    expect(result).toBe(custom);
    expect(context.eventBus.emit).toHaveBeenCalledWith(ChatEngineEventType.REQUEST_STREAM, {
      messageId: 'assistant-1',
      chunk: filtered,
      content: custom,
    });
    expect(context.processMessageResult).toHaveBeenCalledWith('assistant-1', custom);
  });

  it('派发来自适配器的 AG-UI 运行生命周期回调', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1234);
    const config: ChatServiceConfig = { onStart: vi.fn() };
    const params = { prompt: 'hello' };
    const { adapter, context, handler, getRequestConfig } = setup(config);
    adapter.handleAGUIEvent.mockImplementation((_chunk: SSEChunkData, callbacks: AGUIAdapterCallbacks) => {
      callbacks.onRunStart?.({ type: AGUIEventType.RUN_STARTED, runId: 'run-1', threadId: 'thread-1' });
      callbacks.onRunComplete?.(false, params, {
        type: AGUIEventType.RUN_FINISHED,
        runId: 'run-1',
        threadId: 'thread-1',
      });
      return null;
    });

    await handler.handleStream(params, context);
    getRequestConfig()!.onMessage?.({ data: 'run event' });

    expect(adapter.reset).toHaveBeenCalledOnce();
    expect(config.onStart).toHaveBeenCalledWith(
      JSON.stringify({ type: 'RUN_STARTED', runId: 'run-1', threadId: 'thread-1' }),
    );
    expect(context.handleComplete).toHaveBeenCalledWith(
      'assistant-1',
      false,
      params,
      expect.objectContaining({ type: 'RUN_FINISHED' }),
    );
    expect(context.eventBus.emit).toHaveBeenCalledWith(ChatEngineEventType.AGUI_RUN_START, {
      runId: 'run-1',
      threadId: 'thread-1',
      timestamp: 1234,
    });
    expect(context.eventBus.emit).toHaveBeenCalledWith(ChatEngineEventType.AGUI_RUN_COMPLETE, {
      runId: 'run-1',
      threadId: 'thread-1',
      timestamp: 1234,
    });
  });

  it('仅对已中止的运行委托传输层完成处理', async () => {
    const params = { prompt: 'hello' };
    const { context, handler, getRequestConfig } = setup();
    await handler.handleStream(params, context);

    getRequestConfig()!.onComplete?.(false, params);
    expect(context.handleComplete).not.toHaveBeenCalled();
    getRequestConfig()!.onComplete?.(true, params);
    expect(context.handleComplete).toHaveBeenCalledWith('assistant-1', true, params);
  });

  it('对已中止的运行抑制 AGUI 运行完成事件', async () => {
    const params = { prompt: 'hello' };
    const { adapter, context, handler, getRequestConfig } = setup();
    adapter.handleAGUIEvent.mockImplementation((_chunk: SSEChunkData, callbacks: AGUIAdapterCallbacks) => {
      callbacks.onRunComplete?.(true, params);
      return null;
    });

    await handler.handleStream(params, context);
    getRequestConfig()!.onMessage?.({ data: 'run event' });

    expect(context.handleComplete).toHaveBeenCalledWith('assistant-1', true, params, undefined);
    expect(context.eventBus.emit).not.toHaveBeenCalledWith(ChatEngineEventType.AGUI_RUN_COMPLETE, expect.anything());
  });

  it('派发 AG-UI 运行中断事件并跟踪待决策 interrupts', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1234);
    const params = { prompt: 'hello' };
    const interrupts = [{ id: 'int-1', reason: 'tool_call', toolCallId: 'tc-1', message: 'approve?' }];
    const { adapter, context, handler, getRequestConfig } = setup();
    adapter.handleAGUIEvent.mockImplementation((_chunk: SSEChunkData, callbacks: AGUIAdapterCallbacks) => {
      callbacks.onRunInterrupted?.(
        {
          type: AGUIEventType.RUN_FINISHED,
          runId: 'run-1',
          threadId: 'thread-1',
        },
        interrupts,
      );
      return null;
    });

    await handler.handleStream(params, context);
    getRequestConfig()!.onMessage?.({ data: 'run event' });

    expect(context.handleComplete).toHaveBeenCalledWith(
      'assistant-1',
      false,
      params,
      expect.objectContaining({ type: 'RUN_FINISHED' }),
    );
    expect(context.eventBus.emit).toHaveBeenCalledWith(ChatEngineEventType.AGUI_RUN_INTERRUPTED, {
      runId: 'run-1',
      threadId: 'thread-1',
      messageId: 'assistant-1',
      interrupts,
      timestamp: 1234,
    });
    expect(context.eventBus.emit).not.toHaveBeenCalledWith(ChatEngineEventType.AGUI_RUN_COMPLETE, expect.anything());
    expect(handler.getPendingInterrupts()).toEqual(interrupts);
  });

  it('新一轮 RUN_STARTED 清空待决策 interrupts', async () => {
    const interrupts = [{ id: 'int-1', reason: 'tool_call' }];
    const { adapter, context, handler, getRequestConfig } = setup();
    let runCount = 0;
    adapter.handleAGUIEvent.mockImplementation((_chunk: SSEChunkData, callbacks: AGUIAdapterCallbacks) => {
      runCount += 1;
      if (runCount === 1) {
        callbacks.onRunInterrupted?.(
          { type: AGUIEventType.RUN_FINISHED, runId: 'run-1', threadId: 'thread-1' },
          interrupts,
        );
      } else {
        callbacks.onRunStart?.({ type: AGUIEventType.RUN_STARTED, runId: 'run-2', threadId: 'thread-1' });
      }
      return null;
    });

    await handler.handleStream({ prompt: 'hello' }, context);
    getRequestConfig()!.onMessage?.({ data: 'run event' });
    expect(handler.getPendingInterrupts()).toEqual(interrupts);

    await handler.handleStream(
      {
        threadId: 'thread-1',
        resume: [{ interruptId: 'int-1', status: 'resolved', payload: { approved: true } }],
      },
      context,
    );
    getRequestConfig()!.onMessage?.({ data: 'run event' });

    expect(handler.getPendingInterrupts()).toEqual([]);
  });

  it('resetAdapter 同步清空待决策 interrupts', async () => {
    const interrupts = [{ id: 'int-1', reason: 'tool_call' }];
    const { adapter, context, handler, getRequestConfig } = setup();
    adapter.handleAGUIEvent.mockImplementation((_chunk: SSEChunkData, callbacks: AGUIAdapterCallbacks) => {
      callbacks.onRunInterrupted?.(
        { type: AGUIEventType.RUN_FINISHED, runId: 'run-1', threadId: 'thread-1' },
        interrupts,
      );
      return null;
    });

    await handler.handleStream({ prompt: 'hello', threadId: 'thread-1' }, context);
    getRequestConfig()!.onMessage?.({ data: 'run event' });
    expect(handler.getPendingInterrupts()).toEqual(interrupts);

    handler.resetAdapter();
    expect(adapter.reset).toHaveBeenCalledOnce();
    expect(handler.getPendingInterrupts()).toEqual([]);
  });

  it('存在未决 interrupts 且请求未携带 resume 时给出警告', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const interrupts = [{ id: 'int-1', reason: 'tool_call' }];
    const { adapter, context, handler, getRequestConfig } = setup();
    adapter.handleAGUIEvent.mockImplementation((_chunk: SSEChunkData, callbacks: AGUIAdapterCallbacks) => {
      callbacks.onRunInterrupted?.(
        { type: AGUIEventType.RUN_FINISHED, runId: 'run-1', threadId: 'thread-1' },
        interrupts,
      );
      return null;
    });

    await handler.handleStream({ prompt: 'hello', threadId: 'thread-1' }, context);
    getRequestConfig()!.onMessage?.({ data: 'run event' });
    expect(warn).not.toHaveBeenCalled();

    await handler.handleStream({ prompt: 'follow up', threadId: 'thread-1' }, context);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toContain('resume');
  });

  it('不同线程的 RUN_STARTED 不会清除其他线程的待决 interrupts', async () => {
    const interrupts = [{ id: 'int-1', reason: 'tool_call', toolCallId: 'tc-1' }];
    const { adapter, context, handler, getRequestConfig } = setup();
    let runCount = 0;
    adapter.handleAGUIEvent.mockImplementation((_chunk: SSEChunkData, callbacks: AGUIAdapterCallbacks) => {
      runCount += 1;
      if (runCount === 1) {
        callbacks.onRunInterrupted?.(
          { type: AGUIEventType.RUN_FINISHED, runId: 'run-1', threadId: 'thread-1' },
          interrupts,
        );
      } else {
        callbacks.onRunStart?.({ type: AGUIEventType.RUN_STARTED, runId: 'run-2', threadId: 'thread-2' });
      }
      return null;
    });

    await handler.handleStream({ prompt: 'first', threadId: 'thread-1' }, context);
    getRequestConfig()!.onMessage?.({ data: 'interrupt' });
    await handler.handleStream({ prompt: 'second', threadId: 'thread-2' }, context);
    getRequestConfig()!.onMessage?.({ data: 'started' });

    expect(handler.getPendingInterrupts('thread-1')).toEqual(interrupts);
    expect(handler.getPendingInterrupts('thread-2')).toEqual([]);
  });

  it('委托运行错误并派发 AGUI 运行错误事件', async () => {
    const { adapter, context, handler, getRequestConfig } = setup();
    const error = { type: AGUIEventType.RUN_ERROR as const, message: 'agent exploded' };
    adapter.handleAGUIEvent.mockImplementation((_chunk: SSEChunkData, callbacks: AGUIAdapterCallbacks) => {
      callbacks.onRunError?.(error);
      return null;
    });

    await handler.handleStream({ prompt: 'hello' }, context);
    getRequestConfig()!.onMessage?.({ data: 'run event' });

    expect(context.handleError).toHaveBeenCalledWith('assistant-1', error);
    expect(context.eventBus.emit).toHaveBeenCalledWith(ChatEngineEventType.AGUI_RUN_ERROR, { error });
  });

  it('映射前跳过被 onChunk 过滤掉的数据块', async () => {
    const config: ChatServiceConfig = { onChunk: vi.fn(() => null) };
    const { adapter, context, handler, getRequestConfig } = setup(config);
    adapter.handleAGUIEvent.mockReturnValue({ type: 'text', data: 'mapped' } as const);

    await handler.handleStream({ prompt: 'hello' }, context);
    const result = getRequestConfig()!.onMessage?.({ data: 'raw' });

    expect(result).toBeNull();
    expect(adapter.handleAGUIEvent).not.toHaveBeenCalled();
    expect(context.eventBus.emit).not.toHaveBeenCalled();
    expect(context.processMessageResult).not.toHaveBeenCalled();
  });

  it('停止接收生效时丢弃数据块', async () => {
    const { context, handler, getRequestConfig } = setup();
    vi.mocked(context.getStopReceive).mockReturnValue(true);

    await handler.handleStream({ prompt: 'hello' }, context);
    const result = getRequestConfig()!.onMessage?.({ data: 'late chunk' });

    expect(result).toBeNull();
    expect(context.eventBus.emit).not.toHaveBeenCalled();
    expect(context.processMessageResult).not.toHaveBeenCalled();
  });

  it('消息更新后派发活动与工具调用内容', () => {
    const { context, handler } = setup();
    const contents = [
      { type: 'activity-progress', data: { activityType: 'progress', content: { percent: 50 } } },
      {
        type: 'toolcall-search',
        data: { toolCallId: 'tool-1', toolCallName: 'search', eventType: 'TOOL_CALL_START' },
      },
      { type: 'text', data: 'ignored' },
    ] as unknown as AIMessageContent[];

    handler.afterMessageUpdate('assistant-1', contents, context);

    expect(context.eventBus.emit).toHaveBeenCalledWith(ChatEngineEventType.AGUI_ACTIVITY, {
      activityType: 'progress',
      messageId: 'assistant-1',
      content: { percent: 50 },
    });
    expect(context.eventBus.emit).toHaveBeenCalledWith(ChatEngineEventType.AGUI_TOOLCALL, {
      toolCall: contents[1].data,
      eventType: 'TOOL_CALL_START',
    });
  });
});
