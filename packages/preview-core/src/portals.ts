/**
 * Popups the page opens (a menu, a dialog, a tooltip) are put by their libraries on the
 * document's body: in an iframe that was the page's own, in the editor's page it is the editor's,
 * outside the frame and its stylesheets. What the preview's own code appends to the body is
 * moved into the frame it was drawn for, and taken out of there again when its library removes
 * it from the body.
 *
 * Who appends is told by the stack: the preview's modules are served under its base, the
 * editor's are not. Which frame is the one that last drew or took input.
 */

const moved = new WeakSet<Node>();
let installed = false;
let target: (() => Element | null) | null = null;
let base = "";

/** This module's own file, whose frames on the stack are the patch, not who called it. */
const OWN = import.meta.url.split("?")[0] ?? "";

/**
 * Whether the call comes from the preview's own modules: its first caller outside this module
 * and the patches' (`patches`, the files of whatever patched the global it reached through).
 * Anything further down the stack does not say: the editor's own React may commit inside a
 * callback of the preview's.
 */
export const calledFromPreview = (patches: readonly string[] = []) => {
  if (base === "") {
    return false;
  }
  const lines = (new Error("who calls").stack ?? "").split("\n");
  const caller =
    lines
      .slice(1)
      .find(
        (line) => !(line.includes(OWN) || patches.some((p) => line.includes(p)))
      ) ?? "";
  return caller.includes(base);
};

/** A stack frame that names a script, not the browser's own code (`at Array.map (<anonymous>)`). */
const SCRIPT_FRAME_RE = /(?:https?:|\/)[^\s)]+:\d+:\d+/;

/** The path the preview's modules are served under; empty until the preview starts. */
export const previewBase = () => base;

/**
 * Whether the preview's code alone is on the stack that called `patched`: its immediate caller
 * is the preview's own, and nothing under it is the editor's. Asked where the editor's own calls
 * may come through the preview's code: an application that wraps a global (`window.fetch`, for
 * its logging) is called by the editor too, and the immediate caller is then the application's.
 */
export const calledOnlyFromPreview = (patched: object) => {
  const v8 = Error as {
    captureStackTrace?: (target: object, above: unknown) => void;
    stackTraceLimit?: number;
  };
  if (base === "" || !v8.captureStackTrace) {
    return false;
  }
  const limit = v8.stackTraceLimit;
  v8.stackTraceLimit = 200;
  const holder: { stack?: string } = {};
  v8.captureStackTrace(holder, patched);
  v8.stackTraceLimit = limit;
  const frames = (holder.stack ?? "")
    .split("\n")
    .slice(1)
    .filter((line) => SCRIPT_FRAME_RE.test(line));
  const [caller] = frames;
  return (
    caller !== undefined &&
    !caller.includes(OWN) &&
    frames.every((line) => line.includes(base))
  );
};

const fromPreview = () => calledFromPreview();

/**
 * Whether the code that called `patched` is the preview's own: its immediate caller, not the
 * first outside the patches. The editor's bundle in the preview (this module's file) calling is
 * the editor's: what it asks for is the editor's business, whoever called it.
 */
export const calledDirectlyFromPreview = (
  patched: (...args: never[]) => unknown
) => {
  const v8 = Error as {
    captureStackTrace?: (target: object, above: unknown) => void;
    stackTraceLimit?: number;
  };
  if (base === "" || !v8.captureStackTrace) {
    return false;
  }
  // One frame is all it reads: capturing the editor's deep stacks whole cost 25 µs a call.
  const limit = v8.stackTraceLimit;
  v8.stackTraceLimit = 1;
  const holder: { stack?: string } = {};
  v8.captureStackTrace(holder, patched);
  v8.stackTraceLimit = limit;
  const caller = holder.stack?.split("\n")[1] ?? "";
  return caller.includes(base) && !caller.includes(OWN);
};

/** A stack's first frame (`at f (url:1:2)`, or `f@url:1:2`): where an error was thrown. */
const FRAME_RE =
  /(?:\bat\s.*?\(?|@)((?:https?:|\/)[^\s)]+?):(\d+):(\d+)\)?\s*$/m;

/** Where in the preview's modules an error was thrown. */
export interface ThrownAt {
  readonly column: number;
  /** As the preview's server names it under its base. */
  readonly file: string;
  /** In the module as it was sent, not its source (`source-lines.ts`). */
  readonly line: number;
  /** The module's address, as the page loaded it. */
  readonly url: string;
}

/**
 * Where an error was thrown when it was in the preview's own modules: the file, as the preview's
 * server names it under its base, and the line; null when it was the editor's.
 */
export const thrownInPreview = (stack: string | undefined): ThrownAt | null => {
  const frame = stack ? FRAME_RE.exec(stack) : null;
  const url = frame?.[1];
  if (base === "" || !url) {
    return null;
  }
  const path = new URL(url, location.href).pathname;
  if (!path.startsWith(base)) {
    return null;
  }
  return {
    column: Number(frame?.[3]),
    file: path.slice(base.length),
    line: Number(frame?.[2]),
    url,
  };
};

type Inserting = (this: Node, ...args: never[]) => unknown;

/**
 * Sends what the preview's modules append to the body into `frame()`'s portal layer, from now
 * on. `servedUnder` is the path every module of the preview is served under.
 */
export const routePortals = (
  servedUnder: string,
  frame: () => Element | null
) => {
  base = servedUnder;
  target = frame;
  if (installed || typeof document === "undefined") {
    return;
  }
  installed = true;
  const { body } = document;
  const redirect = (node: Node): Element | null => {
    if (!(node instanceof Element && fromPreview())) {
      return null;
    }
    const into = target?.() ?? null;
    if (into) {
      moved.add(node);
    }
    return into;
  };
  const appendChild = body.appendChild.bind(body);
  const insertBefore = body.insertBefore.bind(body);
  const append = body.append.bind(body);
  const prepend = body.prepend.bind(body);
  const removeChild = body.removeChild.bind(body);
  Object.assign(body, {
    append(...nodes: (Node | string)[]) {
      const element = nodes.length === 1 ? nodes[0] : undefined;
      const into = element instanceof Node ? redirect(element) : null;
      if (into) {
        into.append(element as Node);
        return;
      }
      append(...nodes);
    },
    appendChild<T extends Node>(node: T): T {
      const into = redirect(node);
      return into ? into.appendChild(node) : appendChild(node);
    },
    insertBefore<T extends Node>(node: T, child: Node | null): T {
      const into = redirect(node);
      return into ? into.appendChild(node) : insertBefore(node, child);
    },
    prepend(...nodes: (Node | string)[]) {
      const element = nodes.length === 1 ? nodes[0] : undefined;
      const into = element instanceof Node ? redirect(element) : null;
      if (into) {
        into.append(element as Node);
        return;
      }
      prepend(...nodes);
    },
    removeChild<T extends Node>(node: T): T {
      if (moved.has(node) && node.parentNode !== body) {
        moved.delete(node);
        node.parentNode?.removeChild(node);
        return node;
      }
      return removeChild(node);
    },
  } satisfies Record<string, Inserting | ((...args: never[]) => unknown)>);
};
