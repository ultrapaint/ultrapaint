/**
 * The editor's own URL is where the router state lives: `?space=marketing&route=/settings`.
 * A prototype can be reloaded, bookmarked and handed to someone else, and the browser's back
 * and forward buttons are the prototype's, because every navigation is a history entry.
 */
import { normaliseRoute } from "@ultrapaint/shared/route";

export interface UrlState {
  route: string;
  space: string | null;
}

export const readUrl = (): UrlState => {
  const params = new URLSearchParams(window.location.search);
  const space = params.get("space");
  const route = params.get("route");
  return {
    route: route === null ? "/" : normaliseRoute(route),
    space,
  };
};

/**
 * `push` for a navigation the user made (a link, a route in the panel), `replace` for state
 * the editor is only catching up with, so back does not walk through it.
 */
export const writeUrl = (state: UrlState, push: boolean) => {
  const params = new URLSearchParams(window.location.search);
  params.set("space", state.space ?? "");
  params.set("route", state.route);
  const url = `${window.location.pathname}?${params.toString()}`;
  if (push && url !== `${window.location.pathname}${window.location.search}`) {
    window.history.pushState(null, "", url);
  } else {
    window.history.replaceState(null, "", url);
  }
};

export const onUrlChange = (listener: (state: UrlState) => void) => {
  const handle = () => listener(readUrl());
  window.addEventListener("popstate", handle);
  return () => window.removeEventListener("popstate", handle);
};
