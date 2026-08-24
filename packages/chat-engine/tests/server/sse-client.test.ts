import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConnectionError, TimeoutError } from '../../server/errors';
import { SSEClient } from '../../server/sse-client';
import { SSEConnectionState } from '../../server/types';

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

  it('reads an SSE stream and emits start, message, completion, and state changes', async () => {
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

  it('cancels the reader, aborts fetch, and emits aborted completion', async () => {
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

  it('emits a timeout and aborts an inactive stream', async () => {
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

  it('exposes connection metadata without sharing the top-level object', () => {
    const client = new SSEClient('/events');
    const first = client.getInfo();
    const second = client.getInfo();
    expect(first).not.toBe(second);
    expect(first).toMatchObject({ id: client.connectionId, url: '/events', state: SSEConnectionState.DISCONNECTED });
  });

  it('reports fetch network failures as connection errors', async () => {
    const networkError = new TypeError('fetch failed');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(networkError));
    const client = new SSEClient('/events');
    const onError = vi.fn();
    client.on('error', onError);

    await client.connect({ timeout: 0 });

    expect(onError).toHaveBeenCalledWith(networkError);
  });

  it.fails('stops connection setup after a non-OK HTTP response instead of entering CONNECTED state', async () => {
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
  it.todo('puts timeout descriptions in TimeoutError.message instead of details');
  it.todo('resets the first-token flag when a client instance reconnects');
});
