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

  it('returns JSON and supplies its abort signal to fetch', async () => {
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

  it('emits a connection error for a non-successful response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    const client = new BatchClient();
    const onError = vi.fn();
    client.on('error', onError);

    await expect(client.request('/chat', {}, 500)).resolves.toBeNull();

    expect(onError).toHaveBeenCalledWith(expect.any(ConnectionError));
    expect(onError.mock.calls[0][0]).toMatchObject({ message: 'HTTP error! status: 503', statusCode: undefined });
  });

  it('logs and emits non-abort fetch failures', async () => {
    const failure = new TypeError('network unavailable');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(failure));
    const client = new BatchClient();
    const onError = vi.fn();
    client.on('error', onError);

    await expect(client.request('/chat', {}, 500)).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledWith('Batch request failed:', failure);
    expect(onError).toHaveBeenCalledWith(failure);
  });

  it('aborts and emits a timeout error when the deadline expires', async () => {
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

  it('aborts an active request without reporting an abort as an error', async () => {
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

  it.todo('puts the configured duration in TimeoutError.message instead of TimeoutError.details');
});
