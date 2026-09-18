/**
 * What a renderer gives the preview, in the browser. The preview core knows the DOM and the
 * editor's protocol and nothing about any UI framework; everything that needs the framework's
 * own component tree comes through this interface, the way Storybook's preview only knows a
 * renderer's `renderToCanvas`.
 */
import type { SourceLocation } from "@ultrapaint/contracts/base";
import type { TreeNode } from "@ultrapaint/contracts/preview";

/** What the core hands a renderer when it installs it. */
export interface PreviewContext {
  /** Whether an element at this location may be edited: it lies in the designs directory. */
  readonly isEditable: (source: SourceLocation | null) => boolean;
  /** Call after every commit of the framework: the tree and the rectangles are stale. */
  readonly onCommit: () => void;
  /** Parses the value of the stamp attribute, `<file>:<line>:<col>`. */
  readonly parseStamp: (value: unknown) => SourceLocation | null;
  /** Attribute the stamping plugin writes on every element of the source. */
  readonly stampAttribute: string;
}

/** What only the framework knows about one node of its tree. */
export interface NodeFacts {
  readonly editable: boolean;
  /** Nearest ancestor that can be edited, when the node itself cannot. */
  readonly editableAncestor: {
    readonly name: string;
    readonly nodeId: string;
    readonly source: SourceLocation;
  } | null;
  readonly kind: "component" | "element";
  readonly name: string;
  /** Classes the instance passed itself, as opposed to those its implementation added. */
  readonly ownClasses: readonly string[];
  /** Serialisable props of a component instance; empty for an element. */
  readonly props: Record<string, unknown>;
  readonly source: SourceLocation | null;
  /** Text a component was given as its only child. An element's text is read from the DOM. */
  readonly text: string | null;
}

/** Reads a framework's component tree. Node ids are the renderer's and stay stable across commits. */
export interface Introspector {
  /**
   * The nodes a click on this element can reach, outermost first. The first is what a plain
   * click means; the rest are the way in, one step at a time.
   */
  readonly chainAt: (element: Element) => readonly string[];
  readonly describe: (nodeId: string) => NodeFacts | null;
  /** DOM elements a node renders; several for a component that returns a fragment. */
  readonly elementsOf: (nodeId: string) => Element[];
  /**
   * Runs before the framework loads, so a renderer can put its hooks in place (React's
   * DevTools hook has to exist before React initialises).
   */
  readonly install: (context: PreviewContext) => void;
  /** The mounted tree, or null while nothing is mounted. */
  readonly tree: () => TreeNode[] | null;
}

/** One page of a space, as the preview sees it. */
export interface PageRoute {
  /** Imports the page module. */
  readonly load: () => Promise<unknown>;
  /** Path of the page inside its space, `settings/billing.tsx`. */
  readonly path: string;
  /** Route it serves, `/settings/billing`. */
  readonly route: string;
}

/** What the preview core passes to a renderer's `renderToCanvas`. */
export interface RenderInput {
  /** The page to show, or null when no page of the space serves the route. */
  readonly page: PageRoute | null;
  /** Default export of the providers module from the settings, when there is one. */
  readonly providers: unknown;
  /** Reports a render error to the editor. */
  readonly reportError: (error: {
    readonly message: string;
    readonly stack?: string | undefined;
  }) => void;
  readonly route: string;
}

/** A mounted space: the providers stay put, the page under them is swapped on navigation. */
export interface Mounted {
  readonly unmount: () => void;
  readonly update: (input: Pick<RenderInput, "page" | "route">) => void;
}

/** Mounts a space's router into the canvas element at the route the editor holds. */
export type RenderToCanvas = (
  input: RenderInput,
  canvas: HTMLElement
) => Mounted;

/** What the generated entry module hands the preview core to start the space's router. */
export interface RouterInput {
  /** Prefix of every glob key, up to the designs directory (`"../"`). */
  readonly base: string;
  readonly canvas: HTMLElement;
  /** Every candidate page module of the designs directory, keyed by glob key. */
  readonly modules: Record<string, () => Promise<unknown>>;
  readonly mount: RenderToCanvas;
  readonly providers: unknown;
  /** Glob keys of the `space.json` files, which is what marks a directory as a space. */
  readonly spaceFiles: readonly string[];
}

/** Where the space's router is, as a page sees it. */
export interface RouterState {
  readonly params: Readonly<Record<string, string>>;
  readonly route: string;
}

/**
 * What the preview core leaves on `window.__ED_ROUTER__` for the navigation module generated
 * next to the designs. A page that finds nothing there is running outside ultrapaint and
 * falls back to the browser's own history.
 */
export interface RouterBridge {
  /** A route (`/settings/billing`) or a page inside the space (`settings/billing.tsx`). */
  readonly navigate: (to: string, options?: { replace?: boolean }) => void;
  /** One frozen object per navigation, so it can be read as an external store. */
  readonly state: () => RouterState;
  readonly subscribe: (listener: () => void) => () => void;
}

/** The surface the preview core leaves on `window.__ED__` for the generated entry module. */
export interface PreviewGlobal {
  readonly notifyHmr: () => void;
  readonly reportError: (error: {
    readonly file?: string | undefined;
    readonly line?: number | undefined;
    readonly message: string;
    readonly stack?: string | undefined;
  }) => void;
  /** Shows a message in place of the page, without any framework. */
  readonly showMessage: (canvas: HTMLElement, message: string) => void;
  /**
   * Starts the space's router: the core works out which pages belong to the space, matches the
   * route the editor holds and mounts the renderer under it.
   */
  readonly startRouter: (input: RouterInput) => void;
}
