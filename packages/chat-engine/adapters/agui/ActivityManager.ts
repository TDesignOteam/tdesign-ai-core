import type { ActivityData, ChatJSONObject } from '../../type';
import { applyJsonPatch } from '../../utils';
import type { ActivityDeltaEvent, ActivitySnapshotEvent } from './types/events';

export interface ActivityManager {
  getCurrentActivityType: () => string | null;
  getCurrentActivity: () => ActivityData<ChatJSONObject> | null;
  getActivity: (activityType: string, messageId?: string) => ActivityData<ChatJSONObject> | null;
  getAllActivityTypes: () => string[];
  handleActivityEvent: (event: ActivitySnapshotEvent | ActivityDeltaEvent) => ActivityData<ChatJSONObject> | null;
  clear: () => void;
}

/**
 * 生成活动的存储 key
 *
 * 规则：优先使用 messageId 与 activityType 组合，保证同一 activityType
 * 的多个并行实例互不干扰；messageId 缺失时回退到仅使用 activityType，
 * 保持对老后端（不带 messageId）的兼容行为。
 */
function buildActivityKey(activityType: string, messageId?: string): string {
  return messageId ? `${activityType}::${messageId}` : activityType;
}

export class ActivityManagerImpl implements ActivityManager {
  private activities: Record<string, ActivityData<ChatJSONObject>> = {};
  private currentActivityType: string | null = null;
  // 记录每个 activityType 最近一次使用的 key，用于按 activityType 单参数回退查询
  private lastKeyByType: Record<string, string> = {};

  getCurrentActivityType(): string | null {
    return this.currentActivityType;
  }
  getCurrentActivity(): ActivityData<ChatJSONObject> | null {
    if (!this.currentActivityType) return null;
    const key = this.lastKeyByType[this.currentActivityType];
    return (key && this.activities[key]) || null;
  }
  getActivity(activityType: string, messageId?: string): ActivityData<ChatJSONObject> | null {
    // 带 messageId：按精确 key 查询，不回退。
    // 否则同一 activityType 已有实例时，新 messageId 的首个增量会被误判为已存在，
    // 导致策略误用 merge 且补丁被应用到其他实例的内容上。
    if (messageId) {
      return this.activities[buildActivityKey(activityType, messageId)] || null;
    }
    // 无 messageId：回退到该 activityType 最近一次的实例（兼容老后端不带 messageId 的场景）
    const fallbackKey = this.lastKeyByType[activityType];
    return (fallbackKey && this.activities[fallbackKey]) || null;
  }
  getAllActivityTypes(): string[] {
    // 去重返回所有已出现过的 activityType
    return Array.from(new Set(Object.values(this.activities).map((a) => a.activityType)));
  }

  handleActivityEvent(event: ActivitySnapshotEvent | ActivityDeltaEvent): ActivityData<ChatJSONObject> | null {
    if (event.type === 'ACTIVITY_SNAPSHOT') {
      return this.setActivity(event.activityType, event.messageId, {
        activityType: event.activityType,
        content: event.content,
        messageId: event.messageId,
      });
    }
    if (!event.activityType) return null;
    // Delta：带 messageId 时按精确 key 查找，未命中视为新实例从空内容开始；
    // 无 messageId 时回退到该 activityType 最近一次实例
    const current = this.getActivity(event.activityType, event.messageId);
    const previousContent = current?.content || this.inferInitialContent(event.patch);
    const oldCount = this.getOperationsCount(previousContent);
    const content = event.patch?.length ? applyJsonPatch(previousContent, event.patch) : previousContent;
    const newCount = this.getOperationsCount(content);
    // Delta 事件的 messageId 缺失时，沿用回退到的 current.messageId，保证 key 稳定
    const effectiveMessageId = event.messageId || current?.messageId;
    return this.setActivity(event.activityType, effectiveMessageId, {
      activityType: event.activityType,
      content,
      messageId: effectiveMessageId,
      ...(newCount > oldCount ? { deltaInfo: { fromIndex: oldCount, toIndex: newCount } } : {}),
    });
  }

  clear(): void {
    this.activities = {};
    this.currentActivityType = null;
    this.lastKeyByType = {};
  }

  private inferInitialContent(patch: ActivityDeltaEvent['patch']): ChatJSONObject {
    const content: ChatJSONObject = {};
    patch?.forEach((operation) => {
      const [root, child] = operation.path.split('/').filter(Boolean);
      if (root && (child === '-' || /^\d+$/.test(child || ''))) content[root] = [];
    });
    return content;
  }

  private getOperationsCount(content: ChatJSONObject): number {
    const collection = content.operations || content.messages;
    return Array.isArray(collection) ? collection.length : 0;
  }

  private setActivity(
    activityType: string,
    messageId: string | undefined,
    activity: ActivityData<ChatJSONObject>,
  ): ActivityData<ChatJSONObject> {
    const key = buildActivityKey(activityType, messageId);
    this.activities[key] = activity;
    this.currentActivityType = activityType;
    this.lastKeyByType[activityType] = key;
    return activity;
  }
}

export const activityManager = new ActivityManagerImpl();
