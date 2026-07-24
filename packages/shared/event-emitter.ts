/**
 * 简单的 EventEmitter 实现，用于浏览器环境
 */
type EventListener<TArgs extends unknown[] = unknown[]> = (...args: TArgs) => void;

export default class SimpleEventEmitter {
  private events: Map<string, EventListener[]> = new Map();

  on<TArgs extends unknown[]>(event: string, listener: EventListener<TArgs>): void {
    if (!this.events.has(event)) {
      this.events.set(event, []);
    }
    this.events.get(event)!.push(listener as EventListener);
  }

  off<TArgs extends unknown[]>(event: string, listener: EventListener<TArgs>): void {
    const listeners = this.events.get(event);
    if (listeners) {
      const index = listeners.indexOf(listener as EventListener);
      if (index !== -1) {
        listeners.splice(index, 1);
      }
    }
  }

  once<TArgs extends unknown[]>(event: string, listener: EventListener<TArgs>): void {
    const wrapper = (...args: TArgs) => {
      this.off(event, wrapper);
      listener(...args);
    };
    this.on(event, wrapper);
  }

  emit<TArgs extends unknown[]>(event: string, ...args: TArgs): boolean {
    const listeners = this.events.get(event);
    if (listeners && listeners.length > 0) {
      listeners.forEach((listener) => {
        try {
          listener(...args);
        } catch (error) {
          console.error('EventEmitter listener error:', error);
        }
      });
      return true;
    }
    return false;
  }

  removeAllListeners(event?: string): void {
    if (event) {
      this.events.delete(event);
    } else {
      this.events.clear();
    }
  }
}
