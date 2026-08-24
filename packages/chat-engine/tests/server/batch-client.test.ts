import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BatchClient } from '../../server/batch-client';
import { ConnectionError, TimeoutError } from '../../server/errors';

const logger = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('../../utils/logger', () => ({
  LoggerManager: { getLogger: () => logger },
}));

describe('BatchClient', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('返回 JSON 并向 fetch 提供中止信号', async () => {
    const responseData = { answer: 'ok' };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: vi.fn().mockResolvedValue(responseData) });
    vi.stubGlobal('fetch', fetchMock);
    const client = new BatchClient();

    await expect(client.request('/chat', { method: 'POST', body: '{}' }, 500)).resolves.toEqual(responseData);

    expect(fetchMock).toHaveBeenCalledWith(
      '/chat',
      expect.objectContaining({ method: 'POST', body: '{}', signal: expect.any(AbortSignal) }),
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it('对非成功响应派发连接错误', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    const client = new BatchClient();
    const onError = vi.fn();
    client.on('error', onError);

    await expect(client.request('/chat', {}, 500)).resolves.toBeNull();

    expect(onError).toHaveBeenCalledWith(expect.any(ConnectionError));
    expect(onError.mock.calls[0][0]).toMatchObject({ message: 'HTTP error! status: 503', statusCode: undefined });
  });

  it('记录并派发非中止的 fetch 失败', async () => {
    const failure = new TypeError('network unavailable');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(failure));
    const client = new BatchClient();
    const onError = vi.fn();
    client.on('error', onError);

    await expect(client.request('/chat', {}, 500)).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledWith('Batch request failed:', failure);
    expect(onError).toHaveBeenCalledWith(failure);
  });

  it('截止时间到期时中止并派发超时错误', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
          }),
      ),
    );
    const client = new BatchClient();
    const onError = vi.fn();
    client.on('error', onError);

    const request = client.request('/chat', {}, 100);
    await vi.advanceTimersByTimeAsync(100);

    await expect(request).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(expect.any(TimeoutError));
  });

  it('中止活跃请求且不将中止上报为错误', async () => {
    const signalSpy = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            signalSpy(init.signal);
            init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
          }),
      ),
    );
    const client = new BatchClient();
    const onError = vi.fn();
    client.on('error', onError);

    const request = client.request('/chat', {}, 500);
    client.abort();

    await expect(request).resolves.toBeUndefined();
    expect(signalSpy.mock.calls[0][0].aborted).toBe(true);
    expect(onError).not.toHaveBeenCalled();
  });

  it.fails('上一个请求完成后最新的请求仍可中止', async () => {
    const signals: AbortSignal[] = [];
    let resolveSecond!: (response: { ok: boolean; json: () => Promise<unknown> }) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((resolve, reject) => {
            const signal = init.signal as AbortSignal;
            signals.push(signal);
            if (signals.length === 2) resolveSecond = resolve;
            signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
          }),
      ),
    );
    const client = new BatchClient();

    const first = client.request('/first', {}, 500);
    const second = client.request('/second', {}, 500);
    await first;
    client.abort();
    resolveSecond({ ok: true, json: vi.fn().mockResolvedValue({ answer: 'ok' }) });

    await expect(second).resolves.toBeUndefined();
    expect(signals).toHaveLength(2);
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.todo('将配置的时长放入 TimeoutError.message 而非 TimeoutError.details');
});
