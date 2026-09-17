import type { EventName, EventPayload } from "@ultrapaint/contracts/ipc";

type Subscriber = (event: EventName, payload: unknown) => void;

/** In-process event bus; the WebSocket layer fans events out to clients. */
export class EventBus {
  private readonly subscribers = new Set<Subscriber>();

  emit<E extends EventName>(event: E, payload: EventPayload<E>) {
    for (const s of this.subscribers) {
      s(event, payload);
    }
  }

  subscribe(s: Subscriber): () => void {
    this.subscribers.add(s);
    return () => this.subscribers.delete(s);
  }
}
