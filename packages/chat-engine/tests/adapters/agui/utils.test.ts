import { describe, expect, it, vi } from 'vitest';
import type { AGUIHistoryMessage } from '../../../adapters/agui/types';
import { AGUIEventType } from '../../../adapters/agui/types/events';

import {
  buildToolCallMap,
  extractStateKeyFromDelta,
  formatLogMessage,
  handleCustomEvent,
  handleMessagesSnapshot,
  handleSuggestionToolCall,
  isSnapshotMessageContent,
  mergeStringContent,
  parseSSEData,
  processMessageGroup,
  processToolCalls,
} from '../../../adapters/agui/utils';

describe('AG-UI 工具函数', () => {
  it('合并 JSON 对象、数组与不完整的 JSON 字符串', () => {
    expect(mergeStringContent('{"a":1}', '{"b":2}')).toBe('{"a":1,"b":2}');
    expect(mergeStringContent('[1]', '[2,3]')).toBe('[1,2,3]');
    expect(mergeStringContent('{"query":', '"value"}')).toBe('{"query":"value"}');
    expect(mergeStringContent('1', '2')).toBe('2');
  });

  it('仅解析 JSON 兼容的 SSE 数据', () => {
    expect(parseSSEData('{"type":"RUN_STARTED"}')).toEqual({ type: 'RUN_STARTED' });
    expect(parseSSEData('not json')).toBeNull();
    expect(parseSSEData({ ok: true })).toEqual({ ok: true });
  });

  it('从第一个状态增量操作中提取状态键', () => {
    expect(
      extractStateKeyFromDelta({ type: 'STATE_DELTA', delta: [{ op: 'replace', path: '/cart/count', value: 2 }] }),
    ).toBe('cart');
    expect(extractStateKeyFromDelta({ type: 'ACTIVITY_DELTA', delta: [] })).toBeNull();
  });

  it('映射有效的建议并保留任意自定义事件', () => {
    expect(
      handleCustomEvent({ type: AGUIEventType.CUSTOM, name: 'suggestion', value: [{ title: 'Next', prompt: 'go' }] }),
    ).toMatchObject({
      type: 'suggestion',
      data: [{ title: 'Next', prompt: 'go' }],
    });
    expect(handleCustomEvent({ type: AGUIEventType.CUSTOM, name: 'metric', value: 4 })).toMatchObject({
      type: 'custom',
      data: { name: 'metric', value: 4 },
    });
    expect(
      handleSuggestionToolCall({ toolCallId: '1', toolCallName: 'suggestion', result: '[{"title":"Try"}]' }),
    ).toMatchObject({
      type: 'suggestion',
      data: [{ title: 'Try' }],
    });
  });

  it('转换消息快照时关联工具调用结果', () => {
    const messages: AGUIHistoryMessage[] = [
      {
        id: 'm1',
        role: 'assistant',
        content: 'Working',
        toolCalls: [{ id: 'call-1', type: 'function', function: { name: 'search', arguments: '{"q":"x"}' } }],
      },
      { id: 'm2', role: 'tool', toolCallId: 'call-1', content: 'found' },
    ];
    const result = handleMessagesSnapshot(messages);

    expect(isSnapshotMessageContent(result)).toBe(true);
    expect(result).toHaveLength(2);
    expect(result[1]).toMatchObject({
      type: 'toolcall-search-call-1',
      data: { toolCallId: 'call-1', result: 'found' },
    });
    expect(buildToolCallMap(messages).get('call-1')).toEqual({ toolCallId: 'call-1', result: 'found' });
  });

  it('processMessageGroup 将消息 id 透传为内容块 id', () => {
    const contents = processMessageGroup(
      [
        { id: 'a1', role: 'assistant', content: 'hello' },
        { id: 'r1', role: 'reasoning', content: 'why', title: 'Plan' },
        { id: 'act1', role: 'activity', activityType: 'plan', content: { operations: [] } },
      ],
      new Map(),
    );

    expect(contents).toHaveLength(3);
    expect(contents[0]).toMatchObject({ type: 'markdown', id: 'a1', data: 'hello', status: 'complete' });
    expect(contents[1]).toMatchObject({ type: 'thinking', id: 'r1', data: { text: 'why', title: 'Plan' } });
    expect(contents[2]).toMatchObject({
      type: 'activity-plan',
      id: 'act1',
      data: { activityType: 'plan', content: { operations: [] } },
    });
  });

  it('将格式错误的建议工具结果转换为空建议列表', () => {
    const result = processToolCalls(
      [{ id: 's1', type: 'function', function: { name: 'suggestion', arguments: '{}' } }],
      new Map([['s1', { toolCallId: 's1', result: 'invalid' }]]),
    );
    expect(result[0]).toMatchObject({ type: 'suggestion', data: [] });
  });

  it('格式化确定性的日志消息', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-02T03:04:05.000Z'));
    expect(formatLogMessage('warn', 'retry', { attempt: 2 })).toBe(
      '[2026-01-02T03:04:05.000Z] [WARN] retry [{"attempt":2}]',
    );
    vi.useRealTimers();
  });
});
