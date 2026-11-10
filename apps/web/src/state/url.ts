/**
 * The editor's own URL is where the router state lives:
 * `?canvas=marketing&route=/settings&variant=bold`, or `?page=marketing/draft.page.json` for a
 * page that serves no URL.
 * A prototype can be reloaded, bookmarked and handed to someone else, and the browser's back
 * and forward buttons are the prototype's, because every navigation is a history entry.
 * The workspace rides along as `?mode=prototype`, so a reload comes back to the same one, and a
 * board view (ADR 0045) as `?view=system&item=color`, beside the canvas and the page it left.
 */
import { normaliseRoute } from "@ultrapaint/shared/route";

interface UrlState {
  canvas: string | null;
  /** The page the editor is on when it serves no URL (its id); null otherwise. */
  page: string | null;
  /** Null while the editor is on a page that serves no URL. */
  route: string | null;
  /** The variant the router serves its routes in; absent for the base. */
  variant: string | null;
}

/** What a parameter means when it is absent, so it is left out rather than written. */
const defaults: Record<string, string> = { mode: "design", route: "/" };

/** Values older links carry for what is now the default: Vibe and Design are one workspace. */
const formerDefaults: Record<string, readonly string[]> = { mode: ["vibe"] };

/**
 * Whether a parameter holds what it means when absent. A link's parameters are anyone's to name,
 * `constructor` included: only the tables' own keys are read.
 */
const isDefault = (key: string, value: string) =>
  (Object.hasOwn(defaults, key) && defaults[key] === value) ||
  (Object.hasOwn(formerDefaults, key) &&
    formerDefaults[key]?.includes(value) === true);

/** A board view as the URL says it: which one, and the item it shows. */
export interface BoardUrl {
  item: string | null;
  view: string;
}

export type UrlRead = UrlState & {
  /** The board view open in the canvas's place; null on the page canvas. */
  board: BoardUrl | null;
  mode: string | null;
  /** A node to open on, selected and in view: a link copied from its menu. */
  node: string | null;
  settings: string | null;
};

export const readUrl = (): UrlRead => {
  const params = new URLSearchParams(window.location.search);
  const canvas = params.get("canvas");
  const route = params.get("route");
  const page = params.get("page");
  const variant = params.get("variant");
  const view = params.get("view");
  const item = params.get("item");
  const onPage = page !== null && page !== "";
  return {
    board: view ? { item: item || null, view } : null,
    canvas: canvas === "" ? null : canvas,
    mode: params.get("mode"),
    node: params.get("node"),
    page: onPage ? page : null,
    route: onPage ? null : normaliseRoute(route ?? "/"),
    // The section of the settings when they are open: `?settings=repository`.
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
    if (value === "" || isDefault(key, value)) {
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
 * A link to a page or a node of it, as the editor's own URL: its canvas, its page's route (`/`
 * written too, so a node of the home page is not one beside the pages) or the page itself when it
 * has none (neither for a node on the canvas beside the pages), the variant when the page is a
 * variant's, whose route is its base page's, and the node, which the editor selects and brings
 * into view. A board view open is no part of it: the link leads to the page.
 * Agents take it as they take a node reference (`parseEditorLink`), inside the editor or outside.
 */
export const linkToNode = (target: {
  nodeId?: string;
  page?: string | null;
  route: string | null;
  canvas: string;
  variant?: string | undefined;
}): string => {
  const url = new URL(window.location.href);
  const params = new URLSearchParams();
  const mode = url.searchParams.get("mode");
  if (target.canvas) {
    params.set("canvas", target.canvas);
  }
  if (target.route) {
    params.set("route", target.route);
    // A page named by its id is the variant's own file already.
    if (target.variant) {
      params.set("variant", target.variant);
    }
  } else if (!target.route && target.page) {
    params.set("page", target.page);
  }
  if (mode) {
    params.set("mode", mode);
  }
  if (target.nodeId) {
    params.set("node", target.nodeId);
  }
  return `${url.origin}${url.pathname}?${params.toString()}`;
};

/**
 * Records the board view open and its item, or that none is (ADR 0045). Opening one from the
 * page is a navigation (`push`), which back walks; going from item to item replaces it.
 */
export const writeBoard = (
  board: { item: string; view: string } | null,
  push: boolean
) =>
  writeQuery((params) => {
    params.set("view", board?.view ?? "");
    params.set("item", board?.item ?? "");
  }, push);

/** Records the workspace; switching it is not a navigation, so back does not undo it. */
export const writeMode = (mode: string) =>
  writeQuery((params) => params.set("mode", mode), false);

/**
 * `push` for a navigation the user made (a link, a route in the panel), `replace` for state
 * the editor is only catching up with, so back does not walk through it. The board view open in
 * the canvas's place, or none, is written with it: one entry for a navigation that leaves one.
 */
export const writeUrl = (
  state: UrlState,
  push: boolean,
  board: { item: string; view: string } | null
) =>
  writeQuery((params) => {
    params.set("canvas", state.canvas ?? "");
    params.set("route", state.route ?? "");
    params.set("page", state.route === null ? (state.page ?? "") : "");
    params.set("variant", state.variant ?? "");
    params.set("view", board?.view ?? "");
    params.set("item", board?.item ?? "");
  }, push);

export const onUrlChange = (listener: (state: UrlRead) => void) => {
  const handle = () => listener(readUrl());
  window.addEventListener("popstate", handle);
  return () => window.removeEventListener("popstate", handle);
};
