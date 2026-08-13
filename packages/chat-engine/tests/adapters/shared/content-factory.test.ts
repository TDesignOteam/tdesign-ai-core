import { describe, expect, it } from 'vitest';

import {
  createActivityContent,
  createAIMessageContent,
  createMarkdownContent,
  createSuggestionContent,
  createTextContent,
  createThinkingContent,
  createToolCallContent,
} from '../../../adapters/shared/content-factory';

describe('shared content factories', () => {
  it('creates generic content with defaults and optional extension data', () => {
    expect(createAIMessageContent('custom-type', { value: 1 })).toEqual({
      type: 'custom-type',
      data: { value: 1 },
      status: 'complete',
      strategy: 'append',
    });
    expect(createAIMessageContent('custom-type', 'data', 'streaming', 'merge', { source: 'test' })).toEqual({
      type: 'custom-type',
      data: 'data',
      status: 'streaming',
      strategy: 'merge',
      ext: { source: 'test' },
    });
  });

  it('creates thinking content with collapsed and extra extension data', () => {
    expect(createThinkingContent({ text: 'working' }, 'complete', 'merge', true, { encrypted: 'value' })).toEqual({
      type: 'thinking',
      data: { text: 'working' },
      status: 'complete',
      strategy: 'merge',
      ext: { collapsed: true, encrypted: 'value' },
    });
  });

  it('creates dynamically typed tool call content', () => {
    const toolCall = { toolCallId: 'call-1', toolCallName: 'search', args: '{"query":"docs"}' };

    expect(createToolCallContent(toolCall, 'streaming', 'merge')).toEqual({
      type: 'toolcall-search-call-1',
      data: toolCall,
      status: 'streaming',
      strategy: 'merge',
    });
  });

  it('creates activity content and exposes delta metadata through ext', () => {
    expect(
      createActivityContent('plan', { operations: [] }, 'streaming', 'merge', { fromIndex: 1, toIndex: 3 }),
    ).toEqual({
      type: 'activity-plan',
      data: { activityType: 'plan', content: { operations: [] } },
      status: 'streaming',
      strategy: 'merge',
      ext: { deltaInfo: { fromIndex: 1, toIndex: 3 } },
    });
  });

  it('creates assistant and system markdown content', () => {
    expect(createMarkdownContent('answer')).toEqual({
      type: 'markdown',
      data: 'answer',
      status: 'complete',
      strategy: 'append',
    });
    expect(createMarkdownContent('notice', 'complete', 'append', 'system')).toEqual({
      type: 'system-text',
      data: 'notice',
      status: 'complete',
      strategy: 'append',
      ext: { role: 'system' },
    });
  });

  it('creates text and suggestion content with their fixed strategies', () => {
    expect(createTextContent('failed', 'error')).toEqual({
      type: 'text',
      data: 'failed',
      status: 'error',
      strategy: 'append',
    });
    expect(createSuggestionContent([{ title: 'Retry', prompt: 'try again' }])).toEqual({
      type: 'suggestion',
      data: [{ title: 'Retry', prompt: 'try again' }],
      status: 'complete',
      strategy: 'append',
    });
  });
});
