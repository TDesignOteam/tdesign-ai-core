// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

import type { AIMessage, AIMessageContent, UserMessage } from '../../type';
import {
  applyJsonPatch,
  findTargetElement,
  getMessageContentForCopy,
  isActivityContent,
  isAIMessage,
  isAttachmentContent,
  isImageContent,
  isMarkdownContent,
  isSearchContent,
  isSuggestionContent,
  isTextContent,
  isThinkingContent,
  isToolCallContent,
  isUserMessage,
  safeParseJSON,
} from '../../utils/index';

describe('utils public helpers', () => {
  it('applies patches without mutating the original state', () => {
    const original = { nested: { count: 1 }, stable: { value: true } };

    const result = applyJsonPatch(original, [{ op: 'replace', path: '/nested/count', value: 2 }]);

    expect(result).toEqual({ nested: { count: 2 }, stable: { value: true } });
    expect(result.stable).toBe(original.stable);
    expect(original.nested.count).toBe(1);
  });

  it('parses JSON and uses the requested fallback on failure', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(safeParseJSON<{ ok: boolean }>('{"ok":true}')).toEqual({ ok: true });
    expect(safeParseJSON('invalid', { ok: false }, 'payload')).toEqual({ ok: false });
    expect(safeParseJSON('invalid')).toBe('invalid');
    expect(warn).toHaveBeenCalledWith('Failed to parse JSON (payload):', expect.any(SyntaxError));
  });

  it('returns non-string runtime values unchanged', () => {
    const value = { alreadyParsed: true };

    expect(safeParseJSON(value as unknown as string)).toBe(value);
  });

  it('finds the first matching HTMLElement in a composed event path', () => {
    const button = document.createElement('button');
    button.className = 'action';
    const wrapper = document.createElement('div');
    wrapper.dataset.target = 'true';
    const event = { composedPath: () => [button, wrapper, document] } as unknown as MouseEvent;

    expect(findTargetElement(event, ['[data-target]', '.action'])).toBe(button);
    expect(findTargetElement(event, '[data-target], .missing')).toBe(wrapper);
    expect(findTargetElement(event, '.missing')).toBeNull();
  });

  it('identifies message roles and built-in content types', () => {
    const user: UserMessage = { id: 'u1', role: 'user', content: [{ type: 'text', data: 'hello' }] };
    const assistant: AIMessage = { id: 'a1', role: 'assistant', content: [] };

    expect(isUserMessage(user)).toBe(true);
    expect(isUserMessage(assistant)).toBe(false);
    expect(isAIMessage(assistant)).toBe(true);
    expect(isAIMessage(user)).toBe(false);
    expect(isThinkingContent({ type: 'thinking', data: {} })).toBe(true);
    expect(isTextContent({ type: 'text', data: '' })).toBe(true);
    expect(isMarkdownContent({ type: 'markdown', data: '' })).toBe(true);
    expect(isImageContent({ type: 'image', data: {} })).toBe(true);
    expect(isSearchContent({ type: 'search', data: {} })).toBe(true);
    expect(isSuggestionContent({ type: 'suggestion', data: [] })).toBe(true);
    expect(isAttachmentContent({ type: 'attachment', data: [] })).toBe(true);
    expect(isToolCallContent({ type: 'toolcall-run-id', data: { toolCallId: 'id', toolCallName: 'run' } })).toBe(true);
    expect(isActivityContent({ type: 'activity-progress', data: { activityType: 'progress', content: {} } })).toBe(
      true,
    );
  });

  it('extracts text, markdown, and thinking text from assistant messages', () => {
    const message: AIMessage = {
      id: 'a1',
      role: 'assistant',
      content: [
        { type: 'text', data: 'first' },
        { type: 'markdown', data: 'second' },
        { type: 'thinking', data: { text: 'third' } },
      ],
    };

    expect(getMessageContentForCopy(message)).toBe('first\nsecond\nthird');
    expect(getMessageContentForCopy({ id: 'u1', role: 'user', content: [] })).toBe('');
    expect(getMessageContentForCopy({ id: 'a2', role: 'assistant' })).toBe('');
  });

  it.todo('omits non-copyable content without adding blank lines', () => {
    const content = [
      { type: 'text', data: 'first' },
      { type: 'image', data: { url: '/image.png' } },
      { type: 'markdown', data: 'second' },
    ] as AIMessageContent[];

    expect(getMessageContentForCopy({ id: 'a1', role: 'assistant', content })).toBe('first\nsecond');
  });
});
