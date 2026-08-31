import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConnectionError, TimeoutError } from '../errors';
import { SSEClient } from '../sse-client';
import { SSEConnectionState } from '../types';

const logger = vi.hoisted(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }));

vi.mock('../../utils/logger', () => ({ LoggerManager: { getLogger: () => logger } }));

function responseWithReader(reader: { read: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> }): Response {
  const body = { pipeThrough: vi.fn(() => ({ getReader: () => reader })) };
  return { ok: true, status: 200, statusText: 'OK', body } as unknown as Response;
}

describe('SSEClient', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    vi.stubGlobal('TextDecoderStream', class TextDecoderStream {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('读取 SSE 流并派发 start、message、complete 与状态变更事件', async () => {
    const reader = {
      read: vi
        .fn()
        .mockResolvedValueOnce({ done: false, value: 'data: {"answer":1}\n\n' })
        .mockResolvedValueOnce({ done: true }),
      cancel: vi.fn(),
    };
    const fetchMock = vi.fn().mockResolvedValue(responseWithReader(reader));
    vi.stubGlobal('fetch', fetchMock);
    const client = new SSEClient('/events');
    const onStart = vi.fn();
    const onMessage = vi.fn();
    const onComplete = vi.fn();
    const onStateChange = vi.fn();
    client.on('start', onStart);
    client.on('message', onMessage);
    client.on('complete', onComplete);
    client.on('stateChange', onStateChange);

    await client.connect({ method: 'GET', headers: { Authorization: 'token' } });

    expect(fetchMock).toHaveBeenCalledWith(
      '/events',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Authorization: 'token', Accept: 'text/event-stream' }),
        signal: expect.any(AbortSignal),
      }),
    );
    expect(onStart).toHaveBeenCalledOnce();
    expect(onMessage).toHaveBeenCalledWith({ event: '', data: { answer: 1 } });
    expect(onComplete).toHaveBeenCalledWith(false);
    expect(client.getStatus()).toBe(SSEConnectionState.DISCONNECTED);
    expect(onStateChange.mock.calls.map(([event]) => event.to)).toEqual([
      SSEConnectionState.CONNECTING,
      SSEConnectionState.CONNECTED,
      SSEConnectionState.DISCONNECTED,
    ]);
  });

  it('取消 reader、中止 fetch 并派发中止的完成事件', async () => {
    let resolveRead!: (value: { done: boolean }) => void;
    const reader = {
      read: vi.fn(() => new Promise<{ done: boolean }>((resolve) => (resolveRead = resolve))),
      cancel: vi.fn(() => {
        resolveRead({ done: true });
        return Promise.resolve();
      }),
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(responseWithReader(reader)));
    const client = new SSEClient('/events');
    const onComplete = vi.fn();
    client.on('complete', onComplete);

    const connecting = client.connect({ timeout: 0 });
    await vi.waitFor(() => expect(reader.read).toHaveBeenCalled());
    await client.abort();
    await connecting;

    expect(reader.cancel).toHaveBeenCalledOnce();
    expect(onComplete).toHaveBeenCalledWith(true);
    expect(client.getStatus()).toBe(SSEConnectionState.CLOSED);
  });

  it('派发超时并中止不活跃的流', async () => {
    let resolveRead!: (value: { done: boolean }) => void;
    const reader = {
      read: vi.fn(() => new Promise<{ done: boolean }>((resolve) => (resolveRead = resolve))),
      cancel: vi.fn(() => {
        resolveRead({ done: true });
        return Promise.resolve();
      }),
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(responseWithReader(reader)));
    const client = new SSEClient('/events');
    const onError = vi.fn();
    client.on('error', onError);

    const connecting = client.connect({ timeout: 100 });
    await vi.waitFor(() => expect(reader.read).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(100);
    await connecting;

    expect(onError).toHaveBeenCalledWith(expect.any(TimeoutError));
    expect(client.getStatus()).toBe(SSEConnectionState.CLOSED);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('暴露连接元数据且不共享顶层对象', () => {
    const client = new SSEClient('/events');
    const first = client.getInfo();
    const second = client.getInfo();
    expect(first).not.toBe(second);
    expect(first).toMatchObject({ id: client.connectionId, url: '/events', state: SSEConnectionState.DISCONNECTED });
  });

  it('将 fetch 网络失败上报为连接错误', async () => {
    const networkError = new TypeError('fetch failed');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(networkError));
    const client = new SSEClient('/events');
    const onError = vi.fn();
    client.on('error', onError);

    await client.connect({ timeout: 0 });

    expect(onError).toHaveBeenCalledWith(networkError);
  });

  it.fails('非成功 HTTP 响应后停止连接建立而不进入 CONNECTED 状态', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, statusText: 'Unauthorized', body: {} }));
    const client = new SSEClient('/events');
    const onError = vi.fn();
    const onStateChange = vi.fn();
    client.on('error', onError);
    client.on('stateChange', onStateChange);

    await client.connect({ timeout: 0 });

    expect(onError).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(expect.any(ConnectionError));
    expect(client.getStatus()).toBe(SSEConnectionState.ERROR);
    expect(onStateChange.mock.calls.map(([event]) => event.to)).not.toContain(SSEConnectionState.CONNECTED);
  });
  it.todo('将超时描述放入 TimeoutError.message 而非 details');
  it.todo('客户端实例重连时重置首 token 标志');
});
