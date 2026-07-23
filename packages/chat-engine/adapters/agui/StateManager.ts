import type { ChatJSONObject } from '../../type';
import { applyJsonPatch } from '../../utils';
import type { StateDeltaEvent, StateSnapshotEvent } from './types/events';

export interface StateManager {
  getCurrentStateKey: () => string | null;
  getCurrentState: <TState extends ChatJSONObject = ChatJSONObject>() => TState | null;
  getState: <TState extends ChatJSONObject = ChatJSONObject>(stateKey: string) => TState | undefined;
  getAllStateKeys: () => string[];
  subscribe: <TState extends ChatJSONObject = ChatJSONObject>(
    callback: (state: TState, stateKey: string) => void,
    targetStateKey?: string,
  ) => () => void;
  handleStateEvent: (event: StateSnapshotEvent | StateDeltaEvent) => void;
  clear: () => void;
}

export class StateManagerImpl implements StateManager {
  private states: Record<string, ChatJSONObject> = {};
  private currentStateKey: string | null = null;
  private latestSubscribers = new Set<(state: ChatJSONObject, stateKey: string) => void>();
  private boundSubscribers = new Map<string, Set<(state: ChatJSONObject) => void>>();

  getCurrentStateKey(): string | null {
    return this.currentStateKey;
  }

  getCurrentState<TState extends ChatJSONObject = ChatJSONObject>(): TState | null {
    return this.currentStateKey ? (this.states[this.currentStateKey] as TState | undefined) || null : null;
  }

  getState<TState extends ChatJSONObject = ChatJSONObject>(stateKey: string): TState | undefined {
    return this.states[stateKey] as TState | undefined;
  }

  getAllStateKeys(): string[] {
    return Object.keys(this.states);
  }

  subscribeToLatest<TState extends ChatJSONObject = ChatJSONObject>(
    callback: (state: TState, stateKey: string) => void,
  ): () => void {
    const subscriber = callback as (state: ChatJSONObject, stateKey: string) => void;
    this.latestSubscribers.add(subscriber);
    const state = this.getCurrentState<TState>();
    if (state && this.currentStateKey) callback(state, this.currentStateKey);
    return () => this.latestSubscribers.delete(subscriber);
  }

  subscribe<TState extends ChatJSONObject = ChatJSONObject>(
    callback: (state: TState, stateKey: string) => void,
    targetStateKey?: string,
  ): () => void {
    return targetStateKey
      ? this.subscribeToState<TState>(targetStateKey, (state) => callback(state, targetStateKey))
      : this.subscribeToLatest(callback);
  }

  subscribeToState<TState extends ChatJSONObject = ChatJSONObject>(
    stateKey: string,
    callback: (state: TState) => void,
  ): () => void {
    const subscribers = this.boundSubscribers.get(stateKey) || new Set<(state: ChatJSONObject) => void>();
    const subscriber = callback as (state: ChatJSONObject) => void;
    subscribers.add(subscriber);
    this.boundSubscribers.set(stateKey, subscribers);
    const state = this.getState<TState>(stateKey);
    if (state) callback(state);
    return () => subscribers.delete(subscriber);
  }

  handleStateEvent(event: StateSnapshotEvent | StateDeltaEvent): void {
    if (event.type === 'STATE_SNAPSHOT') {
      Object.entries(event.snapshot).forEach(([stateKey, state]) => {
        if (isChatJSONObject(state)) this.setState(stateKey, state);
      });
      return;
    }
    const firstDelta = event.delta[0];
    const stateKey = firstDelta?.path.split('/')[1];
    if (!stateKey || !this.states[stateKey]) return;
    const structure: Record<string, ChatJSONObject> = { [stateKey]: this.states[stateKey] };
    const updated = applyJsonPatch(structure, event.delta);
    const state = updated[stateKey];
    if (state) this.setState(stateKey, state);
  }

  clear(): void {
    this.states = {};
    this.latestSubscribers.clear();
    this.boundSubscribers.clear();
    this.currentStateKey = null;
  }

  private setState(stateKey: string, state: ChatJSONObject): void {
    this.states[stateKey] = state;
    this.currentStateKey = stateKey;
    this.boundSubscribers.get(stateKey)?.forEach((callback) => callback(state));
    this.latestSubscribers.forEach((callback) => callback(state, stateKey));
  }
}

function isChatJSONObject(value: unknown): value is ChatJSONObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export const stateManager = new StateManagerImpl();
