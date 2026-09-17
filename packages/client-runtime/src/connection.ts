import {
  decodeServerFrame,
  type EventName,
  type EventPayload,
  events,
  type RequestInput,
  type RequestName,
  type RequestOutput,
  requests,
  type WireError,
} from "@ultrapaint/contracts";
import * as S from "effect/Schema";

export type ConnectionState = "connecting" | "open" | "closed";

export class RequestError extends Error {
  constructor(
    readonly code: WireError["code"],
    message: string,
  ) {
    super(message);
    this.name = "RequestError";
  }
}

type Pending = { resolve: (v: unknown) => void; reject: (e: unknown) => void; method: string };
type Listener<E extends EventName> = (payload: EventPayload<E>) => void;

export interface ConnectionOptions {
  url: string;
  onState?: (state: ConnectionState) => void;
  WebSocketImpl?: typeof WebSocket;
}

/**
 * Typed WebSocket client. `request` resolves with the decoded output of the named request;
 * `on` subscribes to a server event. Reconnects with backoff and fails in-flight requests
 * when the socket drops.
 */
export class Connection {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private listeners = new Map<EventName, Set<Listener<EventName>>>();
  private closed = false;
  private backoff = 250;
  state: ConnectionState = "connecting";

  constructor(private readonly options: ConnectionOptions) {
    this.connect();
  }

  private setState(state: ConnectionState) {
    this.state = state;
    this.options.onState?.(state);
  }

  private connect() {
    if (this.closed) return;
    const Impl = this.options.WebSocketImpl ?? WebSocket;
    const ws = new Impl(this.options.url);
    this.ws = ws;
    this.setState("connecting");
    ws.onopen = () => {
      this.backoff = 250;
      this.setState("open");
    };
    ws.onmessage = (ev) => this.handle(String(ev.data));
    ws.onclose = () => {
      this.setState("closed");
      for (const [id, p] of this.pending) {
        p.reject(new RequestError("internal", `connection lost during ${p.method}`));
        this.pending.delete(id);
      }
      if (!this.closed) {
        setTimeout(() => this.connect(), this.backoff);
        this.backoff = Math.min(this.backoff * 2, 5000);
      }
    };
    ws.onerror = () => {
      /* onclose follows */
    };
  }

  private handle(raw: string) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    const frame = decodeServerFrame(parsed);
    if (frame._tag === "Left") return;
    const f = frame.right;
    if ("event" in f) {
      const name = f.event as EventName;
      const schema = events[name];
      if (!schema) return;
      const payload = S.decodeUnknownEither(schema as S.Schema<unknown>)(f.payload);
      if (payload._tag === "Left") {
        console.warn(`[ultrapaint] bad event payload for ${name}`, payload.left.message);
        return;
      }
      for (const l of this.listeners.get(name) ?? []) l(payload.right as never);
      return;
    }
    const p = this.pending.get(f.id);
    if (!p) return;
    this.pending.delete(f.id);
    if (f.ok) p.resolve(f.output);
    else p.reject(new RequestError(f.error.code, f.error.message));
  }

  async request<M extends RequestName>(
    method: M,
    input: RequestInput<M>,
  ): Promise<RequestOutput<M>> {
    const ws = this.ws;
    if (!ws || ws.readyState !== ws.OPEN) {
      throw new RequestError("internal", "not connected");
    }
    const id = this.nextId++;
    const encodedInput = S.encodeUnknownSync(requests[method].input as S.Schema<unknown>)(input);
    const raw = await new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      ws.send(JSON.stringify({ id, method, input: encodedInput }));
    });
    const decoded = S.decodeUnknownEither(requests[method].output as S.Schema<unknown>)(raw);
    if (decoded._tag === "Left") {
      throw new RequestError("internal", `bad response for ${method}: ${decoded.left.message}`);
    }
    return decoded.right as RequestOutput<M>;
  }

  on<E extends EventName>(event: E, listener: Listener<E>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener as Listener<EventName>);
    return () => set?.delete(listener as Listener<EventName>);
  }

  close() {
    this.closed = true;
    this.ws?.close();
  }
}

export const defaultServerUrl = (): string => {
  const loc = window.location;
  const proto = loc.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${loc.host}/ws`;
};
