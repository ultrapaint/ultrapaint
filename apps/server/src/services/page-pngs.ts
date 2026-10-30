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
export interface PngRefresh {
  readonly drawn: readonly string[];
  readonly removed: readonly string[];
  /** Pages whose PNG is out of date and could not be drawn: no editor was open to draw them. */
  readonly stale: readonly string[];
}

const NOTHING: PngRefresh = { drawn: [], removed: [], stale: [] };

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

      const keyOf = (absPng: string) =>
        Effect.map(Effect.option(fs.readFile(absPng)), (bytes) =>
          Option.isSome(bytes) ? readPngText(bytes.value, KEYWORD) : null
        );

      /** PNGs this service wrote whose page is not there any more. */
      const removeOrphans = Effect.fnUntraced(function* (
        wanted: ReadonlySet<string>
      ) {
        const designsDir = yield* paths.resolve(settings.designsDir);
        const found = yield* walk(designsDir, {
          includeFile: (name) => name.endsWith(PNG_SUFFIX),
          skipDir: (name) => name.startsWith(".") || name === "node_modules",
        });
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

        /** What the page's PNG should be drawn from, or null when it cannot be drawn. */
        const drawingOf = Effect.fnUntraced(function* (page: Page) {
          const state = yield* Effect.option(documents.get(page.id));
          // A page that does not read keeps its last picture; the editor reports the page.
          const root = Option.isSome(state) ? state.value.root : null;
          if (Option.isNone(state) || root?.type !== "page") {
            return null;
          }
          const layout = yield* layoutOf(page.canvas);
          const frame = layout?.frames[page.path] ?? presetSize.desktop;
          // The canvas's page defaults draw on every page of it (its fill, its type).
          const key = hashContent(
            `${context}:${state.value.hash}:${frame.width}x${frame.height}:${JSON.stringify(layout?.defaults ?? null)}`
          );
          return { frame, key, root };
        });

        const wanted = new Set<string>();
        const drawn: string[] = [];
        const stale: string[] = [];
        for (const page of all) {
          const absPng = yield* paths.resolve(pngFileOf(page.file));
          wanted.add(absPng);
          const drawing = yield* drawingOf(page);
          if (drawing === null || (yield* keyOf(absPng)) === drawing.key) {
            continue;
          }
          // Whatever stopped one page from being drawn stops the rest: they wait for the next pass.
          const picture =
            stale.length > 0
              ? null
              : yield* Effect.option(
                  screenshots.capture({
                    canvas: page.canvas,
                    height: drawing.frame.height,
                    mode: "page",
                    root: drawing.root,
                    width: drawing.frame.width,
                  })
                );
          if (picture === null || Option.isNone(picture)) {
            stale.push(page.file);
            continue;
          }
          yield* Effect.orDie(
            writeAtomic(
              absPng,
              withPngText(picture.value, KEYWORD, drawing.key)
            )
          );
          drawn.push(pngFileOf(page.file));
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
