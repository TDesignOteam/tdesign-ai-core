import { afterEach, describe, expect, it, vi } from 'vitest';

import { OpenClawRPCHandler, RPCError } from '../../../adapters/openclaw/rpc-handler';

describe('OpenClawRPCHandler', () => {
  afterEach(() => vi.useRealTimers());

  it('要求提供发送函数', async () => {
    await expect(new OpenClawRPCHandler().request('test', {})).rejects.toMatchObject({
      name: 'RPCError',
      code: 'SEND_NOT_CONFIGURED',
    });
  });

  it('发送请求并以匹配的响应 resolve', async () => {
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

  it('携带详细信息 reject 协议错误', async () => {
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

  it('超时并移除待处理请求', async () => {
    vi.useFakeTimers();
    const handler = new OpenClawRPCHandler({ timeout: 50 });
    handler.setSendFunction(() => undefined);
    const promise = handler.request('slow', {});
    const rejection = expect(promise).rejects.toMatchObject({ code: 'TIMEOUT' });
    await vi.advanceTimersByTimeAsync(50);
    await rejection;
    expect(handler.getPendingCount()).toBe(0);
  });

  it('发送抛错时进行清理', async () => {
    const handler = new OpenClawRPCHandler();
    handler.setSendFunction(() => {
      throw new Error('socket closed');
    });
    await expect(handler.request('test', {})).rejects.toThrow('socket closed');
    expect(handler.getPendingCount()).toBe(0);
  });

  it('路由帧并取消全部待处理请求', async () => {
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

  it('便捷调用使用预期的方法', async () => {
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
