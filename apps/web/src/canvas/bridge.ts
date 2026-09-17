import type {
  EditorMessage,
  HostMessage,
  InspectResult,
} from "@ultrapaint/contracts/preview";

type Listener = (msg: HostMessage) => void;

/**
 * One bridge per screen iframe. Wraps `postMessage` with request/response correlation and
 * fans host messages out to subscribers (tree, rects, HMR, errors).
 */
export class FrameBridge {
  private iframe: HTMLIFrameElement | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, (msg: HostMessage) => void>();
  private readonly listeners = new Set<Listener>();
  ready = false;
  readonly screenId: string;

  constructor(screenId: string) {
    this.screenId = screenId;
  }

  attach(iframe: HTMLIFrameElement) {
    this.iframe = iframe;
    this.ready = false;
  }

  detach() {
    this.iframe = null;
    this.ready = false;
  }

  /** Called by the global message router for messages from this bridge's window. */
  matches(source: MessageEventSource | null) {
    return !!this.iframe && this.iframe.contentWindow === source;
  }

  handle(msg: HostMessage) {
    if (msg.type === "ed:ready") {
      this.ready = true;
    }
    if ("requestId" in msg) {
      const cb = this.pending.get(msg.requestId);
      if (cb) {
        this.pending.delete(msg.requestId);
        cb(msg);
      }
    }
    for (const l of this.listeners) {
      l(msg);
    }
  }

  on(listener: Listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  send(msg: EditorMessage) {
    this.iframe?.contentWindow?.postMessage(msg, "*");
  }

  private request<T extends HostMessage>(
    build: (requestId: number) => EditorMessage,
    timeoutMs = 4000
  ): Promise<T | null> {
    const requestId = this.nextId;
    this.nextId += 1;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        resolve(null);
      }, timeoutMs);
      this.pending.set(requestId, (msg) => {
        clearTimeout(timer);
        resolve(msg as T);
      });
      this.send(build(requestId));
    });
  }

  /** The nodes under the point, outermost first; empty when the point is on nothing. */
  async hitTest(x: number, y: number): Promise<readonly string[]> {
    const r = await this.request<Extract<HostMessage, { type: "ed:hit" }>>(
      (requestId) => ({
        requestId,
        type: "ed:hitTest",
        x,
        y,
      })
    );
    return r?.nodeIds ?? [];
  }

  async inspect(nodeId: string): Promise<InspectResult | null> {
    const r = await this.request<Extract<HostMessage, { type: "ed:inspect" }>>(
      (requestId) => ({
        nodeId,
        requestId,
        type: "ed:inspect",
      })
    );
    return r?.result ?? null;
  }

  async screenshot(): Promise<string | null> {
    const r = await this.request<
      Extract<HostMessage, { type: "ed:screenshot" }>
    >((requestId) => ({ requestId, type: "ed:screenshot" }), 15_000);
    return r?.dataUrl ?? null;
  }

  requestTree() {
    this.send({ type: "ed:getTree" });
  }

  watchRects(nodeIds: string[]) {
    this.send({ nodeIds, type: "ed:watchRects" });
  }

  editText(nodeId: string) {
    this.send({ nodeId, type: "ed:editText" });
  }

  /** Whether the screen may respond to input at all: true only in interact mode. */
  setInteractive(interactive: boolean) {
    this.send({ interactive, type: "ed:setInteractive" });
  }

  requestTokens() {
    this.send({ type: "ed:getTokens" });
  }
}

const bridges = new Map<string, FrameBridge>();

export const bridgeFor = (screenId: string): FrameBridge => {
  let b = bridges.get(screenId);
  if (!b) {
    b = new FrameBridge(screenId);
    bridges.set(screenId, b);
  }
  return b;
};

export const removeBridge = (screenId: string) => {
  bridges.get(screenId)?.detach();
  bridges.delete(screenId);
};

let routerInstalled = false;
export const installBridgeRouter = () => {
  if (routerInstalled) {
    return;
  }
  routerInstalled = true;
  window.addEventListener("message", (ev) => {
    const data = ev.data as (HostMessage & { screen?: string }) | undefined;
    if (
      !data ||
      typeof data.type !== "string" ||
      !data.type.startsWith("ed:")
    ) {
      return;
    }
    // Prefer the screen id the runtime stamps on every message; fall back to window identity.
    const byScreen =
      typeof data.screen === "string" ? bridges.get(data.screen) : undefined;
    if (byScreen) {
      byScreen.handle(data);
      return;
    }
    for (const b of bridges.values()) {
      if (b.matches(ev.source)) {
        b.handle(data);
        return;
      }
    }
  });
};
