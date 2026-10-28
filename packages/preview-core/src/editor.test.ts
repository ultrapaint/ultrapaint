// @vitest-environment happy-dom
import {
  pageRuntime,
  RELOAD_GLOBAL,
  STYLES_GLOBAL,
} from "@ultrapaint/contracts/page-runtime";
import type {
  DevServerEvents,
  DevServerHot,
  EditorEntry,
  RenderToCanvas,
} from "@ultrapaint/framework-api/browser";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { editorBundle } from "./editor.ts";

const render: RenderToCanvas = (setup) => ({
  render: (request) => setup.onRendered(request.renderId),
  setComponents: () => undefined,
  unmount: () => undefined,
});

/** The dev server's events, as the generated entry's `import.meta.hot` has them. */
const listeners = new Map<string, (payload: never) => void>();
const hot: DevServerHot = {
  on: (event, listener) => {
    listeners.set(event, listener);
  },
};
const emit = <E extends keyof DevServerEvents>(
  event: E,
  payload: DevServerEvents[E]
) =>
  (listeners.get(event) as ((p: DevServerEvents[E]) => void) | undefined)?.(
    payload
  );

/** What was in place when the page's modules ran. */
const whenModulesRan: { guards?: boolean; hooks?: boolean } = {};
const ownAddEventListener = window.addEventListener;
let started: EditorEntry;

beforeAll(async () => {
  started = await editorBundle(render).startPreview(() => {
    whenModulesRan.hooks = pageRuntime()[STYLES_GLOBAL] !== undefined;
    whenModulesRan.guards = window.addEventListener !== ownAddEventListener;
    return Promise.resolve({
      default: {
        assets: "/preview/@assets",
        components: {},
        designsRoot: "/preview/@fs/designs",
        providers: undefined,
        theme: "light",
      },
    });
  }, hot);
});

describe("the editor bundle's start-up", () => {
  it("installs the hooks before the page's modules run, and the guards after", () => {
    expect(whenModulesRan).toEqual({ guards: false, hooks: true });
    expect(window.addEventListener).not.toBe(ownAddEventListener);
  });

  it("tells every frame of the dev server's updates and errors", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const events = { error: vi.fn(), hmr: vi.fn() };
    const frame = started.preview.mountFrame(host, {
      canvas: "canvas",
      events,
      frame: "a",
    });
    emit("vite:afterUpdate", {});
    expect(events.hmr).toHaveBeenCalledOnce();
    emit("vite:error", {
      err: { id: "/src/card.tsx", loc: { line: 3 }, message: "Unexpected" },
    });
    expect(events.error).toHaveBeenCalledWith({
      file: "/src/card.tsx",
      line: 3,
      message: "Unexpected",
    });
    frame.unmount();
  });

  it("hands the dev server's reload to the editor's page", () => {
    const reload = vi.fn();
    const stop = started.onReloadRequest(reload);
    pageRuntime()[RELOAD_GLOBAL]?.();
    expect(reload).toHaveBeenCalledOnce();
    stop();
  });
});
