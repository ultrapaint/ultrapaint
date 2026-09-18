/**
 * The space's router, on the preview side. It is deliberately not in charge: the editor holds
 * the route in its own URL, so a link pressed inside a page only asks (`ed:navigateTo`) and
 * the page changes when the answer comes back (`ed:route`). A preview opened on its own, with
 * no editor around it, answers itself so that it still clicks through.
 */
import type {
  Mounted,
  PageRoute,
  RouterBridge,
  RouterInput,
  RouterState,
} from "@ultrapaint/framework-api/browser";
import { matchRoute, resolveTarget, routeOf } from "@ultrapaint/shared/route";
import {
  pathInSpace,
  spaceIdOf,
  spaceIdsFrom,
} from "@ultrapaint/shared/space";

interface Host {
  readonly post: (msg: Record<string, unknown>) => void;
  readonly reportError: (error: { message: string; stack?: string }) => void;
  readonly route: string;
  readonly space: string;
  /** No editor around the preview: it holds its own route. */
  readonly standalone: boolean;
}

/** The pages of this space, from the modules the generated entry globbed. */
const routesOf = (input: RouterInput, space: string): PageRoute[] => {
  const spaces = spaceIdsFrom(
    input.spaceFiles.map((key) => key.slice(input.base.length))
  );
  const pages: PageRoute[] = [];
  for (const [key, load] of Object.entries(input.modules)) {
    const designsPath = key.slice(input.base.length);
    if (spaceIdOf(spaces, designsPath) !== space) {
      continue;
    }
    const path = pathInSpace(space, designsPath);
    pages.push({ load, path, route: routeOf(path) });
  }
  return pages.sort((a, b) => a.route.localeCompare(b.route));
};

/** Runs when the preview has nothing better to do, or soon after where that cannot be asked. */
const whenIdle = (task: () => void) => {
  const idle = (
    globalThis as {
      requestIdleCallback?: (callback: () => void) => number;
    }
  ).requestIdleCallback;
  if (idle) {
    idle(task);
  } else {
    setTimeout(task, 0);
  }
};

/**
 * Imports the space's other pages one at a time while the preview is idle, so a navigation
 * finds its page already loaded. One at a time: the page on screen keeps the dev server's
 * attention. A page that fails to import is left to report itself when it is shown.
 */
const preload = (pages: readonly PageRoute[], isCurrent: () => boolean) => {
  const queue = [...pages];
  const next = () => {
    const page = queue.shift();
    if (!(page && isCurrent())) {
      return;
    }
    page
      .load()
      .catch(() => undefined)
      .then(() => whenIdle(next));
  };
  whenIdle(next);
};

export const makeRouter = (host: Host) => {
  let routes: PageRoute[] = [];
  let mounted: Mounted | null = null;
  // Bumped on every start, so a restart (HMR of the entry) drops the preload before it.
  let generation = 0;
  let state: RouterState = { params: {}, route: host.route };
  const listeners = new Set<() => void>();

  const show = () => {
    const match = matchRoute(routes, state.route);
    state = { params: match?.params ?? {}, route: state.route };
    const page = match?.entry ?? null;
    const input = { page, route: state.route };
    if (mounted) {
      mounted.update(input);
    }
    for (const listener of listeners) {
      listener();
    }
    host.post({
      page: page?.path ?? null,
      route: state.route,
      type: "ed:routeChanged",
    });
    return input;
  };

  const setRoute = (route: string) => {
    if (route === state.route) {
      return;
    }
    state = { params: state.params, route };
    show();
  };

  const bridge: RouterBridge = {
    navigate: (to, options) => {
      const route = resolveTarget(to);
      if (host.standalone) {
        setRoute(route);
        return;
      }
      host.post({
        replace: options?.replace ?? false,
        route,
        type: "ed:navigateTo",
      });
    },
    state: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  (window as unknown as { __ED_ROUTER__: RouterBridge }).__ED_ROUTER__ = bridge;

  return {
    navigate: bridge.navigate,
    setRoute,
    start: (input: RouterInput) => {
      routes = routesOf(input, host.space);
      mounted?.unmount();
      const match = matchRoute(routes, state.route);
      state = { params: match?.params ?? {}, route: state.route };
      mounted = input.mount(
        {
          page: match?.entry ?? null,
          providers: input.providers,
          reportError: host.reportError,
          route: state.route,
        },
        input.canvas
      );
      show();
      generation += 1;
      const current = generation;
      preload(
        routes.filter((route) => route !== match?.entry),
        () => current === generation
      );
    },
    state: () => state,
  };
};
