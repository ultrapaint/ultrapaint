/**
 * What a renderer gives the preview, in the editor's page (ADR 0034, 0040). The preview core knows
 * the DOM and nothing about React; drawing a design document is the renderer's, the way
 * Storybook's preview only knows a renderer's `renderToCanvas`. Both are the editor's own: the
 * frames draw the editor's system components, and nothing of the repository's runs in them.
 */
import type { DesignSystem } from "@ultrapaint/contracts/design-system";
import type { DesignNode } from "@ultrapaint/contracts/document";
import type { PageDefaults } from "@ultrapaint/contracts/pages";
import type { InstanceDrawn, RenderMode } from "@ultrapaint/contracts/preview";
import type { ComponentSpec } from "@ultrapaint/contracts/specs";

/** Attribute the renderer writes on every node it draws: the node's id in the document. */
export const NODE_ATTRIBUTE = "data-ed-node";

/** The selector for the elements drawn for a node. */
export const nodeSelector = (id: string) =>
  `[${NODE_ATTRIBUTE}="${CSS.escape(id)}"]`;

/**
 * What the core hands a renderer once, when it mounts it in a frame of the editor's page (ADR
 * 0034): the one host there is, so every field is given.
 */
export interface RenderSetup {
  /** URL of an image a node shows: a path inside the canvas, or a URL as it is. */
  readonly assetUrl: (src: string) => string;
  /**
   * The frame the render draws in (ADR 0040): its body, where the system components' popups go, its
   * host, and whether it runs (the prototype, interact mode) or is designed.
   */
  readonly frame: RenderFrame;
  /** A node with a link was pressed. */
  readonly navigate: (route: string) => void;
  /** A render reached the screen. */
  readonly onRendered: (renderId: number) => void;
  /** The height a page fills at least: its frame's (`100cqh`), as a page fills its window. */
  readonly pageHeight: string;
  /** Reports a render error to the editor: the page's. */
  readonly reportError: (error: Pick<PageError, "message" | "stack">) => void;
  /** How instances were drawn, by node id: the ones that changed since the last report. */
  readonly reportInstances: (
    instances: Readonly<Record<string, InstanceDrawn>>
  ) => void;
  /** The design's own stylesheet (ADR 0028, 0029), which the core keeps for every frame. */
  readonly setDesignCss: (css: string) => void;
}

/** The frame a render draws in, as its renderer sees it. */
export interface RenderFrame {
  /** The frame's body element: what a popup is portalled into, so it stays in its frame. */
  readonly container: HTMLElement;
  /** The frame's host: an event from inside the frame has it on its path. */
  readonly host: HTMLElement;
  /** Whether the frame runs, taking input: the prototype, interact mode. */
  readonly interactive: () => boolean;
  /** Hears when it starts or stops running. */
  readonly onInteractive: (listener: () => void) => () => void;
}

/**
 * What went wrong drawing a frame's page: a system component or the renderer threw. The editor keeps a
 * frame's latest one until the frame draws again (`editor-frame.ts`).
 */
export interface PageError {
  readonly message: string;
  readonly source: "page";
  readonly stack?: string | undefined;
}

/** One thing to draw. */
export interface RenderRequest {
  /** What the canvas draws every page in: its theme, its fill and its type. */
  readonly defaults?: PageDefaults | undefined;
  readonly designSystem: DesignSystem | null;
  /** Shown instead of a node. */
  readonly message?: string | undefined;
  readonly mode: RenderMode;
  readonly renderId: number;
  readonly root: DesignNode | null;
  /** The component specs (ADR 0029): drawn over their components, drafts in their instances' place. */
  readonly specs?: readonly ComponentSpec[] | undefined;
  /** The design's own stylesheet: every token's value, in every theme (ADR 0028, 0040). */
  readonly styles?: string | undefined;
}

/** A mounted canvas, drawn again on request. */
export interface Mounted {
  readonly render: (request: RenderRequest) => void;
  readonly unmount: () => void;
}

export type RenderToCanvas = (
  setup: RenderSetup,
  canvas: HTMLElement
) => Mounted;

/** A box in a frame's own coordinates: the page's pixels, whatever the canvas's zoom. */
export interface FrameRect {
  readonly height: number;
  readonly width: number;
  readonly x: number;
  readonly y: number;
}

/** What a frame tells the editor (ADR 0034): called directly, in the editor's own page. */
export interface FrameEvents {
  readonly error?: (error: PageError) => void;
  /** How instances were drawn, by node id: the ones that changed since the last call. */
  readonly instances?: (
    instances: Readonly<Record<string, InstanceDrawn>>
  ) => void;
  /** A node with a link was pressed; the frame does not move. */
  readonly navigateTo?: (route: string, replace: boolean) => void;
  /** A click while the frame takes input: the nodes under it, outermost first. */
  readonly pressed?: (nodeIds: readonly string[]) => void;
  /** Where the watched nodes are, whenever any of them moved. */
  readonly rects?: (rects: Readonly<Record<string, FrameRect>>) => void;
  /** A render reached the screen; `renderId` is the one `render` was given. */
  readonly rendered?: (renderId: number) => void;
  /** The drawn size of what a `fit` render shows, whenever it changes. */
  readonly size?: (size: {
    readonly height: number;
    readonly width: number;
  }) => void;
  /** An inline text edit was committed. */
  readonly textCommit?: (nodeId: string, text: string) => void;
}

/** One frame, drawn in a shadow root of the editor's page (ADR 0034). */
export interface FrameRuntime {
  /** Measures and hit tests read the DOM as it is: no message, no wait. */
  readonly editText: (nodeId: string) => void;
  /** The nodes under a point of the frame, outermost first; empty on nothing. */
  readonly hitTest: (x: number, y: number) => readonly string[];
  /** Where these nodes are; a node that renders nothing is left out. */
  readonly measure: (
    nodeIds: readonly string[]
  ) => Readonly<Record<string, FrameRect>>;
  readonly render: (request: RenderRequest) => void;
  /** A PNG of what the frame draws, or of one node of it in place. */
  readonly screenshot: (nodeId?: string) => Promise<string | null>;
  readonly scrollIntoView: (nodeId: string) => void;
  /** How the frame is shown from now on: what is left out stays as it was. */
  readonly show: (shown: Partial<FrameShown>) => void;
  /** Nodes an agent is rewriting, drawn as placeholders until it is done. */
  readonly skeleton: (nodeIds: readonly string[]) => void;
  /** The CSS custom properties the stylesheets define, resolved in the frame's theme. */
  readonly tokens: (
    prefixes?: readonly string[]
  ) => Readonly<Record<string, string>>;
  readonly unmount: () => void;
  readonly watchRects: (nodeIds: readonly string[]) => void;
}

/**
 * How the editor shows a frame, which the core writes on its host. What the page's code writes to
 * its `<html>` lands on the host too, and is kept apart: neither takes the other's off.
 */
export interface FrameShown {
  /** Off the screen: kept as it is, and skipped by the browser. */
  readonly away: boolean;
  /** The host's classes. */
  readonly className: string;
  /** The page responds to input: the prototype, interact mode. Otherwise the pointer goes past. */
  readonly interactive: boolean;
  /** The host's own style, as a style attribute writes it. */
  readonly style: string;
  /** What the frame is read by. */
  readonly title: string;
}

export interface MountFrameOptions {
  /** Canvas whose own assets relative image paths are looked for in first. */
  readonly canvas: string;
  readonly events: FrameEvents;
  /**
   * Identifies the frame: a frame on the canvas, the prototype, a specimen. Its host is marked
   * with it (`data-ed-frame-host`), and marked `data-ed-drawn` once its page has drawn.
   */
  readonly frame: string;
  /** How it is shown at first: a picture, in view, with no class, style or title of its own. */
  readonly shown?: Partial<FrameShown>;
  /** Drawn at once, without transitions: what pictures are taken of. */
  readonly still?: boolean;
}

/** What the editor gives the preview core, once. */
export interface PreviewSetup {
  /** Where the server answers which file an image of a canvas is (`/api/asset`). */
  readonly assets: string;
  /** The components' own stylesheet, which every frame adopts first (ADR 0040). */
  readonly css?: string | undefined;
  /** Written on every frame as `data-theme`. */
  readonly theme: string;
}

/** The editor's frames: what draws a page in a shadow root of the editor's page. */
export interface Preview {
  /**
   * Whether `event` comes from inside one of its frames: a page in the prototype, a text being
   * edited in place. It is the page's, as an event inside an iframe never reached the editor.
   */
  readonly fromFrame: (event: Event) => boolean;
  /**
   * Draws a frame into `host`, which it gives a shadow root and writes from then on (how it is
   * shown, `FrameRuntime.show`); `unmount` gives it back empty. Where the host is placed is the
   * editor's.
   */
  readonly mountFrame: (
    host: HTMLElement,
    options: MountFrameOptions
  ) => FrameRuntime;
}
