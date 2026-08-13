import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MessageStore } from '../../store/message';
import type { AIMessage, AIMessageContent, TextContent } from '../../type';
import MessageProcessor from '../../processor/index';

const assistantMessage = (id: string, content: AIMessageContent[] = []): AIMessage => ({
  id,
  role: 'assistant',
  status: 'streaming',
  content,
});

describe('MessageProcessor', () => {
  let processor: MessageProcessor;
  let store: MessageStore;

  beforeEach(() => {
    processor = new MessageProcessor();
    store = new MessageStore();
    store.initialize();
  });

  it('creates a complete user message with attachments before text', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const attachments = [{ fileType: 'image' as const, name: 'photo.png' }];

    expect(processor.createUserMessage('hello', attachments)).toEqual({
      id: 'msg_1000_10000',
      role: 'user',
      status: 'complete',
      datetime: '1000',
      content: [
        { type: 'attachment', data: attachments },
        { type: 'text', data: 'hello' },
      ],
    });
  });

  it('omits an attachment block when no attachments are supplied', () => {
    const message = processor.createUserMessage('hello');
    expect(message.content).toEqual([{ type: 'text', data: 'hello' }]);
  });

  it('creates assistant messages with defaults and supplied values', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2000);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const date = vi.spyOn(Date.prototype, 'toISOString').mockReturnValue('2026-01-01T00:00:00.000Z');
    const content: AIMessageContent[] = [{ type: 'text', data: 'ready' }];

    expect(processor.createAssistantMessage()).toEqual({
      id: 'msg_2000_55000',
      role: 'assistant',
      content: [],
      status: 'pending',
      datetime: '2026-01-01T00:00:00.000Z',
    });
    expect(processor.createAssistantMessage({ content, status: 'complete' })).toMatchObject({
      content,
      status: 'complete',
    });
    date.mockRestore();
  });

  it('defaults a new content block to streaming without mutating it', () => {
    const chunk = { type: 'text' as const, data: 'hello' };
    const result = processor.processContentUpdate(undefined, chunk);

    expect(result).toEqual({ ...chunk, status: 'streaming' });
    expect(result).not.toBe(chunk);
    expect(chunk).not.toHaveProperty('status');
  });

  it.each([
    [
      'text',
      { type: 'text', data: 'Hello ', ext: { old: true } },
      { type: 'text', data: 'world', ext: { new: true } },
      'Hello world',
    ],
    ['markdown', { type: 'markdown', data: '**A' }, { type: 'markdown', data: 'B**', status: 'complete' }, '**AB**'],
  ] as const)('merges incremental %s content', (_label, existing, chunk, expectedData) => {
    expect(processor.processContentUpdate(existing, chunk)).toEqual({
      ...existing,
      data: expectedData,
      status: 'status' in chunk ? chunk.status : 'streaming',
      ext: {
        ...('ext' in existing ? existing.ext : undefined),
        ...('ext' in chunk ? chunk.ext : undefined),
      },
    });
  });

  it('merges thinking text and metadata', () => {
    const existing = { type: 'thinking' as const, data: { text: 'step 1', title: 'Plan' } };
    const chunk = { type: 'thinking' as const, data: { text: ' + step 2' }, status: 'complete' as const };

    expect(processor.processContentUpdate(existing, chunk)).toEqual({
      type: 'thinking',
      data: { text: 'step 1 + step 2', title: 'Plan' },
      status: 'complete',
      ext: {},
    });
  });

  it('merges image and search objects', () => {
    expect(
      processor.processContentUpdate(
        { type: 'image', data: { name: 'preview', width: 100 } },
        { type: 'image', data: { url: 'image.png', width: 200 } },
      ),
    ).toMatchObject({ data: { name: 'preview', url: 'image.png', width: 200 }, status: 'streaming' });

    expect(
      processor.processContentUpdate(
        { type: 'search', data: { title: 'Sources', references: [{ title: 'old' }] } },
        { type: 'search', data: { references: [{ title: 'new' }] } },
      ),
    ).toMatchObject({ data: { title: 'Sources', references: [{ title: 'new' }] } });
  });

  it('uses the default shallow merge for unregistered and mismatched types', () => {
    const existing: AIMessageContent = { type: 'suggestion', data: [{ title: 'old' }], ext: { retained: true } };
    const chunk: AIMessageContent = { type: 'suggestion', data: [{ title: 'new' }] };
    expect(processor.processContentUpdate(existing, chunk)).toEqual({
      type: 'suggestion',
      data: [{ title: 'new' }],
      status: 'streaming',
      ext: { retained: true },
    });

    expect(
      processor.processContentUpdate(
        { type: 'text', data: 'old' },
        { type: 'markdown', data: 'new', status: 'complete' },
      ),
    ).toEqual({ type: 'markdown', data: 'new', status: 'complete' });
  });

  it('supports custom merge handlers', () => {
    processor.registerHandler<TextContent>('text', (chunk, existing) => ({
      ...chunk,
      data: `${existing?.data ?? ''}|${chunk.data}`,
      status: 'complete',
    }));

    expect(processor.processContentUpdate({ type: 'text', data: 'old' }, { type: 'text', data: 'new' })).toEqual({
      type: 'text',
      data: 'old|new',
      status: 'complete',
    });
  });

  it('does nothing for null updates', () => {
    const update = vi.spyOn(store, 'updateMultipleContents');
    processor.applyContentUpdate(store, 'missing', null);
    expect(update).not.toHaveBeenCalled();
  });

  it('delegates array updates to the store', () => {
    const contents: AIMessageContent[] = [{ type: 'text', data: 'full response' }];
    const update = vi.spyOn(store, 'updateMultipleContents');

    processor.applyContentUpdate(store, 'assistant', contents);

    expect(update).toHaveBeenCalledWith('assistant', contents);
  });

  it('appends a single chunk when explicitly requested', () => {
    store.createMessage(assistantMessage('assistant', [{ type: 'text', data: 'first' }]));

    processor.applyContentUpdate(store, 'assistant', { type: 'text', data: 'second', strategy: 'append' });

    expect((store.getMessageByID('assistant') as AIMessage).content).toEqual([
      { type: 'text', data: 'first' },
      { type: 'text', data: 'second', strategy: 'append', status: 'streaming' },
    ]);
  });

  it('merges into the last same-type content block in the current message', () => {
    store.createMessage(
      assistantMessage('assistant', [
        { type: 'text', data: 'first' },
        { type: 'thinking', data: { text: 'middle' } },
        { type: 'text', data: 'last' },
      ]),
    );

    processor.applyContentUpdate(store, 'assistant', { type: 'text', data: ' update' });

    expect((store.getMessageByID('assistant') as AIMessage).content?.[2]).toMatchObject({
      data: 'last update',
      status: 'streaming',
    });
  });

  it('adds a merge chunk when no matching content exists', () => {
    store.createMessage(assistantMessage('assistant'));
    processor.applyContentUpdate(store, 'assistant', { type: 'image', data: { url: 'image.png' } });
    expect((store.getMessageByID('assistant') as AIMessage).content).toEqual([
      { type: 'image', data: { url: 'image.png' }, status: 'streaming' },
    ]);
  });

  it('updates the nearest previous matching tool call across messages', () => {
    store.createMultiMessages([
      assistantMessage('older', [
        {
          type: 'toolcall-weather',
          data: { toolCallId: 'call-1', toolCallName: 'weather', args: '{}' },
        },
      ]),
      assistantMessage('current'),
    ]);

    processor.applyContentUpdate(store, 'current', {
      type: 'toolcall-weather',
      data: { toolCallId: 'call-1', toolCallName: 'weather', result: 'sunny' },
    });

    expect((store.getMessageByID('older') as AIMessage).content?.[0]).toMatchObject({
      data: { toolCallId: 'call-1', toolCallName: 'weather', result: 'sunny' },
    });
    expect((store.getMessageByID('current') as AIMessage).content).toEqual([]);
  });

  it('does not merge activity content across messages', () => {
    store.createMultiMessages([
      assistantMessage('older', [{ type: 'activity-task', data: { activityType: 'task', content: { state: 'old' } } }]),
      assistantMessage('current'),
    ]);

    processor.applyContentUpdate(store, 'current', {
      type: 'activity-task',
      data: { activityType: 'task', content: { state: 'new' } },
    });

    expect((store.getMessageByID('current') as AIMessage).content).toHaveLength(1);
    expect((store.getMessageByID('older') as AIMessage).content?.[0]).toMatchObject({
      data: { content: { state: 'old' } },
    });
  });

  it('ignores chunks for missing, user, or content-less assistant messages', () => {
    store.createMultiMessages([
      { id: 'user', role: 'user', content: [{ type: 'text', data: 'hello' }] },
      { id: 'content-less', role: 'assistant' },
    ]);
    const append = vi.spyOn(store, 'appendContent');

    processor.applyContentUpdate(store, 'missing', { type: 'text', data: 'ignored' });
    processor.applyContentUpdate(store, 'user', { type: 'text', data: 'ignored' });
    processor.applyContentUpdate(store, 'content-less', { type: 'text', data: 'ignored' });

    expect(append).not.toHaveBeenCalled();
  });
});
