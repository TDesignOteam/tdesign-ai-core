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
  processToolCalls,
} from '../../../adapters/agui/utils';

describe('AG-UI utilities', () => {
  it('merges JSON objects, arrays, and partial JSON strings', () => {
    expect(mergeStringContent('{"a":1}', '{"b":2}')).toBe('{"a":1,"b":2}');
    expect(mergeStringContent('[1]', '[2,3]')).toBe('[1,2,3]');
    expect(mergeStringContent('{"query":', '"value"}')).toBe('{"query":"value"}');
    expect(mergeStringContent('1', '2')).toBe('2');
  });

  it('parses only JSON-compatible SSE data', () => {
    expect(parseSSEData('{"type":"RUN_STARTED"}')).toEqual({ type: 'RUN_STARTED' });
    expect(parseSSEData('not json')).toBeNull();
    expect(parseSSEData({ ok: true })).toEqual({ ok: true });
  });

  it('extracts the state key from the first state delta operation', () => {
    expect(
      extractStateKeyFromDelta({ type: 'STATE_DELTA', delta: [{ op: 'replace', path: '/cart/count', value: 2 }] }),
    ).toBe('cart');
    expect(extractStateKeyFromDelta({ type: 'ACTIVITY_DELTA', delta: [] })).toBeNull();
  });

  it('maps valid suggestions and preserves arbitrary custom events', () => {
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

  it('associates tool results when converting a message snapshot', () => {
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

  it('converts malformed suggestion tool results to an empty suggestion list', () => {
    const result = processToolCalls(
      [{ id: 's1', type: 'function', function: { name: 'suggestion', arguments: '{}' } }],
      new Map([['s1', { toolCallId: 's1', result: 'invalid' }]]),
    );
    expect(result[0]).toMatchObject({ type: 'suggestion', data: [] });
  });

  it('formats deterministic log messages', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-02T03:04:05.000Z'));
    expect(formatLogMessage('warn', 'retry', { attempt: 2 })).toBe(
      '[2026-01-02T03:04:05.000Z] [WARN] retry [{"attempt":2}]',
    );
    vi.useRealTimers();
  });
});
