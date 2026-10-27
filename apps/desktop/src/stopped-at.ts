/**
 * Where the page's thread was when the window ended it for being stuck (`main.ts`). Chrome reads
 * the stack of the script that holds the thread, as it would for a crash report the page opts
 * into (`Document-Policy: include-js-call-stacks-in-crash-reports`): it costs nothing until then.
 * The stack names modules as the preview's server sent them; the first of the repository's own
 * is followed back to its source through the map the module carries inline (`source-lines.ts`).
 */
import {
  inlineMapOf,
  sourceLineIn,
} from "@ultrapaint/preview-core/source-lines";

/** A stack's frame that names a module: `at f (url:1:2)`, or `at url:1:2`. */
const FRAME_RE = /(https?:\/\/[^\s()]+?):(\d+):(\d+)\)?$/;
/** Modules that are never the repository's own: its dependencies, Vite's. */
const NOT_SOURCE_RE =
  /\/node_modules\/|\/\.vite\/|\/@(?:vite|id)\/|@react-refresh/;
/** What the preview's server puts first in every module of the repository's (`guard-code.ts`). */
const SOURCE_MARK = "__edModuleStarts(";
/** How many of the stack's modules are read before giving up on finding the repository's. */
const MOST_READ = 8;

/** The modules a stack's frames name, top first, with the line and column of each. */
export const stackFrames = (stack: string) =>
  stack.split("\n").flatMap((line) => {
    const [, url = "", at = "", column = ""] =
      line.trim().match(FRAME_RE) ?? [];
    return url === "" || NOT_SOURCE_RE.test(url)
      ? []
      : [{ column: Number(column), line: Number(at), url }];
  });

/**
 * The repository's line the stack stopped in, as `src/page.tsx:12`: its first frame in a module
 * the preview's server marks as the repository's, by the module's path under the server's base and
 * the source's line. Undefined when no frame is (the editor's own code, a dependency's alone).
 */
export const stoppedAt = async (
  stack: string,
  read: (url: string) => Promise<string>
): Promise<string | undefined> => {
  const frames = stackFrames(stack).slice(0, MOST_READ);
  const urls = [...new Set(frames.map((f) => f.url))];
  // A module that cannot be read says nothing: another frame's may.
  const codes = await Promise.all(urls.map((url) => read(url).catch(() => "")));
  const code = new Map(urls.map((url, i) => [url, codes[i] ?? ""]));
  const frame = frames.find((f) => code.get(f.url)?.includes(SOURCE_MARK));
  if (!frame) {
    return undefined;
  }
  const map = inlineMapOf(code.get(frame.url) ?? "");
  const line =
    (map && sourceLineIn(map, frame.line, frame.column)) ?? frame.line;
  // The path under the base: `/preview/src/page.tsx` is `src/page.tsx`.
  const file = new URL(frame.url).pathname.split("/").slice(2).join("/");
  return `${decodeURIComponent(file)}:${line}`;
};
