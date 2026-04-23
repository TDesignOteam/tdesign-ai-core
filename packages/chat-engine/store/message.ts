/* eslint-disable no-param-reassign */
/* eslint-disable class-methods-use-this */
import type {
  AIMessage,
  AIMessageContent,
  ChatMessagesData,
  ChatMessageSetterMode,
  ChatMessageStore,
  UserMessage,
} from '../type';
import { isAIMessage, isUserMessage } from '../utils';
import { ChatEngineEventType, type IChatEventBus } from '../event-bus';
import ReactiveState from './reactiveState';

/**
 * MessageStore - 消息存储
 *
 * 专注消息生命周期管理；在持有 eventBus 时，会在 CRUD 操作内自动广播
 * 对应的 MESSAGE_* 事件，调用方无需在外层再手动 emit。
 *
 * 事件覆盖：
 * - createMessage / createMultiMessages / createMessageBranch → MESSAGE_CREATE（每条消息一次）
 * - removeMessage → MESSAGE_DELETE
 * - clearHistory → MESSAGE_CLEAR
 * - setMessageStatus → MESSAGE_STATUS_CHANGE
 *
 * setMessages 不 emit（语义上属于批量替换/同步历史，非"用户新建"）。
 * 内容增量更新（appendContent / replaceContent / updateMultipleContents）
 * 由上层 processMessageResult 统一 emit MESSAGE_UPDATE，含原始 result 参数。
 */
export class MessageStore extends ReactiveState<ChatMessageStore> {
  private eventBus?: IChatEventBus;

  constructor(eventBus?: IChatEventBus) {
    super();
    this.eventBus = eventBus;
  }

  initialize(initialState?: Partial<ChatMessageStore>) {
    super.initialize({
      messageIds: [],
      messages: [],
      ...initialState,
    });
  }

  createMessage(message: ChatMessagesData) {
    const { id } = message;
    this.setState((draft) => {
      draft.messageIds.push(id);
      draft.messages.push(message);
    });
    this.eventBus?.emit(ChatEngineEventType.MESSAGE_CREATE, {
      message,
      messages: this.messages,
    });
  }

  createMultiMessages(messages: ChatMessagesData[]) {
    this.setState((draft) => {
      messages.forEach((msg) => {
        draft.messageIds.push(msg.id);
      });
      draft.messages.push(...messages);
    });
    if (this.eventBus) {
      const snapshot = this.messages;
      messages.forEach((msg) => {
        this.eventBus!.emit(ChatEngineEventType.MESSAGE_CREATE, {
          message: msg,
          messages: snapshot,
        });
      });
    }
  }

  setMessages(messages: ChatMessagesData[], mode: ChatMessageSetterMode = 'replace') {
    this.setState((draft) => {
      if (mode === 'replace') {
        draft.messageIds = messages.map((msg) => msg.id);
        draft.messages = [...messages];
      } else if (mode === 'prepend') {
        draft.messageIds = [...messages.map((msg) => msg.id), ...draft.messageIds];
        draft.messages = [...messages, ...draft.messages];
      } else {
        draft.messageIds.push(...messages.map((msg) => msg.id));
        draft.messages.push(...messages);
      }
    });
  }

  // 追加内容到指定类型的content
  appendContent(messageId: string, processedContent: AIMessageContent, targetIndex = -1) {
    this.setState((draft) => {
      const message = draft.messages.find((m) => m.id === messageId);
      if (!message || !isAIMessage(message) || !message.content) return;

      if (targetIndex >= 0 && targetIndex < message.content.length) {
        // 合并到指定位置
        message.content[targetIndex] = processedContent;
      } else {
        // 添加新内容块
        message.content.push(processedContent);
      }

      // 移除消息整体状态的自动推断，让ChatEngine控制
      // this.updateMessageStatusByContent(message);
    });
  }

  // 完整替换消息的content数组
  replaceContent(messageId: string, processedContent: AIMessageContent[]) {
    this.setState((draft) => {
      const message = draft.messages.find((m) => m.id === messageId);
      if (!message || !isAIMessage(message)) return;
      message.content = processedContent;
    });
  }

  // 更新消息整体状态
  setMessageStatus(messageId: string, status: ChatMessagesData['status']) {
    const previousStatus = this.getMessageByID(messageId)?.status;
    this.setState((draft) => {
      const message = draft.messages.find((m) => m.id === messageId);
      if (message) {
        message.status = status;
        if (isAIMessage(message) && message.content && message.content.length > 0) {
          const lastContent = message.content[message.content.length - 1];
          // 添加类型检查，确保content有status属性
          if ('status' in lastContent && lastContent.status !== 'error') {
            lastContent.status = status;
          }
        }
      }
    });
    if (status !== undefined) {
      this.eventBus?.emit(ChatEngineEventType.MESSAGE_STATUS_CHANGE, {
        messageId,
        status,
        previousStatus,
      });
    }
  }

  // 为消息设置扩展属性
  setMessageExt(messageId: string, attr = {}) {
    this.setState((draft) => {
      const message = draft.messages.find((m) => m.id === messageId);
      if (message) {
        message.ext = { ...message.ext, ...attr };
      }
    });
  }

  // 为AI消息设置工具调用
  // setMessageToolCalls(messageId: string, toolCalls: ToolCall[]) {
  //   this.setState((draft) => {
  //     const message = draft.messages.find((m) => m.id === messageId);
  //     if (message && isAIMessage(message)) {
  //       message.toolCalls = toolCalls;
  //     }
  //   });
  // }

  clearHistory() {
    this.setState((draft) => {
      draft.messageIds = [];
      draft.messages = [];
    });
    this.eventBus?.emit(ChatEngineEventType.MESSAGE_CLEAR, {
      timestamp: Date.now(),
    });
  }

  // 删除指定消息
  removeMessage(messageId: string) {
    this.setState((draft) => {
      // 从ID列表删除
      const idIndex = draft.messageIds.indexOf(messageId);
      if (idIndex !== -1) {
        draft.messageIds.splice(idIndex, 1);
      }

      // 从消息列表删除
      draft.messages = draft.messages.filter((msg) => msg.id !== messageId);
    });
    this.eventBus?.emit(ChatEngineEventType.MESSAGE_DELETE, {
      messageId,
      messages: this.messages,
    });
  }

  // 创建消息分支（用于保留历史版本）
  createMessageBranch(messageId: string) {
    const original = this.getState().messages.find((m) => m.id === messageId);
    if (!original || !original.content) return;

    // 克隆消息并生成新ID
    const branchedMessage = {
      ...original,
      content: original.content.map((c) => ({ ...c })),
    } as ChatMessagesData;

    this.createMessage(branchedMessage);
  }

  get messages() {
    return this.getState().messages;
  }

  getMessageByID(id: string) {
    return this.getState().messages.find((m) => m.id === id);
  }

  get currentMessage(): ChatMessagesData {
    const { messages } = this.getState();
    return messages[messages.length - 1];
  }

  get lastAIMessage(): AIMessage | undefined {
    const { messages } = this.getState();
    const aiMessages = messages.filter((msg) => isAIMessage(msg));
    return aiMessages[aiMessages.length - 1];
  }

  get lastUserMessage(): UserMessage | undefined {
    const { messages } = this.getState();
    const userMessages = messages.filter((msg) => isUserMessage(msg));
    return userMessages[userMessages.length - 1];
  }

  // 更新消息整体状态（自动推断）
  private updateMessageStatusByContent(message: AIMessage) {
    if (!message.content) return;

    // 优先处理错误状态
    if (message.content.some((c) => c.status === 'error')) {
      message.status = 'error';
      message.content.forEach((content) => {
        if (content.status) {
          const resolvedStatus = content.status || 'streaming';
          content.status = resolvedStatus === 'streaming' ? 'stop' : content.status;
        }
      });
      return;
    }

    // 非最后一个内容块处理
    message.content.slice(0, -1).forEach((content) => {
      content.status = content.status !== 'error' && content.status !== 'stop' ? 'complete' : content.status;
    });
  }

  /**
   * 更新多个内容块
   * @param messageId 消息ID
   * @param contents 要更新的内容块数组
   */
  updateMultipleContents(messageId: string, contents: AIMessageContent[]) {
    this.setState((draft) => {
      const message = draft.messages.find((m) => m.id === messageId);
      if (!message || !isAIMessage(message) || !message.content) return;

      const messageContent = message.content; // 确保TypeScript知道content存在

      // 更新或添加每个内容块
      contents.forEach((content) => {
        const existingIndex = messageContent.findIndex((c) => c.id === content.id || c.type === content.type);

        if (existingIndex >= 0) {
          // 更新现有内容块
          messageContent[existingIndex] = {
            ...messageContent[existingIndex],
            ...content,
          };
        } else {
          // 添加新内容块
          messageContent.push(content);
        }
      });

      // 消息整体状态的自动推断
      this.updateMessageStatusByContent(message);
    });
  }
}

// 订阅消息列表变化
// useEffect(() => {
//   return service.messageStore.subscribe(state => {
//     setMessages(state.messages);
//   });
// }, []);
