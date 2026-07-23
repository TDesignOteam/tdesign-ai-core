import type { ChatJSONObject } from '../../type';
import { applyJsonPatch } from '../../utils';
import type { StateDeltaEvent, StateSnapshotEvent } from './types/events';

export interface StateManager<TState extends ChatJSONObject = ChatJSONObject> {
  getCurrentStateKey: () => string | null;
  getCurrentState: () => TState | null;
  getState: (stateKey: string) => TState | undefined;
  getAllStateKeys: () => string[];
  subscribe: (callback: (state: TState, stateKey: string) => void, targetStateKey?: string) => () => void;
  handleStateEvent: (event: StateSnapshotEvent | StateDeltaEvent) => void;
  clear: () => void;
}

export class StateManagerImpl<TState extends ChatJSONObject = ChatJSONObject> implements StateManager<TState> {
  private states: Record<string, TState> = {};
  private currentStateKey: string | null = null;
  private latestSubscribers = new Set<(state: TState, stateKey: string) => void>();
  private boundSubscribers = new Map<string, Set<(state: TState) => void>>();

  getCurrentStateKey(): string | null {
    return this.currentStateKey;
  }

  getCurrentState(): TState | null {
    return this.currentStateKey ? this.states[this.currentStateKey] || null : null;
  }

  getState(stateKey: string): TState | undefined {
    return this.states[stateKey];
  }

  getAllStateKeys(): string[] {
    return Object.keys(this.states);
  }

  subscribeToLatest(callback: (state: TState, stateKey: string) => void): () => void {
    this.latestSubscribers.add(callback);
    const state = this.getCurrentState();
    if (state && this.currentStateKey) callback(state, this.currentStateKey);
    return () => this.latestSubscribers.delete(callback);
  }

  subscribe(callback: (state: TState, stateKey: string) => void, targetStateKey?: string): () => void {
    return targetStateKey
      ? this.subscribeToState(targetStateKey, (state) => callback(state, targetStateKey))
      : this.subscribeToLatest(callback);
  }

  subscribeToState(stateKey: string, callback: (state: TState) => void): () => void {
    const subscribers = this.boundSubscribers.get(stateKey) || new Set<(state: TState) => void>();
    subscribers.add(callback);
    this.boundSubscribers.set(stateKey, subscribers);
    const state = this.states[stateKey];
    if (state) callback(state);
    return () => subscribers.delete(callback);
  }

  handleStateEvent(event: StateSnapshotEvent | StateDeltaEvent): void {
    if (event.type === 'STATE_SNAPSHOT') {
      Object.entries(event.snapshot).forEach(([stateKey, state]) => this.setState(stateKey, state as TState));
      return;
    }
    const firstDelta = event.delta[0];
    const stateKey = firstDelta?.path.split('/')[1];
    if (!stateKey || !this.states[stateKey]) return;
    const structure: Record<string, TState> = { [stateKey]: this.states[stateKey] };
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

  private setState(stateKey: string, state: TState): void {
    this.states[stateKey] = state;
    this.currentStateKey = stateKey;
    this.boundSubscribers.get(stateKey)?.forEach((callback) => callback(state));
    this.latestSubscribers.forEach((callback) => callback(state, stateKey));
  }
}

export const stateManager = new StateManagerImpl();
