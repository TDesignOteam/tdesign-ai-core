import { describe, expect, it, vi } from 'vitest';

import { SSEParser } from '../sse-parser';

describe('SSEParser', () => {
  it('解析 JSON 数据、事件名与 CRLF 分隔的数据块', () => {
    const parser = new SSEParser();
    const onMessage = vi.fn();
    parser.onMessage = onMessage;

    parser.parse('event: update\r\ndata: {"value":');
    expect(parser.getBufferSize()).toBe(15);
    expect(parser.hasIncompleteEvent()).toBe(false);

    parser.parse('1}\r\n\r\n');

    expect(onMessage).toHaveBeenCalledWith({ event: 'update', data: { value: 1 } });
    expect(parser.getBufferSize()).toBe(0);
    expect(parser.hasIncompleteEvent()).toBe(false);
  });

  it('拼接多个 data 字段并保留非 JSON 数据', () => {
    const parser = new SSEParser();
    const onMessage = vi.fn();
    parser.onMessage = onMessage;

    parser.parse('data: first\ndata: second\n\n');

    expect(onMessage).toHaveBeenCalledWith({ event: '', data: 'first\nsecond' });
  });

  it('忽略注释、未知字段与无数据的事件', () => {
    const parser = new SSEParser();
    const onMessage = vi.fn();
    parser.onMessage = onMessage;

    parser.parse(': keepalive\nevent: ping\nretry: 100\n\n');

    expect(onMessage).not.toHaveBeenCalled();
  });

  it('上报并重置缓冲状态且不暴露可变内部数据', () => {
    const parser = new SSEParser();
    parser.parse('id: 42\ndata: partial\nremaining');

    const event = parser.getCurrentEvent();
    event.data = 'changed';

    expect(parser.getCurrentEvent()).toEqual({ id: '42', data: 'partial' });
    expect(parser.getBufferSize()).toBe(9);
    expect(parser.hasIncompleteEvent()).toBe(true);

    parser.reset();

    expect(parser.getCurrentEvent()).toEqual({});
    expect(parser.getBufferSize()).toBe(0);
    expect(parser.hasIncompleteEvent()).toBe(false);
  });

  it('在派发的 SSE 事件中包含解析出的 id 字段', () => {
    const parser = new SSEParser();
    const onMessage = vi.fn();
    parser.onMessage = onMessage;

    parser.parse('id: 42\ndata: {"ok":true}\n\n');

    expect(onMessage).toHaveBeenCalledWith({ event: '', id: '42', data: { ok: true } });
  });
});
