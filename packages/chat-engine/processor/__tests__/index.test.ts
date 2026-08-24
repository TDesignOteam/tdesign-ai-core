import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MessageStore } from '../../store/message';
import type { AIMessage, AIMessageContent, TextContent } from '../../type';
import MessageProcessor from '../index';

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

  it('创建完整的用户消息且附件位于文本之前', () => {
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

  it('未提供附件时省略附件块', () => {
    const message = processor.createUserMessage('hello');
    expect(message.content).toEqual([{ type: 'text', data: 'hello' }]);
  });

  it('使用默认值与传入值创建助手消息', () => {
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

  it('将新内容块默认设为 streaming 且不修改原对象', () => {
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
  ] as const)('合并增量 %s 内容', (_label, existing, chunk, expectedData) => {
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

  it('合并 thinking 文本与元数据', () => {
    const existing = { type: 'thinking' as const, data: { text: 'step 1', title: 'Plan' } };
    const chunk = { type: 'thinking' as const, data: { text: ' + step 2' }, status: 'complete' as const };

    expect(processor.processContentUpdate(existing, chunk)).toEqual({
      type: 'thinking',
      data: { text: 'step 1 + step 2', title: 'Plan' },
      status: 'complete',
      ext: {},
    });
  });

  it('合并 image 与 search 对象', () => {
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

  it('对未注册与不匹配的类型使用默认浅合并', () => {
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

  it('支持自定义合并处理器', () => {
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

  it('对 null 更新不做任何处理', () => {
    const update = vi.spyOn(store, 'updateMultipleContents');
    processor.applyContentUpdate(store, 'missing', null);
    expect(update).not.toHaveBeenCalled();
  });

  it('将数组更新委托给 store', () => {
    const contents: AIMessageContent[] = [{ type: 'text', data: 'full response' }];
    const update = vi.spyOn(store, 'updateMultipleContents');

    processor.applyContentUpdate(store, 'assistant', contents);

    expect(update).toHaveBeenCalledWith('assistant', contents);
  });

  it('显式请求时追加单个数据块', () => {
    store.createMessage(assistantMessage('assistant', [{ type: 'text', data: 'first' }]));

    processor.applyContentUpdate(store, 'assistant', { type: 'text', data: 'second', strategy: 'append' });

    expect((store.getMessageByID('assistant') as AIMessage).content).toEqual([
      { type: 'text', data: 'first' },
      { type: 'text', data: 'second', strategy: 'append', status: 'streaming' },
    ]);
  });

  it('合并到当前消息中最后一个同类型内容块', () => {
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

  it('带 id 的增量按 (id, type) 精确合并到同类型多实例中的目标块', () => {
    store.createMessage(
      assistantMessage('assistant', [
        { type: 'markdown', id: 'md-1', data: 'first', status: 'streaming' },
        { type: 'markdown', id: 'md-2', data: 'second', status: 'streaming' },
      ]),
    );

    processor.applyContentUpdate(store, 'assistant', { type: 'markdown', id: 'md-1', data: ' update' });

    const content = (store.getMessageByID('assistant') as AIMessage).content!;
    expect(content[0]).toMatchObject({ id: 'md-1', data: 'first update' });
    expect(content[1]).toMatchObject({ id: 'md-2', data: 'second' });
  });

  it('带 id 的增量未命中时回退到最后一个同类型块', () => {
    store.createMessage(
      assistantMessage('assistant', [
        { type: 'markdown', id: 'md-1', data: 'first' },
        { type: 'markdown', id: 'md-2', data: 'second' },
      ]),
    );

    processor.applyContentUpdate(store, 'assistant', { type: 'markdown', id: 'md-404', data: ' fallback' });

    const content = (store.getMessageByID('assistant') as AIMessage).content!;
    expect(content).toHaveLength(2);
    expect(content[0]).toMatchObject({ data: 'first' });
    expect(content[1]).toMatchObject({ data: 'second fallback' });
  });

  it('跨消息按 id 精确匹配工具调用', () => {
    store.createMultiMessages([
      assistantMessage('older', [
        { type: 'toolcall-search', id: 'call-2', data: { toolCallId: 'call-2', toolCallName: 'search', args: '{}' } },
        { type: 'toolcall-search', id: 'call-1', data: { toolCallId: 'call-1', toolCallName: 'search', args: '{}' } },
      ]),
      assistantMessage('current'),
    ]);

    processor.applyContentUpdate(store, 'current', {
      type: 'toolcall-search',
      id: 'call-2',
      data: { toolCallId: 'call-2', toolCallName: 'search', result: 'done' },
    });

    const older = (store.getMessageByID('older') as AIMessage).content!;
    expect(older[0].data).toMatchObject({ toolCallId: 'call-2', result: 'done' });
    expect(older[1].data).not.toHaveProperty('result');
    expect((store.getMessageByID('current') as AIMessage).content).toEqual([]);
  });

  it('不存在匹配内容时追加合并数据块', () => {
    store.createMessage(assistantMessage('assistant'));
    processor.applyContentUpdate(store, 'assistant', { type: 'image', data: { url: 'image.png' } });
    expect((store.getMessageByID('assistant') as AIMessage).content).toEqual([
      { type: 'image', data: { url: 'image.png' }, status: 'streaming' },
    ]);
  });

  it('跨消息更新最近一个匹配的工具调用', () => {
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

  it('不跨消息合并 activity 内容', () => {
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

  it('忽略针对不存在消息、用户消息或无内容助手消息的数据块', () => {
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
