/**
 * The pages' pure parts: what `canvas.json` and `canvases.json` say, the URL a canvas opens on,
 * the page list a set of files makes, and the links a rename or a new URL rewrites. The pages
 * service and the snapshots both build on them; the service holds the files.
 */
import { Conflict } from "@ultrapaint/contracts/errors";
import {
  type Canvas,
  CanvasLayout,
  CanvasOrder,
  emptyCanvasLayout,
  type Page,
  type PageList,
} from "@ultrapaint/contracts/pages";
import { serialiseDocument } from "@ultrapaint/design-document/format";
import { fillIds } from "@ultrapaint/design-document/ids";
import { isPageFile } from "@ultrapaint/design-document/tree";
import {
  CANVAS_FILE,
  canvasIdOf,
  canvasIdsFrom,
  orderCanvases,
  pathInCanvas,
  ROOT_CANVAS,
} from "@ultrapaint/shared/canvas";
import { basename, humanise } from "@ultrapaint/shared/path";
import {
  matchRoute,
  normaliseRoute,
  pageNameOf,
  pageRouteOf,
  variantOf,
} from "@ultrapaint/shared/route";
import { Effect, Schema } from "effect";

export const IGNORED_DIRS = new Set([
  "node_modules",
  ".ultrapaint",
  "dist",
  ".vite",
]);
/** Room left between a new frame and the one it is placed after. */
export const FRAME_GAP = 80;

const decodeCanvas = Schema.decodeUnknownEffect(CanvasLayout);
export const decodeOrder = Schema.decodeUnknownEffect(
  Schema.fromJsonString(CanvasOrder)
);

/**
 * A layout from the text of `canvas.json`, with the ids its nodes leave out filled in. Nodes
 * are the canvas's document; ids are what an operation names them by.
 */
export const parseCanvas = (text: string) =>
  Effect.gen(function* () {
    const json = yield* Effect.try({
      catch: (error) =>
        new Conflict({ message: `canvas.json is not JSON: ${String(error)}` }),
      try: () => JSON.parse(text) as unknown,
    });
    const filled = fillIds(json);
    const layout = yield* decodeCanvas(json).pipe(
      Effect.mapError(
        (error) =>
          new Conflict({ message: `canvas.json is invalid: ${error.message}` })
      )
    );
    return { filled, layout };
  });

const sortedKeys = <T>(record: Readonly<Record<string, T>>) =>
  Object.fromEntries(
    Object.entries(record).sort(([a], [b]) => a.localeCompare(b))
  );

/**
 * `canvas.json` as it is written: what it is called first, keys sorted, and no empty list. The
 * routes are written even when there are none, since their absence means a canvas from before
 * pages had optional URLs.
 */
export const renderCanvas = (layout: CanvasLayout) => {
  const nodes = layout.nodes ?? [];
  const variants = layout.variants ?? [];
  const states = layout.states ?? [];
  return serialiseDocument({
    ...(layout.name !== undefined && { name: layout.name }),
    ...(layout.home !== undefined && { home: layout.home }),
    ...(variants.length > 0 && { variants }),
    ...(states.length > 0 && { states }),
    ...(layout.routes !== undefined && { routes: sortedKeys(layout.routes) }),
    frames: sortedKeys(layout.frames),
    ...(nodes.length > 0 && { nodes }),
    version: 1,
  });
};

const byRoute = (a: string, b: string) => a.localeCompare(b);

/** Routes keyed by page path, as entries a route can be matched against. */
const routeEntries = (routes: Readonly<Record<string, string>>) =>
  Object.entries(routes).map(([path, route]) => ({ path, route }));

/**
 * The URL a canvas's prototype opens on: the one its `canvas.json` names while a page serves
 * it, `/` while one does, or else the first URL a page serves. A canvas that serves none opens
 * on `/`, which is where it would open whatever it said.
 */
export const homeOf = (
  home: string | undefined,
  served: readonly string[]
): string => {
  const entries = served.map((route) => ({ route }));
  if (home !== undefined && matchRoute(entries, home)) {
    return normaliseRoute(home);
  }
  if (served.length === 0 || matchRoute(entries, "/")) {
    return "/";
  }
  return normaliseRoute([...served].sort(byRoute)[0] ?? "/");
};

/**
 * Where a canvas opens once its routes change: where it did while a page still serves that
 * URL, the new URL of the page that served it, or else the first URL a page serves. Absent when
 * the canvas never said, or when no page serves a URL any more.
 */
export const followHome = (
  home: string | undefined,
  before: Readonly<Record<string, string>>,
  after: Readonly<Record<string, string>>
): string | undefined => {
  if (home === undefined || matchRoute(routeEntries(after), home)) {
    return home;
  }
  const holder = matchRoute(routeEntries(before), home)?.entry.path;
  const moved = holder === undefined ? undefined : after[holder];
  if (moved !== undefined) {
    return normaliseRoute(moved);
  }
  const [first] = Object.values(after).map(normaliseRoute).sort(byRoute);
  return first;
};

/** The canvases a set of designs-relative files makes: one per `canvas.json`, or the root. */
export const canvasIdsIn = (files: readonly string[]): string[] => {
  const ids = canvasIdsFrom(
    files.filter((file) => basename(file) === CANVAS_FILE)
  );
  return ids.length === 0 ? [ROOT_CANVAS] : ids;
};

/**
 * A page from its canvas, its path inside it and the canvas's routes and states. A `@name` file
 * whose name the canvas lists among its states is its base page in that state (ADR 0030): it
 * serves no URL, a link reaches it by its file.
 */
export const pageOf = (
  canvas: string,
  pagePath: string,
  id: string,
  file: string,
  layout: Pick<CanvasLayout, "routes" | "states">
): Page => {
  const suffix = variantOf(pagePath);
  const state =
    suffix !== null && (layout.states ?? []).includes(suffix) ? suffix : null;
  const route =
    state === null ? pageRouteOf(layout.routes, pagePath) : undefined;
  return {
    canvas,
    file,
    id,
    name: pageNameOf(pagePath),
    path: pagePath,
    ...(route !== undefined && { route }),
    ...(state === null ? suffix !== null && { variant: suffix } : { state }),
  };
};

/**
 * The canvases and pages a set of files makes, whether they are on disk or kept by a snapshot:
 * `files` are relative to the designs directory, `layouts` the canvases' `canvas.json`.
 */
export const pageListOf = (input: {
  readonly files: readonly string[];
  /** The repository-relative file of a designs-relative one. */
  readonly fileOf: (rel: string) => string;
  readonly layouts: Readonly<Record<string, CanvasLayout>>;
  readonly order: readonly string[];
  /** What the designs directory's own canvas is called when its canvas.json does not say. */
  readonly rootName: string;
}): PageList => {
  const ids = canvasIdsIn(input.files);
  const explicit = ids.length === 1 && ids[0] === ROOT_CANVAS ? [] : ids;
  const pages: Page[] = [];
  for (const rel of input.files) {
    if (!isPageFile(basename(rel))) {
      continue;
    }
    const canvas = canvasIdOf(explicit, rel);
    // A page file that no canvas holds is not a page: it sits beside the canvases.
    if (canvas !== null) {
      pages.push(
        pageOf(
          canvas,
          pathInCanvas(canvas, rel),
          rel,
          input.fileOf(rel),
          input.layouts[canvas] ?? {}
        )
      );
    }
  }
  const canvases = ids.map((id): Canvas => {
    const layout = input.layouts[id] ?? emptyCanvasLayout();
    const listed = layout.variants ?? [];
    const drawn = pages
      .flatMap((p) =>
        p.canvas === id && p.variant !== undefined ? [p.variant] : []
      )
      .filter((v) => !listed.includes(v))
      .sort((a, b) => a.localeCompare(b));
    const served = pages.flatMap((p) =>
      p.canvas === id && p.variant === undefined && p.route !== undefined
        ? [p.route]
        : []
    );
    return {
      home: homeOf(layout.home, served),
      id,
      name: layout.name ?? (id === ROOT_CANVAS ? input.rootName : humanise(id)),
      variants: [...new Set([...listed, ...drawn])],
      ...((layout.states ?? []).length > 0 && {
        states: [...(layout.states ?? [])],
      }),
    };
  });
  return { canvases: orderCanvases(canvases, input.order), pages };
};

/**
 * Rewrites, in place, the `link` of every node of a JSON tree (a page document, a canvas's
 * nodes): `map` answers what a link becomes, or undefined to leave it. True when one changed.
 */
export const mapLinks = (
  value: unknown,
  map: (link: string) => string | undefined
): boolean => {
  if (Array.isArray(value)) {
    return value.map((item) => mapLinks(item, map)).some(Boolean);
  }
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  let changed = false;
  if (typeof record.link === "string") {
    const next = map(record.link);
    if (next !== undefined && next !== record.link) {
      record.link = next;
      changed = true;
    }
  }
  for (const key of ["children", "root"]) {
    if (key in record && mapLinks(record[key], map)) {
      changed = true;
    }
  }
  return changed;
};
