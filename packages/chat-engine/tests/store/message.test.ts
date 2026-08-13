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

  it('initializes defaults and accepts initial state', () => {
    expect(store.getState()).toEqual({ messageIds: [], messages: [] });

    const initial = userMessage('initial');
    const initialized = new MessageStore();
    initialized.initialize({ messageIds: [initial.id], messages: [initial] });
    expect(initialized.messages).toEqual([initial]);
  });

  it('creates one message and emits its updated snapshot', () => {
    const listener = vi.fn();
    eventBus.on(ChatEngineEventType.MESSAGE_CREATE, listener);
    const message = userMessage('user-1');

    store.createMessage(message);

    expect(store.getState()).toEqual({ messageIds: ['user-1'], messages: [message] });
    expect(listener).toHaveBeenCalledWith({ message, messages: [message] });
  });

  it('creates multiple messages and emits one create event per message', () => {
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
  ] as const)('sets messages in %s mode without emitting create events', (mode, expectedIds) => {
    store.createMessage(userMessage('existing'));
    const listener = vi.fn();
    eventBus.on(ChatEngineEventType.MESSAGE_CREATE, listener);
    const messages = [userMessage('new-1'), assistantMessage('new-2')];

    store.setMessages(messages, mode);

    expect(store.getState().messageIds).toEqual(expectedIds);
    expect(store.messages.map(({ id }) => id)).toEqual(expectedIds);
    expect(listener).not.toHaveBeenCalled();
  });

  it('defaults setMessages to replace mode', () => {
    store.createMessage(userMessage('existing'));
    store.setMessages([userMessage('replacement')]);
    expect(store.getState().messageIds).toEqual(['replacement']);
  });

  it('appends and replaces assistant content while ignoring ineligible messages', () => {
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

  it('updates message and final content status, preserving an error content status', () => {
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

  it('merges extension attributes', () => {
    store.createMessage({ ...userMessage('user'), ext: { source: 'local', count: 1 } });
    store.setMessageExt('user', { count: 2, selected: true });
    store.setMessageExt('missing', { ignored: true });

    expect(store.getMessageByID('user')?.ext).toEqual({ source: 'local', count: 2, selected: true });
  });

  it('removes a message and emits the remaining snapshot', () => {
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

  it('clears history and emits a timestamp', () => {
    vi.spyOn(Date, 'now').mockReturnValue(456);
    store.createMessage(userMessage('user'));
    const listener = vi.fn();
    eventBus.on(ChatEngineEventType.MESSAGE_CLEAR, listener);

    store.clearHistory();

    expect(store.getState()).toEqual({ messageIds: [], messages: [] });
    expect(listener).toHaveBeenCalledWith({ timestamp: 456 });
  });

  it('returns current, last assistant, and last user messages', () => {
    const firstUser = userMessage('user-1');
    const assistant = assistantMessage('assistant');
    const lastUser = userMessage('user-2');
    store.createMultiMessages([firstUser, assistant, lastUser]);

    expect(store.currentMessage).toBe(lastUser);
    expect(store.lastAIMessage).toBe(assistant);
    expect(store.lastUserMessage).toBe(lastUser);
    expect(store.getMessageByID('missing')).toBeUndefined();
  });

  it('merges multiple content updates by id first, then type, and appends new content', () => {
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

  it('marks the message errored and stops streaming content when an update contains an error', () => {
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

  it('works without an event bus', () => {
    const standalone = new MessageStore();
    standalone.initialize();
    expect(() => standalone.createMessage(userMessage('user'))).not.toThrow();
    expect(standalone.messages).toHaveLength(1);
  });

  it.todo('assigns a new unique ID when creating a message branch');
  it.todo('does not emit status or delete events when the target message does not exist');
  it.todo('matches id-less content updates by type instead of treating missing IDs as equal');
});
