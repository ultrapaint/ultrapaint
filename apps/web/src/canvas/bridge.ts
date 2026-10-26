import type { DesignSystem } from "@ultrapaint/contracts/design-system";
import type { DesignNode } from "@ultrapaint/contracts/document";
import type {
  HostMessage,
  Rect,
  RenderMode,
} from "@ultrapaint/contracts/preview";
import type {
  FrameEvents,
  FrameRuntime,
} from "@ultrapaint/framework-api/browser";

import type { DesignLook } from "../state/look.ts";

type Listener = (msg: HostMessage) => void;

/**
 * Where the design's look comes from when a render does not say: the app hands it the stores'
 * at startup, which keeps the bridge free of them.
 */
const NO_LOOK: DesignLook = { specs: [], styles: "" };
let currentLook = (): DesignLook => NO_LOOK;
export const provideDesignLook = (look: () => DesignLook) => {
  currentLook = look;
};

let renders = 0;

/** What a frame is told to draw. */
export interface RenderRequest {
  readonly designSystem: DesignSystem | null;
  /** The design's look over the code's (ADR 0028, 0029); the current one when left out. */
  readonly look?: DesignLook;
  readonly message?: string;
  readonly mode: RenderMode;
  readonly root: DesignNode | null;
}

/**
 * One bridge per frame drawn in the editor's page (ADR 0034): a frame on the canvas, the
 * prototype, a specimen. What it is asked it asks the frame directly, which answers at once;
 * what the frame says is fanned out to subscribers as messages (rects, sizes, HMR, errors,
 * navigation). It outlives the frame it speaks to: what it was asked to keep watching is told
 * again to the next one.
 */
export class FrameBridge {
  private runtime: FrameRuntime | null = null;
  /** What the frame was last told to draw. */
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
  private readonly listeners = new Set<Listener>();
  /** What the frame is to keep up to date, told again to a frame attached later. */
  private watched: readonly string[] = [];
  private skeletons: readonly string[] = [];
  /** A frame is attached and answers. */
  ready: boolean;
  /** The last render the frame said it drew; what it is told again it does not draw again. */
  renderedId = 0;
  readonly frameId: string;

  constructor(frameId: string) {
    this.frameId = frameId;
    this.ready = false;
  }

  /** The frame this bridge speaks to from now on. */
  attachRuntime(runtime: FrameRuntime) {
    if (runtime === this.runtime) {
      return;
    }
    this.runtime = runtime;
    this.ready = true;
    if (this.watched.length > 0) {
      runtime.watchRects(this.watched);
    }
    if (this.skeletons.length > 0) {
      runtime.skeleton(this.skeletons);
    }
  }

  detach() {
    this.runtime = null;
    this.ready = false;
  }

  /**
   * Tells the subscribers the frame is ready to be told what to draw: it is before anyone
   * listens, and again whenever its frame takes it back from the pool.
   */
  announce() {
    if (this.runtime) {
      this.handle({ frame: this.frameId, type: "ed:ready" });
    }
  }

  /** What the frame tells its bridge, handed on as messages. */
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

  handle(msg: HostMessage) {
    // What `pnpm bench:canvas` times frames by.
    if (import.meta.env.DEV && typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("ed:frame", {
          detail: { frame: this.frameId, type: msg.type },
        })
      );
    }
    if (msg.type === "ed:rendered") {
      this.renderedId = Math.max(this.renderedId, msg.renderId);
    }
    for (const l of this.listeners) {
      l(msg);
    }
  }

  on(listener: Listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** The nodes under the point, outermost first; empty when the point is on nothing. */
  hitTest(x: number, y: number): Promise<readonly string[]> {
    return Promise.resolve(this.runtime?.hitTest(x, y) ?? []);
  }

  /** Where these nodes are right now, in the page's own coordinates. */
  measure(nodeIds: readonly string[]): Promise<Record<string, Rect>> {
    return Promise.resolve({ ...this.runtime?.measure(nodeIds) });
  }

  /**
   * Tells the frame what to draw; answers the id its `ed:rendered` carries. What it shows
   * already it is not told again: a frame taken back from the pool is not drawn for nothing.
   */
  render(request: RenderRequest): number {
    const look = request.look ?? currentLook();
    const { drawn, runtime } = this;
    if (
      runtime !== null &&
      drawn !== null &&
      drawn.runtime === runtime &&
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
    if (!runtime) {
      this.drawn = null;
      return renders;
    }
    this.drawn = {
      designSystem: request.designSystem,
      message: request.message,
      mode: request.mode,
      renderId: renders,
      root: request.root,
      runtime,
      specs: look.specs,
      styles: look.styles,
    };
    runtime.render({
      designSystem: request.designSystem,
      mode: request.mode,
      renderId: renders,
      root: request.root,
      ...(look.specs.length > 0 && { specs: look.specs }),
      ...(look.styles && { styles: look.styles }),
      ...(request.message !== undefined && { message: request.message }),
    });
    return renders;
  }

  /** The CSS variables the frame's stylesheets define, resolved in its theme. */
  tokens(prefixes?: readonly string[]): Promise<Record<string, string>> {
    return Promise.resolve({ ...this.runtime?.tokens(prefixes) });
  }

  /** A PNG of what the frame draws, or of one node of it in place. */
  screenshot(nodeId?: string): Promise<string | null> {
    return this.runtime?.screenshot(nodeId) ?? Promise.resolve(null);
  }

  watchRects(nodeIds: readonly string[]) {
    this.watched = nodeIds;
    this.runtime?.watchRects(nodeIds);
  }

  /** Nodes an agent is rewriting, drawn as placeholders until it is done. */
  skeleton(nodeIds: readonly string[]) {
    this.skeletons = [...nodeIds];
    this.runtime?.skeleton(this.skeletons);
  }

  editText(nodeId: string) {
    this.runtime?.editText(nodeId);
  }

  /** Whether the page may respond to input at all: in the prototype and in interact mode. */
  setInteractive(interactive: boolean) {
    this.runtime?.setInteractive(interactive);
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
