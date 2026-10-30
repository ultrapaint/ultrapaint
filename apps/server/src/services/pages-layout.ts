/**
 * The pages' pure parts: what `canvases.json` says, the URL a canvas opens on,
 * the page list a set of files makes. The pages
 * service and the snapshots both build on them; the service holds the files.
 */
import {
  type Canvas,
  type CanvasLayout,
  CanvasOrder,
  emptyCanvasLayout,
  type Page,
  type PageList,
} from "@ultrapaint/contracts/pages";
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
import { Schema } from "effect";

export const IGNORED_DIRS = new Set([
  "node_modules",
  ".ultrapaint",
  "dist",
  ".vite",
]);
export const decodeOrder = Schema.decodeUnknownEffect(
  Schema.fromJsonString(CanvasOrder)
);

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
