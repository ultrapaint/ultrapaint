/**
 * What a renderer gives the preview, in the browser. The preview core knows the DOM and the
 * editor's protocol and nothing about any UI framework; drawing a design document with the
 * framework the design system is written in is the renderer's, the way Storybook's preview only
 * knows a renderer's `renderToCanvas`.
 */
import type { DesignSystem } from "@ultrapaint/contracts/design-system";
import type { DesignNode } from "@ultrapaint/contracts/document";
import type { InstanceDrawn, RenderMode } from "@ultrapaint/contracts/preview";

/** The modules instances import, by the specifier a node's `from` names. */
export type ComponentRegistry = Readonly<
  Record<string, () => Promise<unknown>>
>;

/** What the core hands a renderer once, when it mounts it. */
export interface RenderSetup {
  /** URL of an image a node shows: a path inside the space, or a URL as it is. */
  readonly assetUrl: (src: string) => string;
  readonly components: ComponentRegistry;
  /** A node with a link was pressed. */
  readonly navigate: (route: string) => void;
  /** A render reached the screen. */
  readonly onRendered: (renderId: number) => void;
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
}

/** One thing to draw. */
export interface RenderRequest {
  readonly designSystem: DesignSystem | null;
  /** Shown instead of a node. */
  readonly message?: string | undefined;
  readonly mode: RenderMode;
  readonly renderId: number;
  readonly root: DesignNode | null;
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

/** What the generated entry module hands the preview core to start. */
export interface StartInput {
  readonly canvas: HTMLElement;
  readonly components: ComponentRegistry;
  readonly mount: RenderToCanvas;
  readonly providers: unknown;
}

/** The surface the preview core leaves on `window.__ED__` for the generated modules. */
export interface PreviewGlobal {
  readonly notifyHmr: () => void;
  readonly reportError: (error: {
    readonly file?: string | undefined;
    readonly line?: number | undefined;
    readonly message: string;
    readonly stack?: string | undefined;
  }) => void;
  /** The generated registry of component modules was rewritten. */
  readonly setComponents: (components: ComponentRegistry) => void;
  readonly start: (input: StartInput) => void;
}
