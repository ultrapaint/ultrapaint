import type { DesignSystem } from "@ultrapaint/contracts/design-system";
import type { DesignNode } from "@ultrapaint/contracts/document";
import type {
  EditorMessage,
  HostMessage,
  Rect,
  RenderMode,
} from "@ultrapaint/contracts/preview";
import type {
  FrameEvents,
  FrameRuntime,
} from "@ultrapaint/framework-api/browser";
import { PREVIEW_PROTOCOL } from "@ultrapaint/framework-api/protocol";

import type { DesignLook } from "../state/look.ts";

type Listener = (msg: HostMessage) => void;

/**
 * Where the design's look comes from when a render does not say: the app hands it the stores'
 * at startup, which keeps the bridge free of them.
 */
let currentLook = (): DesignLook => ({ specs: [], styles: "" });
export const provideDesignLook = (look: () => DesignLook) => {
  currentLook = look;
};

let renders = 0;

/** What a preview was last told to draw, so a preview that reloads is told again. */
export interface RenderRequest {
  readonly designSystem: DesignSystem | null;
  /** The design's look over the code's (ADR 0028, 0029); the current one when left out. */
  readonly look?: DesignLook;
  readonly message?: string;
  readonly mode: RenderMode;
  readonly root: DesignNode | null;
}

/**
 * One bridge per preview: a frame on the canvas, the prototype, a specimen. A frame drawn in the
 * editor's own page (ADR 0034) is called directly and answers at once; an iframe is spoken to
 * over `postMessage`, with request/response correlation. Either way what the preview says is
 * fanned out to subscribers as messages (rects, sizes, HMR, errors, navigation).
 */
export class FrameBridge {
  private iframe: HTMLIFrameElement | null = null;
  private runtime: FrameRuntime | null = null;
  /** What a frame in the editor's page was last told to draw. */
  private drawn: {
    readonly designSystem: DesignSystem | null;
    readonly message: string | undefined;
    readonly mode: RenderMode;
    readonly renderId: number;
    readonly root: DesignNode | null;
    readonly runtime: FrameRuntime;
    readonly specs: DesignLook["specs"];
    readonly styles: DesignLook["styles"];
  } | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, (msg: HostMessage) => void>();
  private readonly listeners = new Set<Listener>();
  /**
   * What the preview is to keep up to date, told again whenever it (re)loads: a message sent
   * before it answers is lost, and a frame's preview loads after the frame is on the canvas.
   */
  private watched: string[] = [];
  private skeletons: string[] = [];
  /**
   * The origin the preview said it was ready from. Its address is no guide: the user's app may
   * redirect elsewhere (127.0.0.1 to localhost), and the preview then speaks from there.
   */
  private spoke: string | null = null;
  /** The preview has loaded and answers. */
  ready: boolean;
  readonly frameId: string;

  constructor(frameId: string) {
    this.frameId = frameId;
    this.ready = false;
  }

  attach(iframe: HTMLIFrameElement) {
    // A preview kept loaded while its frame was away comes back as it was: ready, and speaking
    // from where it did.
    if (iframe === this.iframe) {
      return;
    }
    this.iframe = iframe;
    this.runtime = null;
    this.ready = false;
    this.spoke = null;
  }

  /** A frame drawn in the editor's page: ready at once, and called directly. */
  attachRuntime(runtime: FrameRuntime) {
    if (runtime === this.runtime) {
      return;
    }
    this.iframe = null;
    this.runtime = runtime;
    this.ready = true;
    this.spoke = null;
    this.resend();
  }

  detach() {
    this.iframe = null;
    this.runtime = null;
    this.ready = false;
    this.spoke = null;
  }

  /**
   * Tells the subscribers the frame is ready, as an iframe says once it has loaded: a frame drawn
   * in the editor's page is ready before anyone listens, and again whenever its frame takes it
   * back from the pool.
   */
  announce() {
    if (this.runtime) {
      this.handle({
        frame: this.frameId,
        protocol: PREVIEW_PROTOCOL,
        type: "ed:ready",
      });
    }
  }

  /** What the frame tells its bridge, as the messages an iframe would post. */
  events(): FrameEvents {
    return {
      error: (error) => this.handle({ error, type: "ed:error" }),
      hmr: () => this.handle({ type: "ed:hmr" }),
      instances: (instances) =>
        this.handle({ instances, type: "ed:instances" }),
      navigateTo: (route, replace) =>
        this.handle({ replace, route, type: "ed:navigateTo" }),
      pressed: (nodeIds) => this.handle({ nodeIds, type: "ed:pressed" }),
      rects: (rects) => this.handle({ rects, type: "ed:rects" }),
      rendered: (renderId) => this.handle({ renderId, type: "ed:rendered" }),
      size: ({ height, width }) =>
        this.handle({ height, type: "ed:size", width }),
      textCommit: (nodeId, text) =>
        this.handle({ nodeId, text, type: "ed:textCommit" }),
    };
  }

  /** What the preview keeps up to date, told again: it was asked before it could hear. */
  private resend() {
    if (this.watched.length > 0) {
      this.send({ nodeIds: this.watched, type: "ed:watchRects" });
    }
    if (this.skeletons.length > 0) {
      this.send({ nodeIds: this.skeletons, type: "ed:skeleton" });
    }
  }

  /** Where the preview's address says it is loaded from, before it has said anything. */
  private srcOrigin(): string | null {
    const src = this.iframe?.src ?? "";
    if (!URL.canParse(src)) {
      return null;
    }
    const { origin } = new URL(src);
    return origin === "null" ? null : origin;
  }

  /**
   * Whether a message is this bridge's preview speaking: sent by its iframe's window and, once
   * the preview has said it is ready, from the origin it said so from. Any other page in the
   * browser can post to the editor too, and the iframe may be navigated to another site.
   */
  accepts(ev: Pick<MessageEvent, "data" | "origin" | "source">) {
    if (!this.iframe || this.iframe.contentWindow !== ev.source) {
      return false;
    }
    if (this.spoke !== null) {
      return this.spoke === ev.origin;
    }
    const data = ev.data as { type?: unknown } | null | undefined;
    if (data?.type === "ed:ready" && ev.origin !== "" && ev.origin !== "null") {
      this.spoke = ev.origin;
    }
    return true;
  }

  handle(msg: HostMessage) {
    // What `pnpm bench:canvas` times frames by, as it heard iframes' messages.
    if (this.runtime && import.meta.env.DEV && typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("ed:frame", {
          detail: { frame: this.frameId, type: msg.type },
        })
      );
    }
    if (msg.type === "ed:ready" && !this.runtime) {
      this.ready = true;
      this.resend();
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
    if (this.runtime) {
      this.call(this.runtime, msg);
      return;
    }
    this.iframe?.contentWindow?.postMessage(
      msg,
      this.spoke ?? this.srcOrigin() ?? "*"
    );
  }

  /** A message, as a call on a frame drawn in the editor's page; an answer comes at once. */
  private call(runtime: FrameRuntime, msg: EditorMessage) {
    switch (msg.type) {
      case "ed:render": {
        const { type: _type, ...request } = msg;
        runtime.render(request);
        break;
      }
      case "ed:hitTest":
        this.handle({
          nodeIds: runtime.hitTest(msg.x, msg.y),
          requestId: msg.requestId,
          type: "ed:hit",
        });
        break;
      case "ed:watchRects":
        runtime.watchRects(msg.nodeIds);
        break;
      case "ed:skeleton":
        runtime.skeleton(msg.nodeIds);
        break;
      case "ed:measure":
        this.handle({
          rects: runtime.measure(msg.nodeIds),
          requestId: msg.requestId,
          type: "ed:measured",
        });
        break;
      case "ed:editText":
        runtime.editText(msg.nodeId);
        break;
      case "ed:setInteractive":
        runtime.setInteractive(msg.interactive);
        break;
      case "ed:screenshot":
        runtime.screenshot(msg.nodeId).then((dataUrl) =>
          this.handle({
            dataUrl,
            requestId: msg.requestId,
            type: "ed:screenshot",
          })
        );
        break;
      case "ed:getTokens":
        this.handle({
          requestId: msg.requestId,
          tokens: runtime.tokens(msg.prefixes),
          type: "ed:tokens",
        });
        break;
      case "ed:scrollIntoView":
        runtime.scrollIntoView(msg.nodeId);
        break;
      default:
        break;
    }
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
    const look = request.look ?? currentLook();
    // A frame drawn in the editor's page still shows what it was last told to draw: a frame
    // taken back from the pool is not drawn again for nothing, on the editor's own thread.
    const { drawn } = this;
    if (
      this.runtime &&
      drawn !== null &&
      drawn.runtime === this.runtime &&
      drawn.designSystem === request.designSystem &&
      drawn.root === request.root &&
      drawn.mode === request.mode &&
      drawn.message === request.message &&
      drawn.specs === look.specs &&
      drawn.styles === look.styles
    ) {
      return drawn.renderId;
    }
    renders += 1;
    this.drawn = this.runtime
      ? {
          designSystem: request.designSystem,
          message: request.message,
          mode: request.mode,
          renderId: renders,
          root: request.root,
          runtime: this.runtime,
          specs: look.specs,
          styles: look.styles,
        }
      : null;
    this.send({
      designSystem: request.designSystem,
      mode: request.mode,
      renderId: renders,
      root: request.root,
      ...(look.specs.length > 0 && { specs: look.specs }),
      ...(look.styles && { styles: look.styles }),
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
