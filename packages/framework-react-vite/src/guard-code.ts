/**
 * The repository's own code, made to say when it holds the editor's thread
 * (docs/PLAN-preview-sandbox.md, second round). Its components run on the editor's thread
 * (ADR 0034), where a loop that never ends stops the editor for good:
 *
 * - every loop's body starts with a check that throws once the thread has been held 2.5 s, an
 *   error shown on its frame as any other is, where the editor would have frozen;
 * - every `async` function notes the frame it was called for, and marks what it rejects with
 *   it: a rejection carries nothing of where it came from, and is told to its frame by that mark;
 * - its top-level code says when it starts and ends: what it adds to the window while it runs (a
 *   listener, an interval) is that version of the module's, taken off when Vite runs a newer
 *   one (`preview-core/hmr-leftovers.ts`). Each update ran it again and stacked another.
 *
 * Applied to the repository's modules after they are JavaScript, and the loop check alone to its
 * dependencies (a loop there stops the editor as well, React's own on a component that renders
 * itself). Edits insert text and never a line, so the lines of the stacks and of the source maps
 * stay right.
 */

import {
  GUARD_GLOBAL,
  GUARD_MEMBERS,
  MODULE_MARK,
  MODULE_MARK_NAME,
} from "@ultrapaint/contracts/page-runtime";

/** The module the inserted code imports what it calls from. */
export const GUARD_ID = "virtual:ultrapaint/guard";

/** How long the thread may be held, in the code's loops, before they throw. */
const LIMIT_MS = 2500;

/** The guard's side in the page, read as each call is made: the preview defines it once there. */
const GUARD = `globalThis.${GUARD_GLOBAL}`;

/**
 * The module itself, served as is. The loop check counts, and reads the clock every 1024
 * iterations: the time is the time since the first check of the task, which a message on a
 * channel of its own ends (a message is not held back in a tab in the background, as a timer is,
 * and is not run before an endless chain of microtasks ends). A loop of the repository's that
 * threw throws at once if it runs again in the same task, so a loop that catches what it calls
 * ends too; any other gets its own 2.5 s. A dependency's loop (numbered 0) never throws at once:
 * React runs its work loop again to draw the error's boundary, for every frame. The frame is the
 * preview's to say, once it is there.
 */
export const GUARD_MODULE = `const LIMIT_MS = ${LIMIT_MS};
let calls = 0;
let start = 0;
let armed = false;
const stopped = new Set();
const channel = new MessageChannel();
channel.port1.onmessage = () => {
  armed = false;
  stopped.clear();
};
function stop(id) {
  if (id !== 0) stopped.add(id);
  start = performance.now();
  const error = new Error("Stopped a loop that held the editor for ${LIMIT_MS / 1000} s");
  error.name = "LoopError";
  Error.captureStackTrace?.(error, loop);
  throw error;
}
export function loop(id) {
  if (stopped.size > 0 && stopped.has(id)) stop(id);
  calls = (calls + 1) | 0;
  if ((calls & 1023) !== 0) return;
  const now = performance.now();
  if (!armed) {
    armed = true;
    start = now;
    channel.port2.postMessage(null);
  } else if (now - start > LIMIT_MS) {
    stop(id);
  }
}
export function moduleStarts(url) {
  ${GUARD}?.${GUARD_MEMBERS.moduleStarts}(url);
}
export function moduleEnds(url) {
  ${GUARD}?.${GUARD_MEMBERS.moduleEnds}(url);
}
export const frame = () => ${GUARD}?.${GUARD_MEMBERS.frame}() ?? null;
export function mark(error, frame) {
  if (frame !== null && error !== null && typeof error === "object") {
    ${GUARD}?.${GUARD_MEMBERS.mark}(error, frame);
  }
  return error;
}
`;

/** Modules the guard is put in: JavaScript and what becomes it. */
const SOURCE_RE = /\.(?:[cm]?[jt]sx?)$/;
/** Dependencies: under `node_modules`, or prebundled into Vite's cache (in the generated directory). */
const DEPENDENCY_RE = /\/node_modules\/|\/\.vite\/deps\//;
/** Vite's own client and React's refresh runtime: the dev server's, not the application's. */
const SERVER_CODE_RE =
  /\/node_modules\/(?:vite|@vitejs)\/|\/@vite\/|@react-refresh/;

/**
 * What the guard does to module `id`: all of it to the repository's (`source`), its loops to a
 * dependency's; nothing to what is not JavaScript, to the dev server's own code, or to what lies
 * in `editorDirs` (the generated modules and our bundles, each ending in `/`). The server's side of
 * "is this the page's code": the module it calls `source` is the one it marks, which the browser's
 * side and the desktop app take for the repository's (`preview-core/provenance.ts`).
 */
export const guardedKind = (
  id: string,
  editorDirs: readonly string[]
): "dependency" | "source" | null => {
  const file = (id.split("?")[0] ?? id).replaceAll("\\", "/");
  if (
    id.startsWith("\0") ||
    !SOURCE_RE.test(file) ||
    SERVER_CODE_RE.test(file)
  ) {
    return null;
  }
  if (DEPENDENCY_RE.test(file)) {
    return "dependency";
  }
  return editorDirs.some((d) => file.startsWith(d)) ? null : "source";
};

/** Whether a module may hold anything to guard: most hold neither a loop nor `async`. */
export const MAY_GUARD_RE = /\b(?:async|do|for|while)\b/;

/** Whether a dependency may hold a loop, the only thing guarded in one. */
export const MAY_LOOP_RE = /\b(?:do|for|while)\b/;

/** An ESTree node, as Rollup's and Rolldown's parsers give it: with its offsets. */
interface Node {
  readonly end: number;
  readonly start: number;
  readonly type: string;
  readonly [key: string]: unknown;
}

interface Edit {
  readonly at: number;
  /** How deep the node is: of two edits at one place, the inner closes first and opens last. */
  readonly depth: number;
  readonly opens: boolean;
  readonly text: string;
}

const LOOPS = new Set([
  "DoWhileStatement",
  "ForInStatement",
  "ForOfStatement",
  "ForStatement",
  "WhileStatement",
]);
const FUNCTIONS = new Set([
  "ArrowFunctionExpression",
  "FunctionDeclaration",
  "FunctionExpression",
]);

const isNode = (value: unknown): value is Node =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { type?: unknown }).type === "string" &&
  typeof (value as { start?: unknown }).start === "number";

const children = function* (node: Node): Generator<Node> {
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (isNode(item)) {
          yield item;
        }
      }
    } else if (isNode(value)) {
      yield value;
    }
  }
};

const CATCH = "}catch(__edE){throw __edMark(__edE,__edF)}";

/** Puts `opening` at the start of `body` and `closing` at its end, braced if it is not a block. */
const wrapBody = (
  body: Node,
  depth: number,
  opening: string,
  closing: string
): Edit[] =>
  body.type === "BlockStatement"
    ? [
        { at: body.start + 1, depth, opens: true, text: opening },
        { at: body.end - 1, depth, opens: false, text: closing },
      ]
    : [
        { at: body.start, depth, opens: true, text: `{${opening}` },
        { at: body.end, depth, opens: false, text: `${closing}}` },
      ];

const edits = (program: Node, nextId: () => number, markAsync: boolean) => {
  const found: Edit[] = [];
  let loops = false;
  let asyncs = false;
  const visit = (node: Node, depth: number) => {
    if (LOOPS.has(node.type) && isNode(node.body)) {
      loops = true;
      found.push(...wrapBody(node.body, depth, `__edLoop(${nextId()});`, ""));
    } else if (
      markAsync &&
      FUNCTIONS.has(node.type) &&
      node.async === true &&
      node.generator !== true &&
      isNode(node.body)
    ) {
      asyncs = true;
      const { body } = node;
      const entry = "const __edF=__edFrame();try{";
      found.push(
        ...(body.type === "BlockStatement"
          ? wrapBody(body, depth, entry, CATCH)
          : [
              // `return await`: a promise returned as it is would reject outside the `try`.
              {
                at: body.start,
                depth,
                opens: true,
                text: `{${entry}return await(`,
              },
              { at: body.end, depth, opens: false, text: `)${CATCH}}` },
            ])
      );
    }
    for (const child of children(node)) {
      visit(child, depth + 1);
    }
  };
  visit(program, 0);
  return { asyncs, found, loops };
};

/**
 * `code` with its loops checked and, unless told otherwise, its `async` functions marking what
 * they reject and its top-level code saying when it starts and ends (a dependency's are not: it
 * is not edited, and its rejections reach the repository's own functions); null when there is
 * nothing to do. `program` is `code` parsed, or null when it holds neither a loop nor `async`;
 * `nextId` numbers the loops apart, across modules.
 */
export const guardCode = (
  code: string,
  program: unknown,
  nextId: () => number,
  {
    markAsync = true,
    markModule = true,
  }: { readonly markAsync?: boolean; readonly markModule?: boolean } = {}
): string | null => {
  const { asyncs, found, loops } = isNode(program)
    ? edits(program, nextId, markAsync)
    : { asyncs: false, found: [], loops: false };
  if (found.length === 0 && !markModule) {
    return null;
  }
  found.sort(
    (a, b) =>
      a.at - b.at ||
      Number(a.opens) - Number(b.opens) ||
      (a.opens ? a.depth - b.depth : b.depth - a.depth)
  );
  const names = [
    ...(loops ? ["loop as __edLoop"] : []),
    ...(asyncs ? ["frame as __edFrame", "mark as __edMark"] : []),
    ...(markModule
      ? [`moduleStarts as ${MODULE_MARK_NAME}`, "moduleEnds as __edModuleEnds"]
      : []),
  ];
  // On the first line, before the code: no line moves. Imports are hoisted: the call runs as the
  // module's own code starts, after what it imports.
  let out = `import{${names.join(",")}}from"${GUARD_ID}";${markModule ? `${MODULE_MARK}import.meta.url);` : ""}`;
  let from = 0;
  for (const edit of found) {
    out += code.slice(from, edit.at) + edit.text;
    from = edit.at;
  }
  out += code.slice(from);
  // After the last line: a line comment there ends with it.
  return markModule ? `${out}\n;__edModuleEnds(import.meta.url);` : out;
};
