/**
 * What the code the preview's server generates calls in the editor's page, and preview-core
 * defines there (ADR 0034): the globals, their shapes, and the mark the server puts in the
 * repository's modules. The server writes its calls as text (the guard module, Vite's client
 * patched, the components' registry), which nothing typechecks against the page; both sides take
 * the names from here instead, and preview-core defines each global through its shape, so an
 * implementation that drifts from it does not compile. The calls stay calls on globals rather
 * than imports: the loop check a dependency gets must stand alone (docs/PLAN-architecture.md).
 *
 * Imports nothing: the server's Node code and the editor's bundle both take it as it is.
 */

/** What the guard module (`virtual:ultrapaint/guard`) asks; preview-core's sandbox answers. */
export const GUARD_GLOBAL = "__ultrapaintGuard";

/**
 * The guard's side in the page. `Frame` is the sandbox's own: the generated code only hands back
 * what `frame` gave it.
 */
export interface PageGuard<Frame = unknown> {
  /** The frame the code running now is for: an `async` function notes it as it is called. */
  readonly frame: () => Frame | null;
  /** Marks what an `async` function rejects with as `frame`'s; a mark already there stays. */
  readonly mark: (error: object, frame: Frame) => void;
  /** A module of the repository's top-level code ends (`preview-core/hmr-leftovers.ts`). */
  readonly moduleEnds: (url: string) => void;
  /** A module of the repository's top-level code starts. */
  readonly moduleStarts: (url: string) => void;
}

/** Where Vite's client, patched (`framework-react-vite/vite-client.ts`), hands stylesheets. */
export const STYLES_GLOBAL = "__edStyles";

/** The application's stylesheets, by the module that loads each (`preview-core/styles.ts`). */
export interface PageStyles {
  readonly remove: (id: string) => void;
  readonly update: (id: string, css: string) => void;
}

/** What Vite's client, patched, calls instead of reloading the editor's page. */
export const RELOAD_GLOBAL = "__edReload";

export type PageReload = () => void;

/** Where the components' registry, rewritten as they are catalogued, hands itself over. */
export const REGISTRY_GLOBAL = "__ED__";

/** The modules instances import, by the specifier a node's `from` names. */
export type ComponentModules = Readonly<Record<string, () => Promise<unknown>>>;

export interface PageRegistry {
  readonly setComponents: (components: ComponentModules) => void;
}

/** The page's globals: each is there once preview-core has defined it, and not in a tab. */
export interface PageRuntime<Frame = unknown> {
  [GUARD_GLOBAL]?: PageGuard<Frame>;
  [REGISTRY_GLOBAL]?: PageRegistry;
  [RELOAD_GLOBAL]?: PageReload;
  [STYLES_GLOBAL]?: PageStyles;
}

/** A shape's members by their names: every one, and nothing else. */
type Members<T> = { readonly [K in keyof T]-?: K };

/** What the generated code may call on each global, for its templates and their test. */
export const GUARD_MEMBERS = {
  frame: "frame",
  mark: "mark",
  moduleEnds: "moduleEnds",
  moduleStarts: "moduleStarts",
} as const satisfies Members<PageGuard>;

export const STYLES_MEMBERS = {
  remove: "remove",
  update: "update",
} as const satisfies Members<PageStyles>;

export const REGISTRY_MEMBERS = {
  setComponents: "setComponents",
} as const satisfies Members<PageRegistry>;

/** Every global and its members; a function's (`__edReload`) has none. */
export const PAGE_RUNTIME = {
  [GUARD_GLOBAL]: GUARD_MEMBERS,
  [REGISTRY_GLOBAL]: REGISTRY_MEMBERS,
  [RELOAD_GLOBAL]: {},
  [STYLES_GLOBAL]: STYLES_MEMBERS,
} as const satisfies {
  readonly [K in keyof PageRuntime]-?: Members<NonNullable<PageRuntime[K]>>;
};

/**
 * The name the repository's modules call the guard's `moduleStarts` by: the server's guard puts
 * the call first in every module of the repository's, and in no other
 * (`framework-react-vite/guard-code.ts`).
 */
export const MODULE_MARK_NAME = "__edModuleStarts";

/** The mark itself, as the page's side and the desktop app find it in a module's code. */
export const MODULE_MARK = `${MODULE_MARK_NAME}(`;

/** The page's globals as they stand. */
export const pageRuntime = <Frame = unknown>(): PageRuntime<Frame> =>
  globalThis as PageRuntime<Frame>;

/** Defines the globals given, each through its shape. */
export const installPageRuntime = <Frame>(
  globals: PageRuntime<Frame>
): void => {
  Object.assign(globalThis, globals);
};
