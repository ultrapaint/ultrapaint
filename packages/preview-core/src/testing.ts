/**
 * The preview core under test, in happy-dom: the real `createPreview` with a scripted renderer.
 * When a frame draws, the renderer runs what the test says its page's code does (`page`) and says
 * it drew; the guards are told whose code calls by a recorded stack (`asPage`) rather than the
 * caller's, which in a test is the test's. A test of preview-core and one of the editor's frames
 * draw with the same core this way.
 *
 * For tests only: imported as `@ultrapaint/preview-core/testing`, never by the editor's bundle
 * (`editor.ts`). The guards are installed once per test file, so there is one such preview each.
 */
import type {
  Preview,
  RenderSetup,
  RenderToCanvas,
} from "@ultrapaint/framework-api/browser";
import { createPreview } from "./frame.ts";
import { install } from "./kernel.ts";

const ORIGIN = "http://127.0.0.1:4601";
const BASE = "/preview/";
const BUNDLE = `${ORIGIN}${BASE}@fs/ultrapaint/dist/editor.js`;
const PAGE_MODULE = `${ORIGIN}${BASE}src/preview-module.tsx`;

/** Recorded stacks of whoever calls a patch, the caller first. */
const STACKS = {
  editor: [`    at onKey (${ORIGIN}/assets/index.js:5:5)`],
  page: [
    `    at Page (${PAGE_MODULE}:3:1)`,
    `    at draw (${BUNDLE}?v=3:1:2)`,
    `    at canvas (${ORIGIN}/assets/index.js:5:5)`,
  ],
};

/** What a page's code does as its frame draws. */
export type PageCode = (setup: RenderSetup) => void;

export interface ScriptedPreview {
  /** Runs `f` as the page's code: what it writes or asks, the guards take for the page's. */
  readonly asPage: <T>(f: () => T) => T;
  /** What the page's code does whenever a frame draws, from now on; nothing at first. */
  readonly page: (code: PageCode) => void;
  readonly preview: Preview;
}

let made: ScriptedPreview | null = null;

/** The preview of this test file, made the first time it is asked for. */
export const scriptedPreview = (): ScriptedPreview => {
  if (made) {
    return made;
  }
  let calling: readonly string[] = STACKS.editor;
  const asPage = <T>(f: () => T): T => {
    const before = calling;
    calling = STACKS.page;
    try {
      return f();
    } finally {
      calling = before;
    }
  };
  let code: PageCode = () => undefined;
  // Draws as a renderer does: the page's code runs, then the render has reached the screen.
  const render: RenderToCanvas = (setup) => ({
    render: (request) => {
      code(setup);
      setup.onRendered(request.renderId);
    },
    setComponents: () => undefined,
    unmount: () => undefined,
  });
  install({
    base: BASE,
    ownScript: BUNDLE,
    readModule: () => Promise.reject(new Error("no module in a test")),
    stack: () => ["Error", ...calling].join("\n"),
  });
  const preview = createPreview(render, {
    assets: `${ORIGIN}${BASE}@assets`,
    components: {},
    designsRoot: `${ORIGIN}${BASE}@fs/designs`,
    providers: undefined,
    theme: "light",
  });
  made = {
    asPage,
    page: (next) => {
      code = next;
    },
    preview,
  };
  return made;
};
