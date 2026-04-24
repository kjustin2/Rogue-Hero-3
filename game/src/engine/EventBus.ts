type Handler<T = unknown> = (payload: T) => void;

class EventBus {
  private listeners = new Map<string, Set<Handler<any>>>();

  on<T = unknown>(event: string, handler: Handler<T>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(handler);
    return () => set!.delete(handler);
  }

  off<T = unknown>(event: string, handler: Handler<T>): void {
    this.listeners.get(event)?.delete(handler);
  }

  emit<T = unknown>(event: string, payload?: T): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const h of set) h(payload);
  }

  clear(): void {
    this.listeners.clear();
  }
}

export const events = new EventBus();
