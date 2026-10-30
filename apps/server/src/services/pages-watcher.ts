/**
 * The pages service's part of the designs' changes. Whatever writes to the designs directory, an
 * agent, a checkout or another editor, the editors hear of it: a canvas's layout, and the page
 * list when pages or canvases come or go. The files themselves are heard of by `DesignFiles`.
 */

import { isPageFile } from "@ultrapaint/design-document/tree";
import { CANVAS_FILE, ROOT_CANVAS } from "@ultrapaint/shared/canvas";
import { Effect, type FileSystem, Stream } from "effect";
import { toPosix } from "../hash.ts";
import { DesignFiles } from "./design-files.ts";
import type { PagesReading } from "./pages-reading.ts";

/** Forks, into the layer's scope, the fibres that follow the designs' changes for the pages. */
export const watchDesigns = Effect.fnUntraced(function* (
  reading: PagesReading
) {
  const { events, fs, path, paths, publishList, readCanvas, root } = reading;
  const designFiles = yield* DesignFiles;

  /** What each canvas.json said about its canvas, so a change of name re-reads the list. */
  const lastInfo = new Map<string, string>();

  const onCanvasChanged = Effect.fnUntraced(function* (file: string) {
    const dir = toPosix(
      path.relative(root, path.dirname(path.resolve(paths.root, file)))
    );
    const canvas = dir === "." || dir === "" ? ROOT_CANVAS : dir;
    // An invalid or vanished canvas.json is reported when the editor asks for it. Here it
    // must not end the subscription, so defects are caught along with failures.
    const layout = yield* Effect.exit(readCanvas(canvas));
    if (layout._tag === "Success") {
      yield* events.publish("canvas", { canvas, layout: layout.value });
      const { home, name, routes, variants } = layout.value;
      const info = JSON.stringify({ home, name, routes, variants });
      if (lastInfo.get(canvas) !== info) {
        lastInfo.set(canvas, info);
        yield* publishList;
      }
    }
  });

  /**
   * One change handled, whatever happens to it: a file that vanished or cannot be read
   * mid-way is logged, and the next change is still heard.
   */
  const survive = <A, E>(effect: Effect.Effect<A, E>) =>
    effect.pipe(
      Effect.asVoid,
      Effect.catchCause((cause) =>
        Effect.logWarning("a change to the designs was not handled", cause)
      )
    );

  /**
   * Whether a file appearing or going may change the page list. Writes through a temporary
   * file and a rename, the server's own and an editor's, make a file appear that was there
   * all along and a temporary one come and go, and a PNG drawn beside a page is no page:
   * none of them is worth a walk of the designs. Anything unsure of is a change.
   */
  const changesList = Effect.fnUntraced(function* (
    event: FileSystem.WatchEvent
  ) {
    const published = reading.published();
    if (published === null) {
      return true;
    }
    const rel = toPosix(event.path);
    const name = path.basename(rel);
    const listed = name === CANVAS_FILE || isPageFile(name);
    if (event._tag === "Remove") {
      // What is gone cannot be asked what it was: only a file that is surely no page and
      // no directory of pages is let go.
      const passing = name.endsWith(".tmp") || name.endsWith(".page.png");
      return (
        listed ||
        !passing ||
        [...published.files].some((file) => file.startsWith(`${rel}/`))
      );
    }
    if (published.files.has(rel)) {
      return false;
    }
    const info = yield* Effect.option(fs.stat(path.resolve(root, rel)));
    // Gone again already, like a temporary file: its removal is judged on its own.
    if (info._tag === "None") {
      return false;
    }
    return info.value.type === "Directory" || listed;
  });

  // Additions and removals, of pages or whole canvases, change the page list. They are
  // gathered while they keep coming and judged once they stop, against the list sent last:
  // by then the server's own change has usually sent its list already.
  const arrived: FileSystem.WatchEvent[] = [];
  yield* designFiles.comings.pipe(
    Stream.tap((event) => Effect.sync(() => arrived.push(event))),
    Stream.debounce("80 millis"),
    Stream.runForEach(() =>
      survive(
        Effect.gen(function* () {
          for (const event of arrived.splice(0)) {
            if (yield* changesList(event)) {
              yield* publishList;
              return;
            }
          }
        })
      )
    ),
    Effect.forkScoped
  );
  yield* designFiles.changes(["canvas", "canvases"]).pipe(
    Stream.runForEach(({ file, kind }) =>
      survive(kind === "canvas" ? onCanvasChanged(file) : publishList)
    ),
    Effect.forkScoped
  );
});
