import type { DesignSystem } from "@ultrapaint/contracts/design-system";
import type { DesignNode } from "@ultrapaint/contracts/document";
import type {
  EditorMessage,
  HostMessage,
  Rect,
  RenderMode,
} from "@ultrapaint/contracts/preview";

type Listener = (msg: HostMessage) => void;

let renders = 0;

/** What a preview was last told to draw, so a preview that reloads is told again. */
export interface RenderRequest {
  readonly designSystem: DesignSystem | null;
  readonly message?: string;
  readonly mode: RenderMode;
  readonly root: DesignNode | null;
}

/**
 * One bridge per preview iframe: a frame on the canvas, the prototype, a specimen. Wraps
 * `postMessage` with request/response correlation and fans host messages out to subscribers
 * (rects, sizes, HMR, errors, navigation).
 */
export class FrameBridge {
  private iframe: HTMLIFrameElement | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, (msg: HostMessage) => void>();
  private readonly listeners = new Set<Listener>();
  /**
   * What the preview is to keep up to date, told again whenever it (re)loads: a message sent
   * before it answers is lost, and a frame's preview loads after the frame is on the canvas.
   */
  private watched: string[] = [];
  private skeletons: string[] = [];
  /** The preview has loaded and answers. */
  ready: boolean;
  readonly frameId: string;

  constructor(frameId: string) {
    this.frameId = frameId;
    this.ready = false;
  }

  attach(iframe: HTMLIFrameElement) {
    this.iframe = iframe;
    this.ready = false;
  }

  detach() {
    this.iframe = null;
    this.ready = false;
  }

  /**
   * Where the preview is loaded from, when its address says: messages are taken only from there,
   * and sent only there.
   */
  private origin(): string | null {
    const src = this.iframe?.src ?? "";
    if (!URL.canParse(src)) {
      return null;
    }
    const { origin } = new URL(src);
    return origin === "null" ? null : origin;
  }

  /**
   * Whether a message is this bridge's preview speaking: sent by its iframe's window, from the
   * preview's origin. Any other page in the browser can post to the editor too.
   */
  accepts(ev: Pick<MessageEvent, "origin" | "source">) {
    if (!this.iframe || this.iframe.contentWindow !== ev.source) {
      return false;
    }
    const origin = this.origin();
    return origin === null || origin === ev.origin;
  }

  handle(msg: HostMessage) {
    if (msg.type === "ed:ready") {
      this.ready = true;
      if (this.watched.length > 0) {
        this.send({ nodeIds: this.watched, type: "ed:watchRects" });
      }
      if (this.skeletons.length > 0) {
        this.send({ nodeIds: this.skeletons, type: "ed:skeleton" });
      }
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
    this.iframe?.contentWindow?.postMessage(msg, this.origin() ?? "*");
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

  /** Where these nodes are right now, in the page's own coordinates. */
  async measure(nodeIds: readonly string[]): Promise<Record<string, Rect>> {
    const r = await this.request<Extract<HostMessage, { type: "ed:measured" }>>(
      (requestId) => ({
        nodeIds,
        requestId,
        type: "ed:measure",
      })
    );
    return r?.rects ?? {};
  }

  /** Tells the preview what to draw; answers the id its `ed:rendered` will carry. */
  render(request: RenderRequest): number {
    renders += 1;
    this.send({
      designSystem: request.designSystem,
      mode: request.mode,
      renderId: renders,
      root: request.root,
      type: "ed:render",
      ...(request.message !== undefined && { message: request.message }),
    });
    return renders;
  }

  /** The CSS variables the preview's stylesheets define, resolved in its theme. */
  async tokens(prefixes?: readonly string[]): Promise<Record<string, string>> {
    const r = await this.request<Extract<HostMessage, { type: "ed:tokens" }>>(
      (requestId) => ({
        requestId,
        type: "ed:getTokens",
        ...(prefixes && { prefixes }),
      })
    );
    return r?.tokens ?? {};
  }

  /** A PNG of what the preview draws, or of one node of it in place. */
  async screenshot(nodeId?: string): Promise<string | null> {
    const r = await this.request<
      Extract<HostMessage, { type: "ed:screenshot" }>
    >(
      (requestId) => ({
        requestId,
        type: "ed:screenshot",
        ...(nodeId !== undefined && { nodeId }),
      }),
      15_000
    );
    return r?.dataUrl ?? null;
  }

  watchRects(nodeIds: string[]) {
    this.watched = nodeIds;
    this.send({ nodeIds, type: "ed:watchRects" });
  }

  /** Nodes an agent is rewriting, drawn as placeholders until it is done. */
  skeleton(nodeIds: readonly string[]) {
    this.skeletons = [...nodeIds];
    this.send({ nodeIds: this.skeletons, type: "ed:skeleton" });
  }

  editText(nodeId: string) {
    this.send({ nodeId, type: "ed:editText" });
  }

  /** Whether the page may respond to input at all: true only in interact mode. */
  setInteractive(interactive: boolean) {
    this.send({ interactive, type: "ed:setInteractive" });
  }
}

const bridges = new Map<string, FrameBridge>();

export const bridgeFor = (frameId: string): FrameBridge => {
  let b = bridges.get(frameId);
  if (!b) {
    b = new FrameBridge(frameId);
    bridges.set(frameId, b);
  }
  return b;
};

export const removeBridge = (frameId: string) => {
  bridges.get(frameId)?.detach();
  bridges.delete(frameId);
};

let routerInstalled = false;
export const installBridgeRouter = () => {
  if (routerInstalled) {
    return;
  }
  routerInstalled = true;
  window.addEventListener("message", (ev) => {
    const data = ev.data as (HostMessage & { frame?: string }) | undefined;
    if (
      !data ||
      typeof data.type !== "string" ||
      !data.type.startsWith("ed:")
    ) {
      return;
    }
    // The frame id the runtime stamps on every message finds the bridge at once; the window
    // it came from is what says the message is that preview's.
    const byFrame =
      typeof data.frame === "string" ? bridges.get(data.frame) : undefined;
    if (byFrame?.accepts(ev)) {
      byFrame.handle(data);
      return;
    }
    for (const b of bridges.values()) {
      if (b.accepts(ev)) {
        b.handle(data);
        return;
      }
    }
  });
};
