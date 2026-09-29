/**
 * The editor's own URL is where the router state lives: `?space=marketing&route=/settings`.
 * A prototype can be reloaded, bookmarked and handed to someone else, and the browser's back
 * and forward buttons are the prototype's, because every navigation is a history entry.
 * The workspace rides along as `?mode=design`, so a reload comes back to the same one.
 */
import { normaliseRoute } from "@ultrapaint/shared/route";

export interface UrlState {
  route: string;
  space: string | null;
}

/** What a parameter means when it is absent, so it is left out rather than written. */
const defaults: Record<string, string> = { mode: "vibe", route: "/" };

export const readUrl = (): UrlState & {
  mode: string | null;
  settings: string | null;
} => {
  const params = new URLSearchParams(window.location.search);
  const space = params.get("space");
  const route = params.get("route");
  return {
    mode: params.get("mode"),
    route: route === null ? "/" : normaliseRoute(route),
    // The section of the settings page when it is open: `?settings=repository`.
    settings: params.get("settings"),
    space: space === "" ? null : space,
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

/** Records the workspace; switching it is not a navigation, so back does not undo it. */
export const writeMode = (mode: string) =>
  writeQuery((params) => params.set("mode", mode), false);

/**
 * `push` for a navigation the user made (a link, a route in the panel), `replace` for state
 * the editor is only catching up with, so back does not walk through it.
 */
export const writeUrl = (state: UrlState, push: boolean) =>
  writeQuery((params) => {
    params.set("space", state.space ?? "");
    params.set("route", state.route);
  }, push);

export const onUrlChange = (listener: (state: UrlState) => void) => {
  const handle = () => listener(readUrl());
  window.addEventListener("popstate", handle);
  return () => window.removeEventListener("popstate", handle);
};
