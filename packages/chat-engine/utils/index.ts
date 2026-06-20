import type {
  ActivityContent,
  AIMessageContent,
  AttachmentContent,
  ChatMessagesData,
  ImageContent,
  MarkdownContent,
  SearchContent,
  SuggestionContent,
  TextContent,
  ThinkingContent,
  ToolCallContent,
  UserMessageContent,
} from '../type';
import { applyPatchImmutable, type Operation } from './immutable-patch';
import type { JsonPatchOperation } from './json-patch-operation';

/**
 * 应用JSON Patch操作到状态对象
 *
 * 使用 Immutable Patch + Structural Sharing：
 * - 只重建被修改路径上的节点
 * - 未修改的节点保持原引用
 * - 配合 React.memo 使用时，未变化的组件不会重渲染
 *
 * @param state 原始状态对象
 * @param delta 包含patch操作的数组
 * @returns 更新后的新状态对象（结构共享）
 */
export function applyJsonPatch<T>(state: T, delta: JsonPatchOperation[]): T {
  try {
    return applyPatchImmutable(state, delta as Operation[]);
  } catch (error) {
    console.warn('JSON Patch操作失败，返回原始状态:', error);
    return state;
  }
}

export type { JsonPatchOperation } from './json-patch-operation';

/** 判断是否为 fetch / AbortController 产生的中止错误 */
export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

/** 将 unknown 收敛为 onError 回调可接受的 Error | Response */
export function toRequestErrorCallbackArg(error: unknown): Error | Response {
  if (error instanceof Error || error instanceof Response) {
    return error;
  }
  return new Error(error === undefined || error === null ? 'Unknown error' : String(error));
}

/** 将 unknown 收敛为 Error（连接层等仅接受 Error 的场景） */
export function toError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  return new Error(error === undefined || error === null ? 'Unknown error' : String(error));
}

/**
 * 安全解析JSON字符串的工具函数
 *
 * @param value 待解析的值，可能是字符串或已解析的对象
 * @param fallbackValue 解析失败时的回退值，默认为原字符串
 * @param errorContext 错误上下文，用于日志输出
 * @returns 解析后的值或回退值（调用方需自行窄化类型）
 */
export function safeParseJSON(value: unknown, fallbackValue?: unknown, errorContext?: string): unknown {
  if (typeof value !== 'string') {
    return value;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    const context = errorContext ? ` (${errorContext})` : '';
    console.warn(`Failed to parse JSON${context}:`, error);
    return fallbackValue !== undefined ? fallbackValue : value;
  }
}

export function findTargetElement(event: MouseEvent, selector: string | string[]): HTMLElement | null {
  // 统一处理选择器输入格式（支持字符串或数组）
  const selectors = Array.isArray(selector) ? selector : selector.split(',').map((s) => s.trim());

  // 获取事件穿透路径（包含Shadow DOM内部元素）
  const eventPath = event.composedPath();

  // 遍历路径查找目标元素
  for (const el of eventPath) {
    // 类型安全判断 + 多选择器匹配
    if (el instanceof HTMLElement) {
      // 检查是否匹配任意一个选择器
      if (selectors.some((sel) => el.matches?.(sel))) {
        return el; // 找到即返回
      }
    }
  }

  return null; // 未找到返回null
}

// 类型守卫函数
export function isUserMessage(message: ChatMessagesData) {
  return message.role === 'user' && 'content' in message;
}

export function isAIMessage(message: ChatMessagesData) {
  return message.role === 'assistant';
}

export function isThinkingContent(content: AIMessageContent): content is ThinkingContent {
  return content.type === 'thinking';
}

export function isTextContent(content: AIMessageContent): content is TextContent {
  return content.type === 'text';
}

export function isMarkdownContent(content: AIMessageContent): content is MarkdownContent {
  return content.type === 'markdown';
}

export function isImageContent(content: AIMessageContent): content is ImageContent {
  return content.type === 'image';
}

export function isSearchContent(content: AIMessageContent): content is SearchContent {
  return content.type === 'search';
}

export function isSuggestionContent(content: AIMessageContent): content is SuggestionContent {
  return content.type === 'suggestion';
}

export function isAttachmentContent(content: UserMessageContent): content is AttachmentContent {
  return content.type === 'attachment';
}

export function isToolCallContent(content: AIMessageContent): content is ToolCallContent {
  return content.type === 'toolcall' || content.type.startsWith('toolcall-');
}

export function isActivityContent(content: AIMessageContent): content is ActivityContent {
  return content.type === 'activity' || content.type.startsWith('activity-');
}

/** 提取消息复制内容 */
export function getMessageContentForCopy(message: ChatMessagesData): string {
  if (!isAIMessage(message) || !message.content) {
    return '';
  }
  return message.content.reduce((pre: string, item: AIMessageContent) => {
    let append = '';
    if (isTextContent(item) || isMarkdownContent(item)) {
      append = item.data;
    } else if (isThinkingContent(item)) {
      append = item.data.text || '';
    }
    if (!pre) {
      return append;
    }
    return `${pre}\n${append}`;
  }, '');
}
