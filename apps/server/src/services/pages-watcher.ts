/**
 * The pages service's watcher. Whatever writes to the designs directory, an agent, a checkout or
 * another editor, the editors hear of it: a page or design file changed, a canvas's layout, and
 * the page list when pages or canvases come or go.
 */

import {
  COMPONENT_EXTENSION,
  COMPONENTS_DIR,
} from "@ultrapaint/contracts/component-names";
import {
  DESIGN_NOTES_FILE,
  DESIGN_SYSTEM_FILE,
} from "@ultrapaint/contracts/design-system";
import { IMPLEMENTATION_FILE } from "@ultrapaint/contracts/implementation";
import { SKILL_EXTENSION, SKILLS_DIR } from "@ultrapaint/contracts/skills";
import { isPageFile } from "@ultrapaint/design-document/tree";
import {
  CANVAS_FILE,
  CANVASES_FILE,
  ROOT_CANVAS,
} from "@ultrapaint/shared/canvas";
import { Effect, type FileSystem, Stream } from "effect";
import { hashContent, toPosix } from "../hash.ts";
import { IGNORED_DIRS } from "./pages-layout.ts";
import type { PagesReading } from "./pages-reading.ts";

const SEGMENT_RE = /[\\/]/;

/** Forks, into the layer's scope, the fibres that watch the designs directory while it exists. */
export const watchDesigns = Effect.fnUntraced(function* (
  reading: PagesReading
) {
  const {
    events,
    exists,
    fs,
    path,
    paths,
    publishList,
    readCanvas,
    relativeToDesigns,
    root,
  } = reading;

  const lastHash = new Map<string, string>();
  /** What each canvas.json said about its canvas, so a change of name re-reads the list. */
  const lastInfo = new Map<string, string>();

  const onCanvasChanged = Effect.fnUntraced(function* (abs: string) {
    const dir = relativeToDesigns(path.dirname(abs));
    const canvas = dir === "." ? ROOT_CANVAS : dir;
    // An invalid or vanished canvas.json is reported when the editor asks for it. Here it
    // must not end the watcher, so defects are caught along with failures.
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

  /** A document written by someone else: an agent, a checkout, an editor. */
  const onFileChanged = Effect.fnUntraced(function* (abs: string) {
    // Give a non-atomic writer a moment to finish before hashing.
    yield* Effect.sleep("60 millis");
    const content = yield* Effect.option(fs.readFileString(abs));
    const hash = content._tag === "None" ? "" : hashContent(content.value);
    if (lastHash.get(abs) === hash) {
      return;
    }
    // A file gone is forgotten: page files come and go with every rename and delete.
    if (hash === "") {
      lastHash.delete(abs);
    } else {
      lastHash.set(abs, hash);
    }
    yield* events.publish("file.changed", {
      file: paths.relative(abs),
      hash,
    });
  });

  /**
   * One change handled, whatever happens to it: a file that vanished or cannot be read
   * mid-way is logged, and the watcher goes on to the next change.
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

  const watched = fs.watch(root, { recursive: true }).pipe(
    Stream.filter(
      (event) =>
        !event.path.split(SEGMENT_RE).some((seg) => IGNORED_DIRS.has(seg))
    ),
    Stream.broadcast({ capacity: "unbounded", replay: 0 })
  );

  if (yield* exists(root)) {
    const stream = yield* watched;
    // Additions and removals, of pages or whole canvases, change the page list. They are
    // gathered while they keep coming and judged once they stop, against the list sent
    // last: by then the server's own change has usually sent its list already.
    const arrived: FileSystem.WatchEvent[] = [];
    yield* stream.pipe(
      Stream.filter((event) => event._tag !== "Update"),
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
      Effect.ignore({ log: true }),
      Effect.forkScoped
    );
    yield* stream.pipe(
      Stream.mapEffect(
        (event) => {
          const abs = path.resolve(root, event.path);
          const name = path.basename(abs);
          if (name === CANVAS_FILE) {
            return survive(
              Effect.andThen(onCanvasChanged(abs), onFileChanged(abs))
            );
          }
          if (name === CANVASES_FILE && path.dirname(abs) === root) {
            return survive(publishList);
          }
          const watchedFile =
            isPageFile(name) ||
            (path.dirname(abs) === root &&
              (name === DESIGN_SYSTEM_FILE || name === DESIGN_NOTES_FILE)) ||
            (path.dirname(abs) === path.join(root, SKILLS_DIR) &&
              name.endsWith(SKILL_EXTENSION)) ||
            // Components and the implementation link (ADRs 0030, 0041).
            (path.dirname(abs) === path.join(root, COMPONENTS_DIR) &&
              name.endsWith(COMPONENT_EXTENSION)) ||
            (path.dirname(abs) === root && name === IMPLEMENTATION_FILE);
          return watchedFile ? survive(onFileChanged(abs)) : Effect.void;
        },
        { concurrency: "unbounded" }
      ),
      Stream.runDrain,
      Effect.ignore({ log: true }),
      Effect.forkScoped
    );
  }
});
