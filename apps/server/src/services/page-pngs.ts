import type { ForbiddenPath } from "@ultrapaint/contracts/errors";
import {
  type CanvasLayout,
  type Page,
  presetSize,
} from "@ultrapaint/contracts/pages";
import {
  Context,
  Effect,
  FileSystem,
  Layer,
  Option,
  Path,
  Stream,
} from "effect";
import { makeWriteAtomic } from "../atomic-write.ts";
import { EventBus } from "../events.ts";
import { makeStamp } from "../file-stamp.ts";
import { makeWalk } from "../fs-walk.ts";
import { hashContent } from "../hash.ts";
import { readPngText, withPngText } from "../png-text.ts";
import { DesignSystemService } from "./design-system.ts";
import { DocumentService } from "./documents.ts";
import { PagesService } from "./pages.ts";
import { RepoPaths } from "./repo-paths.ts";
import { Screenshots } from "./screenshots.ts";

/** The text chunk a page's PNG says what it was drawn from in. */
const KEYWORD = "ultrapaint";
/** Bumped when what goes into the key, or how a page is drawn, changes: every PNG is redrawn. */
const DRAWING = "2";
const PAGE_SUFFIX = ".page.json";
const PNG_SUFFIX = ".page.png";

/** `orders.page.json` is drawn into `orders.page.png`, beside it. */
const pngFileOf = (pageFile: string) =>
  `${pageFile.slice(0, -PAGE_SUFFIX.length)}${PNG_SUFFIX}`;

/** What one pass did. */
interface PngRefresh {
  readonly drawn: readonly string[];
  readonly removed: readonly string[];
  /** Pages whose PNG is out of date and could not be drawn: no editor was open to draw them. */
  readonly stale: readonly string[];
}

const NOTHING: PngRefresh = { drawn: [], removed: [], stale: [] };

/** Forgets what was read of whatever is not there any more. */
const keepOnly = <A>(read: Map<string, A>, there: ReadonlySet<string>) => {
  for (const key of read.keys()) {
    if (!there.has(key)) {
      read.delete(key);
    }
  }
};

/**
 * A PNG of every page beside its file, when the project's `pagePngs` setting says so: a picture
 * of each screen that anyone browsing the repository sees, and that a pull request shows as an
 * image diff.
 *
 * The server has no browser, so the pictures are drawn by an open editor's preview, at the size
 * of the page's frame, with the design's look (its components and design system). Each PNG
 * carries the key of what it was drawn from — the page's file, the design system, the frame's size and the
 * theme — and is drawn again only when that changes: a page that did not change is never
 * rewritten, so it never shows up as a change. A page changed while no editor is open keeps its
 * old picture until one opens. A PNG this service wrote whose page is gone is removed; a PNG it
 * did not write is never touched.
 *
 * A pass follows every change to the designs, so it reads only what was written since the one
 * before: a page's file and a PNG are each known by their stamp (`makeStamp`), and one that was
 * not written costs a `stat`.
 */
export class PagePngs extends Context.Service<
  PagePngs,
  {
    /** Draws the pages whose PNG is missing or out of date, and removes those of pages gone. */
    readonly refresh: Effect.Effect<PngRefresh, ForbiddenPath>;
  }
>()("ultrapaint/server/PagePngs") {
  static readonly layer = Layer.effect(
    PagePngs,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const paths = yield* RepoPaths;
      const pages = yield* PagesService;
      const documents = yield* DocumentService;
      const designSystem = yield* DesignSystemService;
      const screenshots = yield* Screenshots;
      const events = yield* EventBus;
      const writeAtomic = makeWriteAtomic(fs, path);
      const walk = makeWalk(fs, path);
      const { settings } = paths;

      const stampOf = makeStamp(fs);
      /** The key each PNG carries, null for none, as it was read when the file had this stamp. */
      const keysRead = new Map<
        string,
        { readonly key: string | null; readonly stamp: string }
      >();
      /** What each page's file hashed to, as it was read when the file had this stamp. */
      const pagesRead = new Map<
        string,
        { readonly hash: string; readonly stamp: string }
      >();

      const keyOf = Effect.fnUntraced(function* (absPng: string) {
        // Stamped before it is read: a write made meanwhile is seen by the next pass.
        const stamp = yield* stampOf([absPng]);
        const known = keysRead.get(absPng);
        if (known?.stamp === stamp) {
          return known.key;
        }
        const bytes = yield* Effect.option(fs.readFile(absPng));
        const key = Option.isSome(bytes)
          ? readPngText(bytes.value, KEYWORD)
          : null;
        keysRead.set(absPng, { key, stamp });
        return key;
      });

      /** The page as its file has it now; none for a file that does not read as a page. */
      const pageOf = Effect.fnUntraced(function* (page: Page) {
        const state = yield* Effect.option(documents.get(page.id));
        // A page that does not read keeps its last picture; the editor reports the page.
        return Option.isSome(state) && state.value.root?.type === "page"
          ? Option.some({ hash: state.value.hash, root: state.value.root })
          : Option.none();
      });

      /** The hash of the page's file, read only when the file was written since; null as `pageOf`. */
      const hashOf = Effect.fnUntraced(function* (page: Page) {
        const stamp = yield* stampOf([yield* paths.resolve(page.file)]);
        const known = pagesRead.get(page.id);
        if (known?.stamp === stamp) {
          return known.hash;
        }
        const read = yield* pageOf(page);
        if (Option.isNone(read)) {
          pagesRead.delete(page.id);
          return null;
        }
        pagesRead.set(page.id, { hash: read.value.hash, stamp });
        return read.value.hash;
      });

      /** PNGs this service wrote whose page is not there any more. */
      const removeOrphans = Effect.fnUntraced(function* (
        wanted: ReadonlySet<string>
      ) {
        const designsDir = yield* paths.resolve(settings.designsDir);
        const found = yield* walk(designsDir, {
          includeFile: (name) => name.endsWith(PNG_SUFFIX),
          skipDir: (name) => name.startsWith(".") || name === "node_modules",
        });
        keepOnly(keysRead, new Set([...wanted, ...found]));
        const removed: string[] = [];
        for (const abs of found) {
          if (wanted.has(abs) || (yield* keyOf(abs)) === null) {
            continue;
          }
          yield* Effect.ignore(fs.remove(abs), { log: true });
          removed.push(paths.relative(abs));
        }
        return removed;
      });

      const refresh = Effect.fn("PagePngs.refresh")(function* () {
        if (!settings.pagePngs) {
          return NOTHING;
        }
        const { pages: all } = yield* pages.list;
        const system = yield* designSystem.get;
        const context = hashContent(
          JSON.stringify([DRAWING, system.designSystem])
        );
        const layouts = new Map<string, CanvasLayout | null>();
        const layoutOf = Effect.fnUntraced(function* (canvas: string) {
          if (!layouts.has(canvas)) {
            const read = yield* Effect.option(pages.readCanvas(canvas));
            layouts.set(canvas, Option.getOrNull(read));
          }
          return layouts.get(canvas) ?? null;
        });

        /** The size the page is drawn at, and the key of a PNG drawn from a file of this hash. */
        const drawingOf = Effect.fnUntraced(function* (page: Page) {
          const layout = yield* layoutOf(page.canvas);
          const frame = layout?.frames[page.path] ?? presetSize.desktop;
          // The canvas's page defaults draw on every page of it (its fill, its type).
          const keyFor = (hash: string) =>
            hashContent(
              `${context}:${hash}:${frame.width}x${frame.height}:${JSON.stringify(layout?.defaults ?? null)}`
            );
          return { frame, keyFor };
        });

        /** How the page's PNG is drawn, when it is not of the page as it is; null when it is. */
        const outdated = Effect.fnUntraced(function* (
          page: Page,
          absPng: string
        ) {
          const hash = yield* hashOf(page);
          if (hash === null) {
            return null;
          }
          const drawing = yield* drawingOf(page);
          return (yield* keyOf(absPng)) === drawing.keyFor(hash)
            ? null
            : drawing;
        });

        /** Draws the page into its PNG: whether it was, or no picture came (`stale`). */
        const draw = Effect.fnUntraced(function* (
          page: Page,
          absPng: string,
          { frame, keyFor }: Effect.Success<ReturnType<typeof drawingOf>>
        ) {
          // Read as it is drawn: the picture and its key are of the same file.
          const now = yield* pageOf(page);
          if (Option.isNone(now)) {
            return "kept" as const;
          }
          const picture = yield* Effect.option(
            screenshots.capture({
              canvas: page.canvas,
              height: frame.height,
              mode: "page",
              root: now.value.root,
              width: frame.width,
            })
          );
          if (Option.isNone(picture)) {
            return "stale" as const;
          }
          yield* Effect.orDie(
            writeAtomic(
              absPng,
              withPngText(picture.value, KEYWORD, keyFor(now.value.hash))
            )
          );
          return "drawn" as const;
        });

        keepOnly(pagesRead, new Set(all.map((page) => page.id)));
        const wanted = new Set<string>();
        const drawn: string[] = [];
        const stale: string[] = [];
        for (const page of all) {
          const absPng = yield* paths.resolve(pngFileOf(page.file));
          wanted.add(absPng);
          const drawing = yield* outdated(page, absPng);
          if (drawing === null) {
            continue;
          }
          // Whatever stopped one page from being drawn stops the rest: they wait for the next pass.
          const outcome =
            stale.length > 0 ? "stale" : yield* draw(page, absPng, drawing);
          if (outcome === "stale") {
            stale.push(page.file);
          } else if (outcome === "drawn") {
            drawn.push(pngFileOf(page.file));
          }
        }
        const removed = yield* removeOrphans(wanted);
        return { drawn, removed, stale } satisfies PngRefresh;
      });

      const pass = refresh().pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("page PNGs not refreshed", cause)
        )
      );

      if (settings.pagePngs) {
        // Whatever can change a picture, and an editor arriving that can draw what is waiting.
        yield* Stream.mergeAll(
          [
            Stream.as(events.subscribe("document"), true),
            Stream.as(events.subscribe("canvas"), true),
            Stream.as(events.subscribe("pages"), true),
            Stream.as(events.subscribe("designSystem"), true),
            Stream.map(screenshots.editors, (n) => n > 0),
          ],
          { concurrency: "unbounded" }
        ).pipe(
          Stream.filter((wanted) => wanted),
          Stream.debounce("1500 millis"),
          Stream.runForEach(() => pass),
          Effect.forkScoped
        );
      }

      return PagePngs.of({ refresh: refresh() });
    })
  );
}
