/**
 * Whose code is calling: the page's or the editor's. The repository's components run in the
 * editor's own page (ADR 0034), and the guards (`sandbox.ts`, `portals.ts`, `media.ts`,
 * `requests.ts`, `storage.ts`, `document-elements.ts`) treat what the page's code does apart from
 * what the editor's does, told by the stack (docs/PLAN-preview-sandbox.md). This module is that
 * knowledge, once: the path the preview's modules are served under (its base, given when the
 * preview starts), reading a stack, the rule each guard asks by, where an error was thrown, and
 * which modules are the repository's own, which the desktop app asks of a stuck page's stack.
 *
 * One assumption holds it together: the editor's code that runs in the preview (this package, the
 * renderer and the guards) is one file, the editor's bundle (`framework-react-vite/build.ts`: one
 * esbuild entry, no splitting), served under the base as the page's modules are. A stack's frame
 * in that file (`ownScript`) is the editor's wherever it is; any other module under the base is
 * the page's (the repository's own, its dependencies, Vite's); anything else (the editor's app,
 * served from its own origin, and the browser's own code) is the editor's. A bundle split in
 * several files would need `ownScript` to be a list.
 *
 * Stacks are read in V8's format (`    at f (url:1:2)`), and SpiderMonkey's (`f@url:1:2`). The rules
 * that read the code above a patch need V8's `Error.captureStackTrace`: without it they say the
 * editor's, and only `windowCall` tells the page's code.
 */
import { MODULE_MARK } from "@ultrapaint/contracts/page-runtime";
import { mappedLines } from "./source-lines.ts";

/** One frame of a stack, top first. */
export interface StackFrame {
  readonly column: number;
  readonly line: number;
  /** The script's address; null for the browser's own code (`at Array.map (<anonymous>)`). */
  readonly url: string | null;
}

/** Where in the preview's modules an error was thrown. */
export interface ThrownAt {
  readonly column: number;
  /** Its path under the base (`src/page.tsx`), as the preview's server names it. */
  readonly file: string;
  /** In the module as it was sent, not its source (`sourceLine`). */
  readonly line: number;
  /** The module's address, as the page loaded it. */
  readonly url: string;
}

/**
 * The stack of the code that called `above`, its frames from `above`'s caller down, `limit` of
 * them at most, as V8 writes it. The live one is `Error.captureStackTrace`; a test gives a
 * recorded stack instead.
 */
export type StackSource = (above: object, limit: number) => string;

export interface Provenance {
  /** The path every module of the preview is served under: `/preview/`. */
  readonly base: string;
  /**
   * A write to the document's `<html>` or `<body>` by the page's code (a theme class, a scroll
   * lock): its immediate caller (step 10). The editor's own writes there (a drag's cursor) pay the
   * test too, so it reads one frame; the bundle writing is the editor's.
   */
  readonly domWrite: (patched: object) => boolean;
  /**
   * A request `patched` was called for by the page's code (steps 8 and 13), by the whole stack:
   * its caller is the page's, and below it the first code that is not the page's is the editor's
   * bundle (the editor handing the page its work: a frame to draw, a timer, an event) or nothing.
   * The editor's own code found first instead called the page's directly: an application's
   * wrapper of `fetch` (for its logging, Sentry) that the editor's requests go through too, and
   * they stay the editor's.
   */
  readonly request: (patched: object) => boolean;
  /**
   * A timer or an animation frame `patched` was called for by the page's code: its immediate
   * caller, one frame read once per callback. The editor asks for them all the time, and reading
   * its whole stack cost 25 µs a call and 2 points of busy time while frames drew (step 5); what
   * the editor's bundle schedules is the editor's, even when the page's code called it (the
   * registry handing itself over, the renderer drawing): a timer of the editor's held with a
   * parked frame would stall the editor.
   */
  readonly scheduling: (patched: object) => boolean;
  /**
   * The source's line `at` stands for: a stack names the module as the server sent it, after the
   * React plugin and TypeScript, and its inline map takes it back (step 7b, `source-lines.ts`).
   */
  readonly sourceLine: (at: ThrownAt) => Promise<number>;
  /**
   * `localStorage`, `sessionStorage` or IndexedDB asked for by the page's code: its immediate
   * caller, a dependency of the application's included (step 9). Nothing wraps storage for the
   * editor, so one frame says, and the bundle asking is the editor's.
   */
  readonly storage: (patched: object) => boolean;
  /**
   * Where an error was thrown when it was in the preview's modules (step 2): its stack's first
   * frame that names a script, under the base; null when it was the editor's.
   */
  readonly thrownAt: (stack: string | undefined) => ThrownAt | null;
  /**
   * The page's code reaching the window or the document through a patch: a listener or an `on*`
   * handler on them, `scroll` and `history`, the head and the title, a popup put on the body
   * (`portals.ts`), the window's size and `matchMedia` (`media.ts`). Its first caller outside the
   * editor's bundle: it is asked from inside the patch, which may be several of the bundle's
   * frames deep (the head's `appendChild` asking through what it holds aside), and only that
   * caller says, as the editor's own React may commit inside a callback of the page's: what lies
   * further down does not (docs/PLAN-preview-sandbox.md, step 1).
   */
  readonly windowCall: () => boolean;
}

export interface ProvenanceOptions {
  /** The path the preview's modules are served under, ending in `/`; empty: nothing is the page's. */
  readonly base: string;
  /** The editor's bundle; this module's own file by default, the bundle it is built into. */
  readonly ownScript?: string | undefined;
  /** Reads a module again, for its map; `fetch` by default (the browser has it cached). */
  readonly readModule?: ((url: string) => Promise<string>) | undefined;
  /** Reads the stack; `Error.captureStackTrace` by default. */
  readonly stack?: StackSource | undefined;
}

/** A line of a stack that is a frame, not the error's message: V8's `at …`, SpiderMonkey's `…@`. */
const FRAME_LINE_RE = /^\s*at\s|^[^\s@]*@/;
/** A frame's script and position: `at f (url:1:2)`, `at url:1:2`, `f@url:1:2`. */
const LOCATION_RE =
  /(?:^\s*at\s+(?:async\s+)?(?:.*?\()?|@)((?:[a-z][\w+.-]*:|\/)\S*?):(\d+):(\d+)\)?\s*$/i;
const QUERY_RE = /[?#].*$/;

/** How far the first caller outside the bundle is looked for, as `new Error()` would. */
const FIRST_CALLER_FRAMES = 10;
/** How much of a stack the request rule reads: down to where the editor handed over. */
const WHOLE_STACK_FRAMES = 200;

/** A stack's frames, top first, read as they are needed. */
const framesOf = function* (stack: string): Generator<StackFrame> {
  for (const text of stack.split("\n")) {
    if (!FRAME_LINE_RE.test(text)) {
      continue;
    }
    const found = text.match(LOCATION_RE);
    yield found
      ? {
          column: Number(found[3]),
          line: Number(found[2]),
          url: found[1] ?? null,
        }
      : { column: 0, line: 0, url: null };
  }
};

/** A stack's frames, top first: the error's message left out, the browser's own frames kept. */
export const readStack = (stack: string): StackFrame[] => [...framesOf(stack)];

/** A script's address without its query (Vite's `?v=`, `?t=`) or hash. */
const scriptOf = (url: string) => url.replace(QUERY_RE, "");

/** The path of a frame's script: an address's, or a path as it is (Node writes paths). */
const pathOf = (url: string): string | null => {
  if (url.startsWith("/")) {
    return scriptOf(url);
  }
  try {
    return new URL(url).pathname;
  } catch {
    // Not an address (`<anonymous>`): no module of the preview's.
    return null;
  }
};

/** The path of `url` under `base` (`src/page.tsx`), or null when it is not served under it. */
export const fileUnder = (url: string, base: string): string | null => {
  const path = pathOf(url);
  if (base === "" || path === null || !path.startsWith(base)) {
    return null;
  }
  const file = path.slice(base.length);
  try {
    return decodeURIComponent(file);
  } catch {
    // An escape that does not decode: the path as it was sent.
    return file;
  }
};

/** Under the base, the modules that are never the repository's: its dependencies', Vite's. */
const NOT_REPOSITORY_RE =
  /\/node_modules\/|\/\.vite\/|\/@(?:vite|id)\/|\/@react-refresh/;

/**
 * Whether the module at `url` may be the repository's own, by its address: under the base, and
 * not a dependency's (`node_modules`, Vite's prebundled cache) or the dev server's (`@vite`,
 * `@id`, React's refresh runtime). A module served from outside the root (`@fs`) may be either:
 * a library of the repository's, or the editor's generated entry and bundle; its code says
 * (`isRepositoryModule`).
 */
export const isRepositoryUrl = (url: string, base: string): boolean => {
  const path = pathOf(url);
  return fileUnder(url, base) !== null && !NOT_REPOSITORY_RE.test(path ?? "");
};

/**
 * Whether the module at `url`, whose code is `code`, is the repository's own: its server says,
 * with `MODULE_MARK`, which it puts first in every module of the repository's and in no other
 * (`framework-react-vite/guard-code.ts`, which `guardedKind` decides by the module's file).
 */
export const isRepositoryModule = (
  url: string,
  code: string,
  base: string
): boolean => isRepositoryUrl(url, base) && code.includes(MODULE_MARK);

/** The live stack: V8's, above `above`; without it, a new error's, which starts here. */
const liveStack: StackSource = (above, limit) => {
  const v8 = Error as {
    captureStackTrace?: (target: object, above: unknown) => void;
    stackTraceLimit?: number;
  };
  if (!v8.captureStackTrace) {
    return new Error("who calls").stack ?? "";
  }
  const before = v8.stackTraceLimit;
  v8.stackTraceLimit = limit;
  const holder: { stack?: string } = {};
  v8.captureStackTrace(holder, above);
  v8.stackTraceLimit = before;
  return holder.stack ?? "";
};

const fetchText = (url: string) =>
  fetch(url).then((response) => (response.ok ? response.text() : ""));

/** The rules of whose code calls, for the preview served under `base`. */
export const createProvenance = ({
  base,
  ownScript = scriptOf(import.meta.url),
  readModule = fetchText,
  stack = liveStack,
}: ProvenanceOptions): Provenance => {
  const own = (frame: StackFrame) =>
    frame.url !== null && scriptOf(frame.url) === ownScript;
  const served = (frame: StackFrame) =>
    frame.url !== null && fileUnder(frame.url, base) !== null;
  /** The page's own code: under the base, not the editor's bundle. */
  const page = (frame: StackFrame | undefined) =>
    frame !== undefined && served(frame) && !own(frame);

  const windowCall = () => {
    if (base === "") {
      return false;
    }
    for (const frame of framesOf(stack(windowCall, FIRST_CALLER_FRAMES))) {
      if (!own(frame)) {
        return page(frame);
      }
    }
    return false;
  };

  const immediateCaller = (patched: object) => {
    if (base === "") {
      return false;
    }
    const [caller] = framesOf(stack(patched, 1));
    return page(caller);
  };

  const request = (patched: object) => {
    if (base === "") {
      return false;
    }
    const scripts = readStack(stack(patched, WHOLE_STACK_FRAMES)).filter(
      (frame) => frame.url !== null
    );
    if (!page(scripts[0])) {
      return false;
    }
    for (const frame of scripts) {
      if (own(frame)) {
        return true;
      }
      if (!served(frame)) {
        return false;
      }
    }
    return true;
  };

  const thrownAt = (thrown: string | undefined): ThrownAt | null => {
    for (const { column, line, url } of framesOf(thrown ?? "")) {
      if (url !== null) {
        const file = fileUnder(url, base);
        return file === null ? null : { column, file, line, url };
      }
    }
    return null;
  };

  const lines = mappedLines(readModule);

  return {
    base,
    domWrite: immediateCaller,
    request,
    scheduling: immediateCaller,
    sourceLine: (at) => lines(at.url, at.line, at.column),
    storage: immediateCaller,
    thrownAt,
    windowCall,
  };
};
