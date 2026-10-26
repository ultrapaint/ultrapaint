/**
 * What a renderer gives the preview, in the editor's page (ADR 0034). The preview core knows the
 * DOM and nothing about any UI framework; drawing a design document with the framework the design
 * system is written in is the renderer's, the way Storybook's preview only knows a renderer's
 * `renderToCanvas`.
 */
import type { DesignSystem } from "@ultrapaint/contracts/design-system";
import type { DesignNode } from "@ultrapaint/contracts/document";
import type { InstanceDrawn, RenderMode } from "@ultrapaint/contracts/preview";
import type { ComponentSpec } from "@ultrapaint/contracts/specs";

/** Attribute the renderer writes on every node it draws: the node's id in the document. */
export const NODE_ATTRIBUTE = "data-ed-node";

/** The selector for the elements drawn for a node. */
export const nodeSelector = (id: string) =>
  `[${NODE_ATTRIBUTE}="${CSS.escape(id)}"]`;

/** The modules instances import, by the specifier a node's `from` names. */
export type ComponentRegistry = Readonly<
  Record<string, () => Promise<unknown>>
>;

/** What the core hands a renderer once, when it mounts it. */
export interface RenderSetup {
  /** URL of an image a node shows: a path inside the canvas, or a URL as it is. */
  readonly assetUrl: (src: string) => string;
  readonly components: ComponentRegistry;
  /** A node with a link was pressed. */
  readonly navigate: (route: string) => void;
  /** A render reached the screen. */
  readonly onRendered: (renderId: number) => void;
  /** The height a page fills at least: the window's (`100vh`), or the frame's (`100cqh`). */
  readonly pageHeight?: string;
  /** Default export of the providers module from the settings, when there is one. */
  readonly providers: unknown;
  /** Reports a render error to the editor. */
  readonly reportError: (error: {
    readonly message: string;
    readonly stack?: string | undefined;
  }) => void;
  /** How instances were drawn, by node id: the ones that changed since the last report. */
  readonly reportInstances?: (
    instances: Readonly<Record<string, InstanceDrawn>>
  ) => void;
  /**
   * The design's own stylesheet (ADR 0028, 0029), when the core keeps one for every frame:
   * otherwise the renderer puts it in the document's head.
   */
  readonly setDesignCss?: (css: string) => void;
}

/** One thing to draw. */
export interface RenderRequest {
  readonly designSystem: DesignSystem | null;
  /** Shown instead of a node. */
  readonly message?: string | undefined;
  readonly mode: RenderMode;
  readonly renderId: number;
  readonly root: DesignNode | null;
  /** The component specs (ADR 0029): drawn over their components, drafts in their instances' place. */
  readonly specs?: readonly ComponentSpec[] | undefined;
  /** CSS the design puts after the code's: the tokens' values where they differ (ADR 0028). */
  readonly styles?: string | undefined;
}

/** A mounted canvas: the providers stay put, what is under them is drawn again on request. */
export interface Mounted {
  readonly render: (request: RenderRequest) => void;
  /** The registry changed: the dev server added a module. */
  readonly setComponents: (components: ComponentRegistry) => void;
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
  readonly error?: (error: {
    readonly file?: string | undefined;
    readonly line?: number | undefined;
    readonly message: string;
    readonly stack?: string | undefined;
  }) => void;
  /** The dev server brought modules up to date: an error shown may be gone. */
  readonly hmr?: () => void;
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
  /** Whether the page responds to input: the prototype, interact mode. */
  readonly setInteractive: (interactive: boolean) => void;
  /** Nodes an agent is rewriting, drawn as placeholders until it is done. */
  readonly skeleton: (nodeIds: readonly string[]) => void;
  /** The CSS custom properties the stylesheets define, resolved in the frame's theme. */
  readonly tokens: (
    prefixes?: readonly string[]
  ) => Readonly<Record<string, string>>;
  readonly unmount: () => void;
  readonly watchRects: (nodeIds: readonly string[]) => void;
}

export interface MountFrameOptions {
  /** Canvas whose own assets relative image paths are looked for in first. */
  readonly canvas: string;
  readonly events: FrameEvents;
  /** Identifies the frame: a frame on the canvas, the prototype, a specimen. */
  readonly frame: string;
  /** Drawn at once, without transitions: what pictures are taken of. */
  readonly still?: boolean;
}

/** What the generated entry hands the preview core in the editor's page. */
export interface PreviewSetup {
  /** Where the preview's server answers which file an image of a canvas is. */
  readonly assets: string;
  readonly components: ComponentRegistry;
  /** URL of the designs directory on the preview's server. */
  readonly designsRoot: string;
  readonly mount: RenderToCanvas;
  readonly providers: unknown;
  /** Written on every frame as `data-theme`, as it was on an iframe's document. */
  readonly theme: string;
}

/** The repository's components, ready to draw frames in the editor's page. */
export interface Preview {
  /** Draws a frame into `host`, which it gives a shadow root; `unmount` gives it back empty. */
  readonly mountFrame: (
    host: HTMLElement,
    options: MountFrameOptions
  ) => FrameRuntime;
  /** The dev server updated modules: what was in error may draw now. */
  readonly notifyHmr: () => void;
  /** A dev server error, reported to every frame. */
  readonly reportError: (error: {
    readonly file?: string | undefined;
    readonly line?: number | undefined;
    readonly message: string;
  }) => void;
  readonly setComponents: (components: ComponentRegistry) => void;
}
