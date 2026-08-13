import { describe, expect, it, vi } from 'vitest';

import {
  convertOpenClawHistory,
  convertOpenClawHistoryResponse,
  isOpenClawHistoryMessage,
} from '../../../adapters/openclaw/history-converter';

describe('OpenClaw history converter', () => {
  it('recognizes supported message roles', () => {
    expect(isOpenClawHistoryMessage({ role: 'assistant' })).toBe(true);
    expect(isOpenClawHistoryMessage({ role: 'unknown' })).toBe(false);
    expect(isOpenClawHistoryMessage({})).toBe(false);
  });

  it('converts user and system text with timestamps', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.25);
    const result = convertOpenClawHistory([
      { role: 'user', content: [{ type: 'text', text: 'Hello' }], timestamp: 0 },
      { role: 'system', content: 'Rules', timestamp: Date.parse('2026-01-01T00:00:00Z') },
    ]);
    expect(result).toMatchObject([
      { role: 'user', content: [{ type: 'text', data: 'Hello' }] },
      {
        role: 'system',
        content: [{ type: 'text', data: 'Rules', status: 'complete' }],
        datetime: '2026-01-01T00:00:00.000Z',
      },
    ]);
  });

  it('associates tool results and merges an assistant tool loop', () => {
    const result = convertOpenClawHistory(
      [
        {
          role: 'assistant',
          stopReason: 'toolUse',
          content: [{ type: 'toolCall', id: 't1', name: 'read', arguments: { path: '/a' } }],
        },
        {
          role: 'toolResult',
          toolCallId: 't1',
          toolName: 'read',
          content: [{ type: 'text', text: 'contents' }],
          isError: false,
        },
        { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'Finished' }] },
      ],
      { toolCallNameMap: { read: 'file_reader' } },
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      role: 'assistant',
      content: [
        {
          type: 'toolcall-file_reader-t1',
          data: { args: '{"path":"/a"}', result: 'contents', eventType: 'TOOL_CALL_RESULT' },
        },
        { type: 'text', data: 'Finished' },
      ],
    });
  });

  it('skips empty and aborted-empty messages', () => {
    expect(
      convertOpenClawHistory([
        { role: 'user', content: '' },
        { role: 'assistant', stopReason: 'aborted', content: [{ type: 'text', text: '' }] },
      ]),
    ).toEqual([]);
  });

  it('converts a history response payload', () => {
    expect(
      convertOpenClawHistoryResponse({ sessionKey: 's', sessionId: 'id', messages: [{ role: 'user', content: 'Hi' }] }),
    ).toMatchObject([{ role: 'user', content: [{ data: 'Hi' }] }]);
  });

  it.todo('honors skipAborted: false for aborted empty assistant messages');
  it.todo('hides tool arguments and results when showToolCallDetails is false');
  it.todo('preserves toolResult isError metadata on converted tool calls');
});
