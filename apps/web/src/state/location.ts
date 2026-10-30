/**
 * Where the editor is: the canvas open, the URL its router is at or the page without one it
 * shows, the variant, and the page that is (`activePage`, what the prototype shows and agents are
 * about). They are one fact: `activePage` is the page serving the route in the variant, and the
 * editor's URL says the same (ADR 0012, 0020). This module alone writes them, through `arrive`,
 * and with them the URL and the canvas remembered for the next start, which are its persistence.
 *
 * The editor's store holds the four, so that a canvas opened is one change with its frames and
 * what reads them reads one store. `editor.ts` imports `followFrame` from here, and this module
 * the editor's layout and its `unpicked`: the two lean on each other only when called.
 *
 * The history: a navigation (`goTo` without a canvas, `{ push: false }` aside) is an entry of
 * its own, which back walks; opening a canvas, following the frame worked in and catching up with
 * the page list replace the entry, being nowhere the user went. A navigation starts with nothing
 * selected; the others keep the selection.
 */
import type { Page } from "@ultrapaint/contracts/pages";
import {
  basePathOf,
  matchRoute,
  normaliseRoute,
  pagesInVariant,
} from "@ultrapaint/shared/route";
import { useDocuments } from "./documents.ts";
import {
  type EditorState,
  pagesOfCanvas,
  unpicked,
  useEditor,
} from "./editor.ts";
import { frameRefOf, pageOfRef } from "./frame-ref.ts";
import { layoutOf, openedCanvas } from "./page-layout.ts";
import { reportError, useProject } from "./project.ts";
import {
  onUrlChange,
  readUrl,
  tidyUrl,
  type UrlState,
  writeMode,
  writeUrl,
} from "./url.ts";

/**
 * Where to go: a canvas, opened (its layout read again when it is the one open), and on it a page
 * by its id, at its URL when it has one, or a URL of its router, in a variant. Without a canvas,
 * the open one: a page decides its variant, a URL is served in the variant given or the one the
 * editor is in, and a variant alone draws the same place in it. A canvas opened without a page or
 * a URL opens on its home, in the variant given or the base.
 */
export interface GoTo {
  canvas?: string;
  page?: string | null;
  route?: string | null;
  variant?: string | null;
}

/** Where on the open canvas. */
interface Place {
  activePage: string | null;
  route: string | null;
  variant: string | null;
}

/** The canvas opened last, which the next start opens when the URL names none. */
const REMEMBERED = "ultrapaint:canvas";

/** Counts the canvases asked for: only the last one asked for is opened. */
let opening = 0;

const here = (): Place => {
  const { activePage, route, variant } = useEditor.getState();
  return { activePage, route, variant };
};

/**
 * The one writer: puts the editor at `place`, with what else changes with it (`also`: a canvas
 * opened, the selection let go) in the same change, and writes the URL to match it. A page is in
 * the URL only when the editor is at no URL.
 */
const arrive = (
  place: Place,
  history: "push" | "replace",
  also: Partial<EditorState> = {}
) => {
  useEditor.setState({ ...also, ...place });
  writeUrl(
    {
      canvas: useEditor.getState().canvas,
      page: place.route === null ? place.activePage : null,
      route: place.route,
      variant: place.variant,
    },
    history === "push"
  );
};

/**
 * The page a route is served by in a variant, matched the way the preview's router matches it:
 * the variant's own page for the route when it has one, the base page otherwise.
 */
const pageAt = (
  pages: readonly Page[],
  route: string,
  variant: string | null
): Page | null =>
  matchRoute(pagesInVariant(pages, variant), route)?.entry ?? null;

/** At a URL in a variant: the page serving it there, or none. */
const atRoute = (
  pages: readonly Page[],
  route: string,
  variant: string | null
): Place => {
  const at = normaliseRoute(route);
  return {
    activePage: pageAt(pages, at, variant)?.id ?? null,
    route: at,
    variant,
  };
};

/**
 * Where a canvas opens: the page without a URL it was asked for, as it is, or the page serving
 * the route. A canvas whose route has no page opens on whatever page it does have: one with a
 * URL first, as the prototype can go on from it.
 */
export const landingOf = (
  all: readonly Page[],
  served: readonly Page[],
  target: string,
  pageId: string | null
): { landing: string | null; shown: string | null } => {
  const asked = pageId === null ? undefined : all.find((p) => p.id === pageId);
  if (asked && asked.route === undefined) {
    return { landing: null, shown: asked.id };
  }
  const match = matchRoute(served, target);
  if (match) {
    return { landing: target, shown: match.entry.id };
  }
  const routed = served.find((p) => p.route !== undefined);
  if (routed?.route !== undefined) {
    return { landing: routed.route, shown: routed.id };
  }
  const [first] = served;
  return first
    ? { landing: null, shown: first.id }
    : { landing: target, shown: null };
};

/** Where on a canvas a destination is: what `landingOf` lands on, in a variant it has. */
const landingPlace = (canvas: string, to: GoTo): Place => {
  const all = pagesOfCanvas(canvas);
  const info = useProject.getState().canvases.find((c) => c.id === canvas);
  // A variant the canvas no longer has is the base.
  const variant =
    to.variant && info?.variants.includes(to.variant) ? to.variant : null;
  const { landing, shown } = landingOf(
    all,
    pagesInVariant(all, variant),
    normaliseRoute(to.route ?? info?.home ?? "/"),
    to.page ?? null
  );
  return { activePage: shown, route: landing, variant };
};

const openCanvas = async (canvas: string, to: GoTo) => {
  opening += 1;
  const asked = opening;
  try {
    const layout = await layoutOf(canvas);
    // Another canvas was asked for while this one's layout was on its way.
    if (asked !== opening) {
      return;
    }
    if (useDocuments.getState().canvas !== canvas) {
      useDocuments.getState().load(canvas);
    }
    arrive(landingPlace(canvas, to), "replace", {
      ...openedCanvas(canvas, layout),
      ...unpicked,
      canvas,
    });
    localStorage.setItem(REMEMBERED, canvas);
  } catch (error) {
    reportError(error);
  }
};

/** A move on the open canvas: see `GoTo`. */
const moveTo = (to: GoTo, history: "push" | "replace") => {
  const pages = pagesOfCanvas(useEditor.getState().canvas);
  const now = here();
  if ((to.page ?? null) !== null) {
    const page = pages.find((p) => p.id === to.page);
    if (!page) {
      return;
    }
    const variant = page.variant ?? null;
    if (page.route === undefined) {
      arrive({ activePage: page.id, route: null, variant }, history, unpicked);
    } else if (now.activePage === page.id && now.route !== null) {
      // Already there: stay on the route, and on the parameters it was reached with.
      arrive({ ...now, variant }, history);
    } else {
      arrive(atRoute(pages, page.route, variant), history, unpicked);
    }
    return;
  }
  const variant = to.variant === undefined ? now.variant : to.variant;
  if (to.route !== undefined && to.route !== null) {
    arrive(atRoute(pages, to.route, variant), history, unpicked);
    return;
  }
  if (variant === now.variant) {
    return;
  }
  if (now.route !== null) {
    arrive(atRoute(pages, now.route, variant), history);
    return;
  }
  // On a page without a URL: the same page, drawn for the variant when it is.
  const base = basePathOf(
    pages.find((p) => p.id === now.activePage)?.path ?? ""
  );
  const own = pages.filter((p) => basePathOf(p.path) === base);
  const shown =
    own.find((p) => (p.variant ?? null) === variant) ??
    own.find((p) => p.variant === undefined);
  arrive(
    { activePage: shown?.id ?? now.activePage, route: null, variant },
    history
  );
};

/**
 * Goes somewhere: see `GoTo`. On the open canvas the editor is there when this returns, and
 * every move is an entry in the history unless `push` is false; a canvas is there once its
 * layout is read, and replaces the entry.
 */
export const goTo = (to: GoTo, options?: { push?: boolean }): Promise<void> => {
  if (to.canvas !== undefined) {
    return openCanvas(to.canvas, to);
  }
  moveTo(to, (options?.push ?? true) ? "push" : "replace");
  return Promise.resolve();
};

/**
 * Working inside a frame is being on its route, in its variant: the editor is only ever at one
 * place at a time, and the layers, the inspector and the prototype all read it. It is not a
 * navigation the user asked for, so it replaces the history entry instead of adding one, and
 * keeps the selection being made. A node on the canvas beside the pages is at no page.
 */
export const followFrame = (frame: string) => {
  const of = pageOfRef(frameRefOf(frame));
  if (of === null) {
    return;
  }
  const page = pagesOfCanvas(useEditor.getState().canvas).find(
    (p) => p.id === of
  );
  if (!page) {
    return;
  }
  const now = here();
  const variant = page.variant ?? null;
  if (page.route === undefined) {
    if (now.activePage !== page.id || now.route !== null) {
      arrive({ activePage: page.id, route: null, variant }, "replace");
    }
  } else if (page.route !== now.route || variant !== now.variant) {
    arrive({ activePage: page.id, route: page.route, variant }, "replace");
  }
};

/**
 * The page list or the canvases changed: a canvas deleted while open gives way to the first one
 * left; a page added or taken away opens the canvas again where it is, for its frames; otherwise
 * the editor catches up: a page shown without a URL that has one now is at it, one that is gone
 * gives way to where the canvas opens, and the page serving the route is the one the list says.
 */
export const pagesChanged = () => {
  const { canvas, frames } = useEditor.getState();
  if (canvas === null) {
    return;
  }
  const { canvases } = useProject.getState();
  if (canvases.length > 0 && !canvases.some((c) => c.id === canvas)) {
    goTo({ canvas: canvases[0]?.id ?? "" });
    return;
  }
  const pages = pagesOfCanvas(canvas);
  const now = here();
  // A view's frame is its page's (ADR 0036).
  const framed = Object.keys(frames).filter(
    (id) => frameRefOf(id).kind !== "view"
  );
  if (
    pages.some((p) => !frames[p.id]) ||
    framed.some((id) => !pages.some((p) => p.id === id))
  ) {
    goTo({
      canvas,
      page: now.activePage,
      route: now.route,
      variant: now.variant,
    });
    return;
  }
  if (now.route === null) {
    const page = pages.find((p) => p.id === now.activePage);
    if (page?.route !== undefined) {
      // The page was given a URL: the editor is at it now.
      arrive(atRoute(pages, page.route, now.variant), "replace");
    } else if (!page) {
      arrive(landingPlace(canvas, { variant: now.variant }), "replace");
    }
    return;
  }
  const served = pageAt(pages, now.route, now.variant)?.id ?? null;
  if (served !== now.activePage) {
    arrive({ ...now, activePage: served }, "replace");
  }
};

/**
 * Opens the canvas the editor starts on, once the canvases are known: the one the URL names, at
 * the place it names, or the one opened last, or the first, on its home. False when there is
 * nothing to open, or a canvas is open already.
 */
export const openStartCanvas = (): boolean => {
  const { canvases } = useProject.getState();
  if (canvases.length === 0 || useEditor.getState().canvas !== null) {
    return false;
  }
  const url = readUrl();
  const saved = localStorage.getItem(REMEMBERED);
  const ids = canvases.map((c) => c.id);
  // The designs directory's own canvas is named "", which the URL leaves out: a link with a
  // route and no canvas is a route of that canvas.
  const named =
    url.canvas ??
    (ids.includes("") && (url.route !== "/" || url.page !== null) ? "" : null);
  let canvas = ids[0] ?? "";
  if (named !== null && ids.includes(named)) {
    canvas = named;
  } else if (saved !== null && ids.includes(saved)) {
    canvas = saved;
  }
  goTo(
    named === canvas
      ? { canvas, page: url.page, route: url.route, variant: url.variant }
      : { canvas }
  );
  return true;
};

/**
 * The browser went back or forward to an entry: the editor goes where it says, writing no entry
 * of its own. Another canvas is opened at it.
 */
const wentTo = (url: UrlState) => {
  if (url.canvas !== null && url.canvas !== useEditor.getState().canvas) {
    goTo({ ...url, canvas: url.canvas });
    return;
  }
  goTo(
    url.route === null
      ? { page: url.page }
      : { route: url.route, variant: url.variant },
    { push: false }
  );
};

/**
 * Follows the browser's back and forward buttons, which are the prototype's, until the answer
 * is called. The URL is tidied first: what an older or hand-written link carries at its default.
 */
export const followHistory = (): (() => void) => {
  tidyUrl();
  return onUrlChange((url) => {
    wentTo(url);
    // Back and forward walk the places, not the workspace: an older entry may name another.
    writeMode(useEditor.getState().workspace);
  });
};
