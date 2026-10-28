/**
 * What a renderer gives the preview, in the editor's page (ADR 0034). The preview core knows the
 * DOM and nothing about any UI framework; drawing a design document with the framework the design
 * system is written in is the renderer's, the way Storybook's preview only knows a renderer's
 * `renderToCanvas`.
 */
import type { DesignSystem } from "@ultrapaint/contracts/design-system";
import type { DesignNode } from "@ultrapaint/contracts/document";
import type { ComponentModules } from "@ultrapaint/contracts/page-runtime";
import type { PageDefaults } from "@ultrapaint/contracts/pages";
import type { InstanceDrawn, RenderMode } from "@ultrapaint/contracts/preview";
import type { ComponentSpec } from "@ultrapaint/contracts/specs";

/** Attribute the renderer writes on every node it draws: the node's id in the document. */
export const NODE_ATTRIBUTE = "data-ed-node";

/** The selector for the elements drawn for a node. */
export const nodeSelector = (id: string) =>
  `[${NODE_ATTRIBUTE}="${CSS.escape(id)}"]`;

/** The modules instances import, as the registry hands them to the page (`page-runtime.ts`). */
export type ComponentRegistry = ComponentModules;

/**
 * What the core hands a renderer once, when it mounts it in a frame of the editor's page (ADR
 * 0034): the one host there is, so every field is given.
 */
export interface RenderSetup {
  /** URL of an image a node shows: a path inside the canvas, or a URL as it is. */
  readonly assetUrl: (src: string) => string;
  readonly components: ComponentRegistry;
  /**
   * The render's components are drawing, or their effects running: what they ask of the window's
   * size is the frame's (ADR 0036). Called often; it only says so.
   */
  readonly drawing: () => void;
  /** A node with a link was pressed. */
  readonly navigate: (route: string) => void;
  /** A render reached the screen. */
  readonly onRendered: (renderId: number) => void;
  /** The height a page fills at least: its frame's (`100cqh`), as a page fills its window. */
  readonly pageHeight: string;
  /** Default export of the providers module from the settings, when there is one. */
  readonly providers: unknown;
  /** A root path to one of the application's public files where the page finds it; others as they are. */
  readonly publicUrl: (url: string) => string;
  /** Reports a render error to the editor. */
  readonly reportError: (error: {
    readonly message: string;
    readonly stack?: string | undefined;
  }) => void;
  /** How instances were drawn, by node id: the ones that changed since the last report. */
  readonly reportInstances: (
    instances: Readonly<Record<string, InstanceDrawn>>
  ) => void;
  /** The design's own stylesheet (ADR 0028, 0029), which the core keeps for every frame. */
  readonly setDesignCss: (css: string) => void;
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
   * with it (`data-ed-frame-host`).
   */
  readonly frame: string;
  /** How it is shown at first: a picture, in view, with no class, style or title of its own. */
  readonly shown?: Partial<FrameShown>;
  /** Drawn at once, without transitions: what pictures are taken of. */
  readonly still?: boolean;
}

/**
 * What the generated entry hands the preview core in the editor's page. The renderer is not
 * among it: the bundle's entry (preview-core's `editor.ts`) is given it when the framework
 * builds the bundle.
 */
export interface PreviewSetup {
  /** Where the preview's server answers which file an image of a canvas is. */
  readonly assets: string;
  readonly components: ComponentRegistry;
  /** URL of the designs directory on the preview's server. */
  readonly designsRoot: string;
  readonly providers: unknown;
  /**
   * The application's public directory, which it names files in from the root (`/media/a.webp`):
   * its entries (a directory's ending in `/`), served under `base` in the editor's page.
   */
  readonly publicFiles?: PublicFiles | undefined;
  /** Written on every frame as `data-theme`, as it was on an iframe's document. */
  readonly theme: string;
}

/** The entries of the application's public directory and where the editor's page finds them. */
export interface PublicFiles {
  readonly base: string;
  readonly entries: readonly string[];
}

/** The repository's components, ready to draw frames in the editor's page. */
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
  /** The dev server updated modules: what was in error may draw now. */
  readonly notifyHmr: () => void;
  /**
   * Hears which frame's page code is running (drawing, or answering input), by the `frame` it
   * was mounted with: what the editor's watchdog blames when the page stops the editor's thread.
   * Told when it changes, and again at most every few hundred milliseconds while it runs.
   */
  readonly onRunning: (listener: (frame: string) => void) => () => void;
  /**
   * Hears what the page's code threw and nothing caught when no frame can be said to be its: a
   * rejection without its `async` function's mark, with more than one frame drawn.
   */
  readonly onStrayError: (
    listener: (error: {
      readonly file?: string | undefined;
      readonly line?: number | undefined;
      readonly message: string;
    }) => void
  ) => () => void;
  /** A dev server error, reported to every frame. */
  readonly reportError: (error: {
    readonly file?: string | undefined;
    readonly line?: number | undefined;
    readonly message: string;
  }) => void;
  readonly setComponents: (components: ComponentRegistry) => void;
}

/**
 * What the generated editor entry exports, as the editor's page imports it (named for the
 * framework that writes it in `editor-exports.ts`): the preview, and hearing when only loading
 * the page again brings it up to date (the dev server's dependencies bundled anew, or its start
 * again).
 */
export interface EditorEntry {
  readonly onReloadRequest: (listener: () => void) => () => void;
  readonly preview: Preview;
}

/** What the dev server tells the generated entry and the start-up hears, by event. */
export interface DevServerEvents {
  /** Modules were brought up to date. */
  readonly "vite:afterUpdate": unknown;
  /** A module could not be brought up to date. */
  readonly "vite:error": {
    readonly err: {
      readonly id?: string | undefined;
      readonly loc?: { readonly line: number } | undefined;
      readonly message: string;
    };
  };
}

/** The dev server's events, as the generated entry has them (`import.meta.hot`). */
export interface DevServerHot {
  readonly on: <E extends keyof DevServerEvents>(
    event: E,
    listener: (payload: DevServerEvents[E]) => void
  ) => void;
}

/**
 * What the editor bundle exports to the generated entry (named in `editor-exports.ts`):
 * preview-core's start-up, given the framework's renderer when the framework builds the bundle
 * (ADR 0011).
 */
export interface EditorBundle {
  /**
   * Starts the preview in the editor's page, in its one order (preview-core's `editor.ts`): the
   * page runtime first, then `load`, which imports the page's modules (its stylesheets, the
   * registry, the providers) and whose default export is the setup, then the preview, which
   * hears the dev server through `hot`. The entry exports what it gives.
   */
  readonly startPreview: (
    load: () => Promise<{ readonly default: PreviewSetup }>,
    hot?: DevServerHot | undefined
  ) => Promise<EditorEntry>;
}
