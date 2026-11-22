import { beforeEach, describe, expect, it } from 'vitest';

import { AGUIEventMapper } from '../event-mapper';
import MessageProcessor from '../../../processor/index';
import { MessageStore } from '../../../store/message';
import type { AIMessage, ChatJSONObject } from '../../../type';

/**
 * 端到端链路测试：AGUIEventMapper → MessageProcessor → MessageStore
 *
 * 验证同类型多实例内容块（markdown / thinking / activity）并行流式更新时，
 * 增量按 (id, type) 路由到各自的块，互不污染，且完成事件只影响对应块。
 */
describe('AGUI 流式链路（mapper → processor → store）', () => {
  let mapper: AGUIEventMapper;
  let processor: MessageProcessor;
  let store: MessageStore;
  const messageId = 'assistant';

  beforeEach(() => {
    mapper = new AGUIEventMapper();
    mapper.reset();
    processor = new MessageProcessor();
    store = new MessageStore();
    store.initialize();
    store.createMessage({ id: messageId, role: 'assistant', status: 'streaming', content: [] });
  });

  const emit = (event: ChatJSONObject) => {
    const mapped = mapper.mapEvent({ data: event });
    if (mapped) processor.applyContentUpdate(store, messageId, mapped);
  };

  const content = () => (store.getMessageByID(messageId) as AIMessage).content!;

  it('交错的文本消息路由到各自的块且完成事件只关闭对应块', () => {
    emit({ type: 'TEXT_MESSAGE_CHUNK', messageId: 't1', delta: 'A1' });
    emit({ type: 'TEXT_MESSAGE_CHUNK', messageId: 't2', delta: 'B1' });
    emit({ type: 'TEXT_MESSAGE_CHUNK', messageId: 't1', delta: 'A2' });
    emit({ type: 'TEXT_MESSAGE_END', messageId: 't1' });

    expect(content()).toHaveLength(2);
    expect(content()[0]).toMatchObject({ type: 'markdown', id: 't1', data: 'A1A2', status: 'complete' });
    expect(content()[1]).toMatchObject({ type: 'markdown', id: 't2', data: 'B1', status: 'streaming' });
  });

  it('推理与文本并行流式且各自独立累积', () => {
    emit({ type: 'REASONING_MESSAGE_CHUNK', messageId: 'r1', delta: 'think-a' });
    emit({ type: 'TEXT_MESSAGE_CHUNK', messageId: 't1', delta: 'answer' });
    emit({ type: 'REASONING_MESSAGE_CHUNK', messageId: 'r1', delta: ' think-b' });
    emit({ type: 'REASONING_MESSAGE_CHUNK', messageId: 'r2', delta: 'other' });
    emit({ type: 'REASONING_MESSAGE_END', messageId: 'r1' });

    expect(content()).toHaveLength(3);
    expect(content()[0]).toMatchObject({
      type: 'thinking',
      id: 'r1',
      status: 'complete',
      data: { text: 'think-a think-b' },
      ext: { collapsed: true },
    });
    expect(content()[1]).toMatchObject({ type: 'markdown', id: 't1', data: 'answer', status: 'streaming' });
    expect(content()[2]).toMatchObject({
      type: 'thinking',
      id: 'r2',
      status: 'streaming',
      data: { text: 'other' },
      ext: { collapsed: false },
    });
  });

  it('旧版 THINKING 在首次写入被冻结后仍能继续合并增量', () => {
    emit({ type: 'THINKING_START', title: '思考中...' });
    emit({ type: 'THINKING_TEXT_MESSAGE_START' });
    emit({ type: 'THINKING_TEXT_MESSAGE_CONTENT', delta: '第一段' });

    const firstContent = content()[0];
    expect(Object.isFrozen(firstContent)).toBe(true);
    expect(Object.isFrozen(firstContent.data)).toBe(true);

    expect(() => emit({ type: 'THINKING_TEXT_MESSAGE_CONTENT', delta: '第二段' })).not.toThrow();
    expect(content()).toHaveLength(1);
    expect(content()[0]).toMatchObject({
      type: 'thinking',
      status: 'streaming',
      data: { text: '第一段第二段', title: '思考中...' },
    });
  });

  it('相同 activityType 的不同 messageId 增量写入各自的块且内容互不污染', () => {
    emit({
      type: 'ACTIVITY_DELTA',
      messageId: 'm1',
      activityType: 'plan',
      patch: [{ op: 'add', path: '/operations/-', value: 'a' }],
    });
    emit({
      type: 'ACTIVITY_DELTA',
      messageId: 'm2',
      activityType: 'plan',
      patch: [{ op: 'add', path: '/operations/-', value: 'x' }],
    });
    emit({
      type: 'ACTIVITY_DELTA',
      messageId: 'm1',
      activityType: 'plan',
      patch: [{ op: 'add', path: '/operations/-', value: 'b' }],
    });

    expect(content()).toHaveLength(2);
    expect(content()[0]).toMatchObject({
      type: 'activity-plan',
      id: 'm1',
      data: { activityType: 'plan', content: { operations: ['a', 'b'] } },
    });
    expect(content()[1]).toMatchObject({
      type: 'activity-plan',
      id: 'm2',
      data: { activityType: 'plan', content: { operations: ['x'] } },
    });
  });

  it('无 messageId 的活动增量回退合并到最近实例（老后端兼容）', () => {
    emit({ type: 'ACTIVITY_SNAPSHOT', messageId: 'm1', activityType: 'plan', content: { operations: ['a'] } });
    emit({
      type: 'ACTIVITY_DELTA',
      activityType: 'plan',
      patch: [{ op: 'add', path: '/operations/-', value: 'b' }],
    });

    expect(content()).toHaveLength(1);
    expect(content()[0]).toMatchObject({
      type: 'activity-plan',
      id: 'm1',
      data: { activityType: 'plan', content: { operations: ['a', 'b'] } },
    });
  });
});
