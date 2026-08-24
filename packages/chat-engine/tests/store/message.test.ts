import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatEventBus } from '../../event-bus/ChatEventBus';
import { ChatEngineEventType } from '../../event-bus/types';
import type { AIMessage, UserMessage } from '../../type';
import { MessageStore } from '../../store/message';

const userMessage = (id: string, text = id): UserMessage => ({
  id,
  role: 'user',
  status: 'complete',
  content: [{ type: 'text', data: text }],
});

const assistantMessage = (id: string, content: AIMessage['content'] = []): AIMessage => ({
  id,
  role: 'assistant',
  status: 'pending',
  content,
});

describe('MessageStore', () => {
  let eventBus: ChatEventBus;
  let store: MessageStore;

  beforeEach(() => {
    eventBus = new ChatEventBus();
    store = new MessageStore(eventBus);
    store.initialize();
  });

  it('初始化默认值并接受初始状态', () => {
    expect(store.getState()).toEqual({ messageIds: [], messages: [] });

    const initial = userMessage('initial');
    const initialized = new MessageStore();
    initialized.initialize({ messageIds: [initial.id], messages: [initial] });
    expect(initialized.messages).toEqual([initial]);
  });

  it('创建单条消息并派发其更新后的快照', () => {
    const listener = vi.fn();
    eventBus.on(ChatEngineEventType.MESSAGE_CREATE, listener);
    const message = userMessage('user-1');

    store.createMessage(message);

    expect(store.getState()).toEqual({ messageIds: ['user-1'], messages: [message] });
    expect(listener).toHaveBeenCalledWith({ message, messages: [message] });
  });

  it('创建多条消息并为每条消息派发一次 create 事件', () => {
    const listener = vi.fn();
    eventBus.on(ChatEngineEventType.MESSAGE_CREATE, listener);
    const messages = [userMessage('user-1'), assistantMessage('assistant-1')];

    store.createMultiMessages(messages);

    expect(store.getState().messageIds).toEqual(['user-1', 'assistant-1']);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenNthCalledWith(1, { message: messages[0], messages });
    expect(listener).toHaveBeenNthCalledWith(2, { message: messages[1], messages });
  });

  it.each([
    ['replace', ['new-1', 'new-2']],
    ['prepend', ['new-1', 'new-2', 'existing']],
    ['append', ['existing', 'new-1', 'new-2']],
  ] as const)('以 %s 模式设置消息且不派发 create 事件', (mode, expectedIds) => {
    store.createMessage(userMessage('existing'));
    const listener = vi.fn();
    eventBus.on(ChatEngineEventType.MESSAGE_CREATE, listener);
    const messages = [userMessage('new-1'), assistantMessage('new-2')];

    store.setMessages(messages, mode);

    expect(store.getState().messageIds).toEqual(expectedIds);
    expect(store.messages.map(({ id }) => id)).toEqual(expectedIds);
    expect(listener).not.toHaveBeenCalled();
  });

  it('setMessages 默认使用 replace 模式', () => {
    store.createMessage(userMessage('existing'));
    store.setMessages([userMessage('replacement')]);
    expect(store.getState().messageIds).toEqual(['replacement']);
  });

  it('追加并替换 AI 消息内容，同时忽略不符合条件的消息', () => {
    store.createMultiMessages([assistantMessage('assistant', [{ type: 'text', data: 'first' }]), userMessage('user')]);

    store.appendContent('assistant', { type: 'markdown', data: 'second' });
    store.appendContent('assistant', { type: 'text', data: 'replacement' }, 0);
    store.appendContent('user', { type: 'text', data: 'ignored' });
    store.appendContent('missing', { type: 'text', data: 'ignored' });

    expect((store.getMessageByID('assistant') as AIMessage).content).toEqual([
      { type: 'text', data: 'replacement' },
      { type: 'markdown', data: 'second' },
    ]);

    const replacement = [{ type: 'thinking', data: { text: 'new' } }] as const;
    store.replaceContent('assistant', [...replacement]);
    store.replaceContent('user', [{ type: 'text', data: 'ignored' }]);
    expect((store.getMessageByID('assistant') as AIMessage).content).toEqual(replacement);
  });

  it('更新消息与最终内容状态，并保留错误的内容状态', () => {
    const listener = vi.fn();
    eventBus.on(ChatEngineEventType.MESSAGE_STATUS_CHANGE, listener);
    store.createMultiMessages([
      assistantMessage('normal', [{ type: 'text', data: 'answer', status: 'streaming' }]),
      assistantMessage('error', [{ type: 'text', data: 'failure', status: 'error' }]),
    ]);

    store.setMessageStatus('normal', 'complete');
    store.setMessageStatus('error', 'stop');

    expect(store.getMessageByID('normal')).toMatchObject({
      status: 'complete',
      content: [{ status: 'complete' }],
    });
    expect(store.getMessageByID('error')).toMatchObject({ status: 'stop', content: [{ status: 'error' }] });
    expect(listener).toHaveBeenNthCalledWith(1, {
      messageId: 'normal',
      status: 'complete',
      previousStatus: 'pending',
    });
  });

  it('合并扩展属性', () => {
    store.createMessage({ ...userMessage('user'), ext: { source: 'local', count: 1 } });
    store.setMessageExt('user', { count: 2, selected: true });
    store.setMessageExt('missing', { ignored: true });

    expect(store.getMessageByID('user')?.ext).toEqual({ source: 'local', count: 2, selected: true });
  });

  it('移除消息并派发剩余的快照', () => {
    const first = userMessage('first');
    const second = assistantMessage('second');
    store.createMultiMessages([first, second]);
    const listener = vi.fn();
    eventBus.on(ChatEngineEventType.MESSAGE_DELETE, listener);

    store.removeMessage('first');

    expect(store.getState().messageIds).toEqual(['second']);
    expect(store.messages).toEqual([second]);
    expect(listener).toHaveBeenCalledWith({ messageId: 'first', messages: [second] });
  });

  it('清空历史消息并派发时间戳', () => {
    vi.spyOn(Date, 'now').mockReturnValue(456);
    store.createMessage(userMessage('user'));
    const listener = vi.fn();
    eventBus.on(ChatEngineEventType.MESSAGE_CLEAR, listener);

    store.clearHistory();

    expect(store.getState()).toEqual({ messageIds: [], messages: [] });
    expect(listener).toHaveBeenCalledWith({ timestamp: 456 });
  });

  it('返回当前消息、最后一条 AI 消息与最后一条用户消息', () => {
    const firstUser = userMessage('user-1');
    const assistant = assistantMessage('assistant');
    const lastUser = userMessage('user-2');
    store.createMultiMessages([firstUser, assistant, lastUser]);

    expect(store.currentMessage).toBe(lastUser);
    expect(store.lastAIMessage).toBe(assistant);
    expect(store.lastUserMessage).toBe(lastUser);
    expect(store.getMessageByID('missing')).toBeUndefined();
  });

  it('合并多条内容更新时先按 id 再按类型匹配，并追加新内容', () => {
    store.createMessage(
      assistantMessage('assistant', [
        { id: 'text-1', type: 'text', data: 'old', status: 'streaming', ext: { retained: true } },
        { id: 'image-1', type: 'image', data: { url: 'old.png' } },
      ]),
    );

    store.updateMultipleContents('assistant', [
      { id: 'text-1', type: 'text', data: 'new', status: 'complete' },
      { id: 'image-1', type: 'image', data: { url: 'new.png' } },
      { id: 'thinking-1', type: 'thinking', data: { text: 'reasoning' } },
    ]);

    expect((store.getMessageByID('assistant') as AIMessage).content).toEqual([
      { id: 'text-1', type: 'text', data: 'new', status: 'complete', ext: { retained: true } },
      { id: 'image-1', type: 'image', data: { url: 'new.png' }, status: 'complete' },
      { id: 'thinking-1', type: 'thinking', data: { text: 'reasoning' } },
    ]);
  });

  it('当更新包含错误时将消息标记为错误并停止流式内容', () => {
    store.createMessage(
      assistantMessage('assistant', [
        { id: 'text-1', type: 'text', data: 'partial', status: 'streaming' },
        { id: 'thinking-1', type: 'thinking', data: { text: 'failed' }, status: 'error' },
      ]),
    );

    store.updateMultipleContents('assistant', [{ id: 'image-1', type: 'image', data: { url: 'result.png' } }]);

    expect(store.getMessageByID('assistant')).toMatchObject({
      status: 'error',
      content: [{ status: 'stop' }, { status: 'error' }, { type: 'image' }],
    });
  });

  it('在没有事件总线时也能工作', () => {
    const standalone = new MessageStore();
    standalone.initialize();
    expect(() => standalone.createMessage(userMessage('user'))).not.toThrow();
    expect(standalone.messages).toHaveLength(1);
  });

  it.todo('创建消息分支时分配新的唯一 ID');
  it.todo('目标消息不存在时不派发状态或删除事件');
  it.todo('无 id 的内容更新按类型匹配，而不是把缺失的 id 视为相等');
});
