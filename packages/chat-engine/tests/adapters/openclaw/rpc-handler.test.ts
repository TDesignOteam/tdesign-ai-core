import { afterEach, describe, expect, it, vi } from 'vitest';

import { OpenClawRPCHandler, RPCError } from '../../../adapters/openclaw/rpc-handler';

describe('OpenClawRPCHandler', () => {
  afterEach(() => vi.useRealTimers());

  it('requires a send function', async () => {
    await expect(new OpenClawRPCHandler().request('test', {})).rejects.toMatchObject({
      name: 'RPCError',
      code: 'SEND_NOT_CONFIGURED',
    });
  });

  it('sends a request and resolves its matching response', async () => {
    const handler = new OpenClawRPCHandler();
    const send = vi.fn();
    handler.setSendFunction(send);
    const promise = handler.request<{ input: number }, { output: number }>('double', { input: 2 });
    const frame = send.mock.calls[0][0];

    expect(frame).toMatchObject({ type: 'req', method: 'double', params: { input: 2 } });
    expect(handler.getPendingCount()).toBe(1);
    expect(handler.handleResponse({ type: 'res', id: frame.id, ok: true, payload: { output: 4 } })).toBe(true);
    await expect(promise).resolves.toEqual({ output: 4 });
    expect(handler.getPendingCount()).toBe(0);
  });

  it('rejects protocol errors with details', async () => {
    const handler = new OpenClawRPCHandler();
    let id = '';
    handler.setSendFunction((frame) => {
      id = frame.id;
    });
    const promise = handler.request('fail', {});
    handler.handleResponse({
      type: 'res',
      id,
      ok: false,
      error: { code: 'DENIED', message: 'No', details: { scope: 'chat' } },
    });
    await expect(promise).rejects.toEqual(expect.objectContaining({ code: 'DENIED', details: { scope: 'chat' } }));
  });

  it('times out and removes pending requests', async () => {
    vi.useFakeTimers();
    const handler = new OpenClawRPCHandler({ timeout: 50 });
    handler.setSendFunction(() => undefined);
    const promise = handler.request('slow', {});
    const rejection = expect(promise).rejects.toMatchObject({ code: 'TIMEOUT' });
    await vi.advanceTimersByTimeAsync(50);
    await rejection;
    expect(handler.getPendingCount()).toBe(0);
  });

  it('cleans up when sending throws', async () => {
    const handler = new OpenClawRPCHandler();
    handler.setSendFunction(() => {
      throw new Error('socket closed');
    });
    await expect(handler.request('test', {})).rejects.toThrow('socket closed');
    expect(handler.getPendingCount()).toBe(0);
  });

  it('routes frames and cancels all pending requests', async () => {
    const handler = new OpenClawRPCHandler();
    handler.setSendFunction(() => undefined);
    const one = handler.request('one', {});
    const two = handler.request('two', {});
    const oneRejected = expect(one).rejects.toBeInstanceOf(RPCError);
    const twoRejected = expect(two).rejects.toMatchObject({ code: 'CANCELLED' });

    expect(handler.handleFrame({ type: 'event', event: 'tick', payload: { ts: 1 } })).toMatchObject({
      type: 'event',
      handled: false,
    });
    expect(handler.handleFrame({ type: 'res', id: 'missing', ok: true })).toEqual({ type: 'response', handled: false });
    handler.cancelAll('shutdown');
    await Promise.all([oneRejected, twoRejected]);
    expect(handler.getPendingCount()).toBe(0);
  });

  it('uses the expected methods in convenience calls', async () => {
    const handler = new OpenClawRPCHandler();
    const frames: Array<{ id: string; method: string }> = [];
    handler.setSendFunction((frame) => {
      frames.push(frame);
      queueMicrotask(() => handler.handleResponse({ type: 'res', id: frame.id, ok: true, payload: {} }));
    });
    await handler.chatSend({ message: 'hello' });
    await handler.sessionsHistory({ sessionKey: 's' });
    await handler.nodeInvoke({ nodeId: 'n', action: 'confirm', payload: true });
    expect(frames.map((frame) => frame.method)).toEqual(['chat.send', 'sessions.history', 'node.invoke']);
  });
});
