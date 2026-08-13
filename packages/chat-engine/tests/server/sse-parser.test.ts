import { describe, expect, it, vi } from 'vitest';

import { SSEParser } from '../../server/sse-parser';

describe('SSEParser', () => {
  it('parses JSON data, event names, and CRLF-delimited chunks', () => {
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

  it('joins multiple data fields and preserves non-JSON data', () => {
    const parser = new SSEParser();
    const onMessage = vi.fn();
    parser.onMessage = onMessage;

    parser.parse('data: first\ndata: second\n\n');

    expect(onMessage).toHaveBeenCalledWith({ event: '', data: 'first\nsecond' });
  });

  it('ignores comments, unknown fields, and events without data', () => {
    const parser = new SSEParser();
    const onMessage = vi.fn();
    parser.onMessage = onMessage;

    parser.parse(': keepalive\nevent: ping\nretry: 100\n\n');

    expect(onMessage).not.toHaveBeenCalled();
  });

  it('reports and resets buffered state without exposing mutable internals', () => {
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

  it.todo('includes the parsed id field in emitted SSE events');
});
