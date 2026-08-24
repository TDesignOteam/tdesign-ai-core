import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConnectionError, TimeoutError } from '../../server/errors';
import { WebSocketClient, WebSocketConnectionState } from '../../server/websocket-client';

const logger = vi.hoisted(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }));

vi.mock('../../utils/logger', () => ({ LoggerManager: { getLogger: () => logger } }));

class FakeWebSocket {
  static OPEN = 1;

  static instances: FakeWebSocket[] = [];

  readyState = 0;

  onopen: (() => void) | null = null;

  onmessage: ((event: { data: string }) => void) | null = null;

  onerror: ((event: Event) => void) | null = null;

  onclose: ((event: { code: number; reason: string }) => void) | null = null;

  send = vi.fn();

  close = vi.fn();

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  message(data: string): void {
    this.onmessage?.({ data });
  }

  serverClose(code: number, reason: string): void {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }
}

describe('WebSocketClient', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    FakeWebSocket.instances.length = 0;
    vi.stubGlobal('WebSocket', FakeWebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function connect(client: WebSocketClient, config = {}): Promise<FakeWebSocket> {
    const pending = client.connect(config);
    const socket = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
    socket.open();
    await pending;
    return socket;
  }

  it('连接、发送序列化数据并上报状态', async () => {
    const client = new WebSocketClient('ws://chat');
    const stateChanges = vi.fn();
    client.on('stateChange', stateChanges);
    const socket = await connect(client);

    client.send({ prompt: 'hello' });

    expect(socket.url).toBe('ws://chat');
    expect(socket.send).toHaveBeenCalledWith('{"prompt":"hello"}');
    expect(client.isConnected()).toBe(true);
    expect(client.getStatus()).toBe(WebSocketConnectionState.CONNECTED);
    expect(stateChanges.mock.calls.map(([event]) => event.to)).toEqual([
      WebSocketConnectionState.CONNECTING,
      WebSocketConnectionState.CONNECTED,
    ]);
  });

  it('只派发一次 start 并规范化 JSON 与文本消息', async () => {
    const client = new WebSocketClient('ws://chat');
    const onStart = vi.fn();
    const onMessage = vi.fn();
    client.on('start', onStart);
    client.on('message', onMessage);
    const socket = await connect(client);

    socket.message('{"type":"delta","content":"hello"}');
    socket.message('plain text');

    expect(onStart).toHaveBeenCalledOnce();
    expect(onMessage).toHaveBeenNthCalledWith(1, {
      event: 'delta',
      data: { type: 'delta', content: 'hello' },
    });
    expect(onMessage).toHaveBeenNthCalledWith(2, { event: 'message', data: 'plain text' });
  });

  it('手动关闭、清除 socket 并派发中止的完成事件', async () => {
    const client = new WebSocketClient('ws://chat');
    const onComplete = vi.fn();
    client.on('complete', onComplete);
    const socket = await connect(client);

    await client.close();

    expect(socket.close).toHaveBeenCalledWith(1000, 'Client initiated close');
    expect(onComplete).toHaveBeenCalledWith(true);
    expect(client.getStatus()).toBe(WebSocketConnectionState.CLOSED);
    expect(client.isConnected()).toBe(false);
  });

  it('打开耗时过长时确定性地触发超时', async () => {
    const client = new WebSocketClient('ws://chat');
    const onError = vi.fn();
    client.on('error', onError);

    const pending = client.connect({ timeout: 100 });
    await vi.advanceTimersByTimeAsync(100);
    await pending;

    expect(onError).toHaveBeenCalledWith(expect.any(TimeoutError));
    expect(client.getStatus()).toBe(WebSocketConnectionState.ERROR);
  });

  it('异常关闭后按配置的退避策略重连', async () => {
    const client = new WebSocketClient('ws://chat');
    const firstSocket = await connect(client, { maxRetries: 1, retryInterval: 100, timeout: 0 });

    firstSocket.serverClose(1006, 'lost');
    expect(client.getInfo().retryCount).toBe(1);

    await vi.advanceTimersByTimeAsync(99);
    expect(FakeWebSocket.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeWebSocket.instances).toHaveLength(2);

    const secondSocket = FakeWebSocket.instances[1];
    secondSocket.open();
    await vi.runAllTimersAsync();
    expect(client.getStatus()).toBe(WebSocketConnectionState.CONNECTED);
  });

  it('禁用重试时派发完成事件与连接错误', async () => {
    const client = new WebSocketClient('ws://chat');
    const onComplete = vi.fn();
    const onError = vi.fn();
    client.on('complete', onComplete);
    client.on('error', onError);
    const socket = await connect(client, { maxRetries: 0 });

    socket.serverClose(1006, 'lost');

    expect(onComplete).toHaveBeenCalledWith(false);
    expect(onError).toHaveBeenCalledWith(expect.any(ConnectionError));
    expect(client.getStatus()).toBe(WebSocketConnectionState.DISCONNECTED);
  });

  it('启用心跳监测时关闭空闲连接', async () => {
    const client = new WebSocketClient('ws://chat');
    const socket = await connect(client, { heartbeatInterval: 100, timeout: 0 });

    await vi.advanceTimersByTimeAsync(300);

    expect(socket.close).toHaveBeenCalledWith(4000, 'Heartbeat timeout');
  });

  it('未连接时警告而不发送', () => {
    const client = new WebSocketClient('ws://chat');

    client.send('hello');

    expect(logger.warn).toHaveBeenCalledWith('Cannot send message: WebSocket not connected (state: disconnected)');
  });

  it('连接中关闭时关闭原生 socket 并上报错误', async () => {
    const client = new WebSocketClient('ws://chat');
    const onError = vi.fn();
    const onComplete = vi.fn();
    client.on('error', onError);
    client.on('complete', onComplete);

    const pending = client.connect({ timeout: 0 });
    const socket = FakeWebSocket.instances[0];
    expect(client.getStatus()).toBe(WebSocketConnectionState.CONNECTING);

    await client.close();
    await pending;

    expect(socket.close).toHaveBeenCalledWith(1000, 'Client initiated close');
    expect(onComplete).toHaveBeenCalledWith(true);
    expect(onError).toHaveBeenCalledWith(expect.any(ConnectionError));
  });

  it('原生 socket 触发 onerror 时派发连接错误', async () => {
    const client = new WebSocketClient('ws://chat');
    const onError = vi.fn();
    client.on('error', onError);
    const socket = await connect(client);

    socket.onerror?.({ type: 'error' } as Event);

    expect(onError).toHaveBeenCalledWith(expect.any(ConnectionError));
  });

  it('将代码为 1000 的服务端关闭视为正常完成', async () => {
    const client = new WebSocketClient('ws://chat');
    const onComplete = vi.fn();
    const onError = vi.fn();
    client.on('complete', onComplete);
    client.on('error', onError);
    const socket = await connect(client, { maxRetries: 3, timeout: 0 });

    socket.serverClose(1000, 'done');

    expect(onComplete).toHaveBeenCalledWith(false);
    expect(onError).not.toHaveBeenCalled();
    expect(client.getStatus()).toBe(WebSocketConnectionState.CLOSED);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it.todo('将配置的连接时长放入 TimeoutError.message 而非 details');
  it.todo('在调度或尝试下一次连接前关闭已超时的原生 socket');
});
