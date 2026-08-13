import { describe, expect, it } from 'vitest';

import {
  handleSuggestionToolCall,
  mergeStringContent,
  parseSSEData,
  updateToolCall,
} from '../../../adapters/shared/merge-utils';

describe('shared merge utilities', () => {
  it('uses the delta when no existing string is present', () => {
    expect(mergeStringContent(undefined, 'first')).toBe('first');
    expect(mergeStringContent('', 'first')).toBe('first');
  });

  it('merges JSON objects and arrays', () => {
    expect(mergeStringContent('{"first":1}', '{"second":2}')).toBe('{"first":1,"second":2}');
    expect(mergeStringContent('[1,2]', '[3]')).toBe('[1,2,3]');
  });

  it('concatenates partial non-JSON strings and replaces parsed scalar values', () => {
    expect(mergeStringContent('hel', 'lo')).toBe('hello');
    expect(mergeStringContent('1', '2')).toBe('2');
  });

  it('parses valid JSON values and rejects invalid input', () => {
    const object = { ready: true };

    expect(parseSSEData('{"ready":true}')).toEqual(object);
    expect(parseSSEData('[1,"two",null]')).toEqual([1, 'two', null]);
    expect(parseSSEData('not json')).toBeNull();
    expect(parseSSEData(object)).toBe(object);
  });

  it('returns an updated tool call without mutating the original', () => {
    const original = { toolCallId: 'id', toolCallName: 'search', args: '{}' };

    const result = updateToolCall(original, { result: 'done' });

    expect(result).toEqual({ ...original, result: 'done' });
    expect(result).not.toBe(original);
    expect(original).not.toHaveProperty('result');
  });

  it('converts valid suggestion tool results to suggestion content', () => {
    expect(
      handleSuggestionToolCall({
        toolCallId: 'id',
        toolCallName: 'suggestion',
        result: '[{"title":"Next","prompt":"continue"}]',
      }),
    ).toEqual({
      type: 'suggestion',
      data: [{ title: 'Next', prompt: 'continue' }],
      status: 'complete',
      strategy: 'append',
    });
  });

  it('rejects unrelated or malformed suggestion tool results', () => {
    expect(handleSuggestionToolCall({ toolCallId: 'id', toolCallName: 'other' })).toBeNull();
    expect(
      handleSuggestionToolCall({ toolCallId: 'id', toolCallName: 'suggestion', result: '[{"prompt":"missing"}]' }),
    ).toBeNull();
    expect(handleSuggestionToolCall({ toolCallId: 'id', toolCallName: 'suggestion', result: 'invalid' })).toBeNull();
  });
});
