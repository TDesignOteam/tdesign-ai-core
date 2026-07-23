import type { ActivityData, ChatJSONObject } from '../../type';
import { applyJsonPatch } from '../../utils';
import type { ActivityDeltaEvent, ActivitySnapshotEvent } from './types/events';

export interface ActivityManager<TContent extends ChatJSONObject = ChatJSONObject> {
  getCurrentActivityType: () => string | null;
  getCurrentActivity: () => ActivityData<TContent> | null;
  getActivity: (activityType: string) => ActivityData<TContent> | null;
  getAllActivityTypes: () => string[];
  handleActivityEvent: (event: ActivitySnapshotEvent | ActivityDeltaEvent) => ActivityData<TContent> | null;
  clear: () => void;
}

export class ActivityManagerImpl<
  TContent extends ChatJSONObject = ChatJSONObject,
> implements ActivityManager<TContent> {
  private activities: Record<string, ActivityData<TContent>> = {};
  private currentActivityType: string | null = null;

  getCurrentActivityType(): string | null {
    return this.currentActivityType;
  }
  getCurrentActivity(): ActivityData<TContent> | null {
    return this.currentActivityType ? this.activities[this.currentActivityType] || null : null;
  }
  getActivity(activityType: string): ActivityData<TContent> | null {
    return this.activities[activityType] || null;
  }
  getAllActivityTypes(): string[] {
    return Object.keys(this.activities);
  }

  handleActivityEvent(event: ActivitySnapshotEvent | ActivityDeltaEvent): ActivityData<TContent> | null {
    if (event.type === 'ACTIVITY_SNAPSHOT') {
      return this.setActivity(event.activityType, {
        activityType: event.activityType,
        content: event.content as TContent,
        messageId: event.messageId,
      });
    }
    if (!event.activityType) return null;
    const current = this.activities[event.activityType];
    const previousContent = current?.content || this.inferInitialContent(event.patch);
    const oldCount = this.getOperationsCount(previousContent);
    const content = event.patch?.length ? applyJsonPatch(previousContent, event.patch) : previousContent;
    const newCount = this.getOperationsCount(content);
    return this.setActivity(event.activityType, {
      activityType: event.activityType,
      content,
      messageId: event.messageId,
      ...(newCount > oldCount ? { deltaInfo: { fromIndex: oldCount, toIndex: newCount } } : {}),
    });
  }

  clear(): void {
    this.activities = {};
    this.currentActivityType = null;
  }

  private inferInitialContent(patch: ActivityDeltaEvent['patch']): TContent {
    const content: ChatJSONObject = {};
    patch?.forEach((operation) => {
      const [root, child] = operation.path.split('/').filter(Boolean);
      if (root && (child === '-' || /^\d+$/.test(child || ''))) content[root] = [];
    });
    return content as TContent;
  }

  private getOperationsCount(content: TContent): number {
    const collection = content.operations || content.messages;
    return Array.isArray(collection) ? collection.length : 0;
  }

  private setActivity(activityType: string, activity: ActivityData<TContent>): ActivityData<TContent> {
    this.activities[activityType] = activity;
    this.currentActivityType = activityType;
    return activity;
  }
}

export const activityManager = new ActivityManagerImpl();
