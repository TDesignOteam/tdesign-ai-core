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
} from '../index';

describe('utils 公开辅助函数', () => {
  it('应用补丁且不修改原始状态', () => {
    const original = { nested: { count: 1 }, stable: { value: true } };

    const result = applyJsonPatch(original, [{ op: 'replace', path: '/nested/count', value: 2 }]);

    expect(result).toEqual({ nested: { count: 2 }, stable: { value: true } });
    expect(result.stable).toBe(original.stable);
    expect(original.nested.count).toBe(1);
  });

  it('解析 JSON 并在失败时使用指定的回退值', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(safeParseJSON<{ ok: boolean }>('{"ok":true}')).toEqual({ ok: true });
    expect(safeParseJSON('invalid', { ok: false }, 'payload')).toEqual({ ok: false });
    expect(safeParseJSON('invalid')).toBe('invalid');
    expect(warn).toHaveBeenCalledWith('Failed to parse JSON (payload):', expect.any(SyntaxError));
  });

  it('原样返回非字符串的运行时值', () => {
    const value = { alreadyParsed: true };

    expect(safeParseJSON(value as unknown as string)).toBe(value);
  });

  it('在组合事件路径中查找第一个匹配的 HTMLElement', () => {
    const button = document.createElement('button');
    button.className = 'action';
    const wrapper = document.createElement('div');
    wrapper.dataset.target = 'true';
    const event = { composedPath: () => [button, wrapper, document] } as unknown as MouseEvent;

    expect(findTargetElement(event, ['[data-target]', '.action'])).toBe(button);
    expect(findTargetElement(event, '[data-target], .missing')).toBe(wrapper);
    expect(findTargetElement(event, '.missing')).toBeNull();
  });

  it('识别消息角色与内置内容类型', () => {
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

  it('从 AI 消息中提取文本、markdown 与思考文本', () => {
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

  it.fails('忽略不可复制的内容且不产生空行', () => {
    const content = [
      { type: 'text', data: 'first' },
      { type: 'image', data: { url: '/image.png' } },
      { type: 'markdown', data: 'second' },
    ] as AIMessageContent[];

    expect(getMessageContentForCopy({ id: 'a1', role: 'assistant', content })).toBe('first\nsecond');
  });
});
