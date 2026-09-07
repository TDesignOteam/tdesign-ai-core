import { describe, expect, it, vi } from 'vitest';

import { convertOpenClawHistory, convertOpenClawHistoryResponse, isOpenClawHistoryMessage } from '../history-converter';

describe('OpenClaw 历史消息转换器', () => {
  it('识别支持的消息角色', () => {
    expect(isOpenClawHistoryMessage({ role: 'assistant' })).toBe(true);
    expect(isOpenClawHistoryMessage({ role: 'unknown' })).toBe(false);
    expect(isOpenClawHistoryMessage({})).toBe(false);
  });

  it('转换带时间戳的用户与系统文本', () => {
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

  it('关联工具调用结果并合并助手的工具调用循环', () => {
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

  it('跳过空消息与已中止的空消息', () => {
    expect(
      convertOpenClawHistory([
        { role: 'user', content: '' },
        { role: 'assistant', stopReason: 'aborted', content: [{ type: 'text', text: '' }] },
      ]),
    ).toEqual([]);
  });

  it('转换历史消息响应载荷', () => {
    expect(
      convertOpenClawHistoryResponse({ sessionKey: 's', sessionId: 'id', messages: [{ role: 'user', content: 'Hi' }] }),
    ).toMatchObject([{ role: 'user', content: [{ data: 'Hi' }] }]);
  });

  it('对已中止的空助手消息支持 skipAborted: false', () => {
    const result = convertOpenClawHistory(
      [{ role: 'assistant', stopReason: 'aborted', content: [{ type: 'text', text: 'partial result' }] }],
      { skipAborted: false },
    );

    expect(result).toMatchObject([{ role: 'assistant', content: [{ type: 'text', data: 'partial result' }] }]);
  });

  it('当 showToolCallDetails 为 false 时隐藏工具调用参数与结果', () => {
    const result = convertOpenClawHistory(
      [
        {
          role: 'assistant',
          stopReason: 'toolUse',
          content: [{ type: 'toolCall', id: 't1', name: 'read', arguments: { path: '/a' } }],
        },
        { role: 'toolResult', toolCallId: 't1', content: [{ type: 'text', text: 'contents' }] },
      ],
      { showToolCallDetails: false },
    );

    expect(result[0]).toMatchObject({ content: [{ data: { args: '', result: '' } }] });
  });

  it('在转换后的工具调用上保留 toolResult 的 isError 元数据', () => {
    const result = convertOpenClawHistory([
      { role: 'assistant', stopReason: 'toolUse', content: [{ type: 'toolCall', id: 't1', name: 'read' }] },
      { role: 'toolResult', toolCallId: 't1', content: [{ type: 'text', text: 'failed' }], isError: true },
    ]);

    expect(result[0]).toMatchObject({ content: [{ data: { ext: { isError: true } } }] });
  });
});
