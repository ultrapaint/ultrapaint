/**
 * Where the page's thread was when the window ended it for being stuck (`main.ts`). Chrome reads
 * the stack of the script that holds the thread, as it would for a crash report the page opts
 * into (`Document-Policy: include-js-call-stacks-in-crash-reports`): it costs nothing until then.
 * The stack names modules as the preview's server sent them; the first of the repository's own
 * (`preview-core/provenance.ts`, as the guards tell them) is followed back to its source through
 * the map the module carries inline (`source-lines.ts`).
 */
import {
  fileUnder,
  isRepositoryModule,
  isRepositoryUrl,
  readStack,
} from "@ultrapaint/preview-core/provenance";
import {
  inlineMapOf,
  sourceLineIn,
} from "@ultrapaint/preview-core/source-lines";

/** How many of the stack's modules are read before giving up on finding the repository's. */
const MOST_READ = 8;

/**
 * The repository's line the stack stopped in, as `src/page.tsx:12`: its first frame in a module
 * the preview's server marks as the repository's, by the module's path under `base` (the path the
 * preview is served under) and the source's line. Undefined when no frame is (the editor's own
 * code, a dependency's alone).
 */
export const stoppedAt = async (
  stack: string,
  read: (url: string) => Promise<string>,
  base: string
): Promise<string | undefined> => {
  const frames = readStack(stack)
    .flatMap((f) =>
      f.url !== null && isRepositoryUrl(f.url, base)
        ? [{ column: f.column, line: f.line, url: f.url }]
        : []
    )
    .slice(0, MOST_READ);
  const urls = [...new Set(frames.map((f) => f.url))];
  // A module that cannot be read says nothing: another frame's may.
  const codes = await Promise.all(urls.map((url) => read(url).catch(() => "")));
  const code = new Map(urls.map((url, i) => [url, codes[i] ?? ""]));
  const frame = frames.find((f) =>
    isRepositoryModule(f.url, code.get(f.url) ?? "", base)
  );
  const file = frame && fileUnder(frame.url, base);
  if (!(frame && file)) {
    return undefined;
  }
  const map = inlineMapOf(code.get(frame.url) ?? "");
  const line =
    (map && sourceLineIn(map, frame.line, frame.column)) ?? frame.line;
  return `${file}:${line}`;
};
