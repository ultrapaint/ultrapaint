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
} from "@ultrapaint/contracts/ipc";
import { Result, Schema as S } from "effect";

export type ConnectionState = "connecting" | "open" | "closed";

export class RequestError extends Error {
  readonly code: WireError["code"];

  constructor(code: WireError["code"], message: string) {
    super(message);
    this.code = code;
    this.name = "RequestError";
  }
}

interface Pending {
  method: string;
  reject: (e: unknown) => void;
  resolve: (v: unknown) => void;
}
type Listener<E extends EventName> = (payload: EventPayload<E>) => void;

export interface ConnectionOptions {
  onState?: (state: ConnectionState) => void;
  url: string;
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
  private readonly pending = new Map<number, Pending>();
  private readonly listeners = new Map<EventName, Set<Listener<EventName>>>();
  private closed: boolean;
  private backoff = 250;
  state: ConnectionState = "connecting";
  private readonly options: ConnectionOptions;

  constructor(options: ConnectionOptions) {
    this.options = options;
    this.closed = false;
    this.connect();
  }

  private setState(state: ConnectionState) {
    this.state = state;
    this.options.onState?.(state);
  }

  private connect() {
    if (this.closed) {
      return;
    }
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
        p.reject(
          new RequestError("internal", `connection lost during ${p.method}`)
        );
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
    if (Result.isFailure(frame)) {
      return;
    }
    const f = frame.success;
    if ("event" in f) {
      const name = f.event as EventName;
      const schema = events[name];
      if (!schema) {
        return;
      }
      const payload = S.decodeUnknownResult(schema as S.Codec<unknown>)(
        f.payload
      );
      if (Result.isFailure(payload)) {
        console.warn(
          `[ultrapaint] bad event payload for ${name}`,
          payload.failure.message
        );
        return;
      }
      for (const l of this.listeners.get(name) ?? []) {
        l(payload.success as never);
      }
      return;
    }
    const p = this.pending.get(f.id);
    if (!p) {
      return;
    }
    this.pending.delete(f.id);
    if (f.ok) {
      p.resolve(f.output);
    } else {
      p.reject(new RequestError(f.error.code, f.error.message));
    }
  }

  async request<M extends RequestName>(
    method: M,
    input: RequestInput<M>
  ): Promise<RequestOutput<M>> {
    const { ws } = this;
    if (!ws || ws.readyState !== ws.OPEN) {
      throw new RequestError("internal", "not connected");
    }
    const id = this.nextId;
    this.nextId += 1;
    const encodedInput = S.encodeUnknownSync(
      requests[method].input as S.Codec<unknown>
    )(input);
    const raw = await new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { method, reject, resolve });
      ws.send(JSON.stringify({ id, input: encodedInput, method }));
    });
    const decoded = S.decodeUnknownResult(
      requests[method].output as S.Codec<unknown>
    )(raw);
    if (Result.isFailure(decoded)) {
      throw new RequestError(
        "internal",
        `bad response for ${method}: ${decoded.failure.message}`
      );
    }
    return decoded.success as RequestOutput<M>;
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
