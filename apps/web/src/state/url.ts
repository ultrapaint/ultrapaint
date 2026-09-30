/**
 * The editor's own URL is where the router state lives:
 * `?canvas=marketing&route=/settings&variant=bold`, or `?page=marketing/draft.page.json` for a
 * page that serves no URL.
 * A prototype can be reloaded, bookmarked and handed to someone else, and the browser's back
 * and forward buttons are the prototype's, because every navigation is a history entry.
 * The workspace rides along as `?mode=design`, so a reload comes back to the same one.
 */
import { normaliseRoute } from "@ultrapaint/shared/route";

export interface UrlState {
  canvas: string | null;
  /** The page the editor is on when it serves no URL (its id); null otherwise. */
  page: string | null;
  /** Null while the editor is on a page that serves no URL. */
  route: string | null;
  /** The variant the router serves its routes in; absent for the base. */
  variant: string | null;
}

/** What a parameter means when it is absent, so it is left out rather than written. */
const defaults: Record<string, string> = { mode: "vibe", route: "/" };

export const readUrl = (): UrlState & {
  mode: string | null;
  /** A node to open on, selected and in view: a link copied from its menu. */
  node: string | null;
  settings: string | null;
} => {
  const params = new URLSearchParams(window.location.search);
  const canvas = params.get("canvas");
  const route = params.get("route");
  const page = params.get("page");
  const variant = params.get("variant");
  const onPage = page !== null && page !== "";
  return {
    canvas: canvas === "" ? null : canvas,
    mode: params.get("mode"),
    node: params.get("node"),
    page: onPage ? page : null,
    route: onPage ? null : normaliseRoute(route ?? "/"),
    // The section of the settings page when it is open: `?settings=repository`.
    settings: params.get("settings"),
    variant: variant === "" ? null : variant,
  };
};

/**
 * Applies `update` to the current query and writes it back without the parameters that are
 * empty or at their default: an editor on its home route reads as a bare URL.
 */
const writeQuery = (
  update: (params: URLSearchParams) => void,
  push: boolean
) => {
  const params = new URLSearchParams(window.location.search);
  update(params);
  for (const [key, value] of [...params]) {
    if (value === "" || defaults[key] === value) {
      params.delete(key);
    }
  }
  const query = params.toString();
  const url = `${window.location.pathname}${query ? `?${query}` : ""}`;
  if (push && url !== `${window.location.pathname}${window.location.search}`) {
    window.history.pushState(null, "", url);
  } else {
    window.history.replaceState(null, "", url);
  }
};

/** Drops the empty and default parameters an older or hand-written link still carries. */
export const tidyUrl = () => writeQuery(() => undefined, false);

/** Records whether the settings are open, and on which section; nothing to go back through. */
export const writeSettingsSection = (section: string | null) =>
  writeQuery((params) => params.set("settings", section ?? ""), false);

/** The node a link opened on is selected now; the link is not the editor's state. */
export const clearNodeParam = () =>
  writeQuery((params) => params.delete("node"), false);

/**
 * A link to a node, as the editor's own URL: its canvas, its page's route or the page itself when
 * it has none (neither for a node on the canvas beside the pages), and the node, which the editor
 * selects and brings into view.
 */
export const linkToNode = (target: {
  nodeId: string;
  page?: string | null;
  route: string | null;
  canvas: string;
}): string => {
  const url = new URL(window.location.href);
  const params = new URLSearchParams();
  const mode = url.searchParams.get("mode");
  if (target.canvas) {
    params.set("canvas", target.canvas);
  }
  if (target.route && target.route !== "/") {
    params.set("route", target.route);
  } else if (!target.route && target.page) {
    params.set("page", target.page);
  }
  if (mode) {
    params.set("mode", mode);
  }
  params.set("node", target.nodeId);
  return `${url.origin}${url.pathname}?${params.toString()}`;
};

/** Records the workspace; switching it is not a navigation, so back does not undo it. */
export const writeMode = (mode: string) =>
  writeQuery((params) => params.set("mode", mode), false);

/**
 * `push` for a navigation the user made (a link, a route in the panel), `replace` for state
 * the editor is only catching up with, so back does not walk through it.
 */
export const writeUrl = (state: UrlState, push: boolean) =>
  writeQuery((params) => {
    params.set("canvas", state.canvas ?? "");
    params.set("route", state.route ?? "");
    params.set("page", state.route === null ? (state.page ?? "") : "");
    params.set("variant", state.variant ?? "");
  }, push);

export const onUrlChange = (listener: (state: UrlState) => void) => {
  const handle = () => listener(readUrl());
  window.addEventListener("popstate", handle);
  return () => window.removeEventListener("popstate", handle);
};
