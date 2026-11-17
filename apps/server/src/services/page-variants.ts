/**
 * Page variants from before ADR 0098 folded into variations. A page variant is a `@name` file
 * beside its page whose name is no state of its canvas's (`pricing@bold.page.json`): it becomes
 * the variation Bold of the page's root, in the page's `.variations.json`. One whose page is
 * missing becomes the page itself, its drawing as Original named after the variant.
 *
 * Read, a page's variants are its variations at once (`of`), so the editor, the prototype and the
 * agents never see them as pages. Written, they are folded once, as one undo step and history
 * point (`fold`): when a project whose settings are saved opens, or with the first change that
 * saves an unsaved session's settings (ADR 0092). A session that never saves folds nothing.
 */
import type { DesignNode } from "@ultrapaint/contracts/document";
import {
  type CanvasLayout,
  emptyCanvasLayout,
} from "@ultrapaint/contracts/pages";
import {
  ORIGINAL,
  ORIGINAL_ID,
  type VariationSets,
  variationsFileOf,
} from "@ultrapaint/contracts/variations";
import {
  findNode,
  isPageFile,
  PAGE_EXTENSION,
} from "@ultrapaint/design-document/tree";
import {
  CANVAS_FILE,
  canvasIdOf,
  pathInCanvas,
  ROOT_CANVAS,
} from "@ultrapaint/shared/canvas";
import { basename, humanise } from "@ultrapaint/shared/path";
import { basePathOf, suffixOf } from "@ultrapaint/shared/route";
import { Context, Effect, FileSystem, Layer, Path } from "effect";
import { AppLog } from "../app-log.ts";
import { makeWalk } from "../fs-walk.ts";
import { toPosix } from "../hash.ts";
import { CanvasFiles } from "./canvas-files.ts";
import { CommentsService } from "./comments.ts";
import { parseDocument } from "./document-file.ts";
import { EditService, type EditTransaction, updateFile } from "./edit.ts";
import { canvasIdsIn, IGNORED_DIRS, isFoldedVariant } from "./pages-layout.ts";
import { RepoPaths } from "./repo-paths.ts";
import { Storage } from "./storage.ts";
import {
  type PageVariant,
  variationsCodec,
  withPageVariants,
  writeSets,
} from "./variations-file.ts";

/** Whether a canvas.json's text lists page variants: a `variants` list with names in it. */
const listsVariants = (text: string): boolean => {
  try {
    const parsed: unknown = JSON.parse(text);
    const variants =
      typeof parsed === "object" && parsed !== null && "variants" in parsed
        ? parsed.variants
        : null;
    return Array.isArray(variants) && variants.length > 0;
  } catch {
    // Text that is no JSON lists nothing: the layout's own reading says what is wrong with it.
    return false;
  }
};

/** A thing's set with its original alone, in use. */
const ORIGINAL_SET = { inUse: ORIGINAL_ID, variations: [ORIGINAL] } as const;

/** The sets with the original of a thing named `name`, the set made when it has none. */
const originalNamed = (
  sets: VariationSets,
  node: string,
  name: string
): VariationSets => {
  const set = sets[node] ?? ORIGINAL_SET;
  return {
    ...sets,
    [node]: {
      ...set,
      variations: set.variations.map((v) =>
        v.id === ORIGINAL_ID ? { ...v, name } : v
      ),
    },
  };
};

/** A page variant's file, by its path in the designs directory, and the page it is of. */
interface VariantFile {
  readonly base: string;
  readonly canvas: string;
  readonly file: string;
  readonly name: string;
  /** Its page is missing: the variant becomes the page. */
  readonly orphan: boolean;
}

export class PageVariants extends Context.Service<
  PageVariants,
  {
    /** Folds every page variant into its page's variations, as one undo step. */
    readonly fold: Effect.Effect<void>;
    /** A page's variants, by its document, as they are on disk now; none for most pages. */
    readonly of: (doc: string) => Effect.Effect<readonly PageVariant[]>;
  }
>()("ultrapaint/server/PageVariants") {
  static readonly layer = Layer.effect(
    PageVariants,
    Effect.gen(function* () {
      const paths = yield* RepoPaths;
      const edit = yield* EditService;
      const canvasFiles = yield* CanvasFiles;
      const storage = yield* Storage;
      const log = yield* AppLog;
      const comments = yield* CommentsService;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const walk = makeWalk(fs, path);
      const root = paths.designsDir;
      const repoFile = (rel: string) => paths.relative(path.join(root, rel));

      /** The designs' page files and canvases, by their path in the designs directory. */
      const designFiles = Effect.map(
        walk(root, {
          includeFile: (name) => name === CANVAS_FILE || isPageFile(name),
          skipDir: (name) =>
            IGNORED_DIRS.has(name) ||
            name.startsWith(".") ||
            name.startsWith("_"),
        }),
        (found) => found.map((abs) => toPosix(path.relative(root, abs)))
      );

      /**
       * A canvas's layout as its file is now: an empty one when it has none, null when it does not
       * read, whose states are then not known.
       */
      const layoutRead = (
        canvas: string
      ): Effect.Effect<CanvasLayout | null> => {
        const abs = path.join(root, canvas, CANVAS_FILE);
        return fs.readFileString(abs).pipe(
          Effect.flatMap((text) => canvasFiles.read(paths.relative(abs), text)),
          Effect.map((read): CanvasLayout | null => read.layout),
          Effect.catchTag("PlatformError", (error) =>
            // No canvas.json: a canvas with no states. Any other failure: one not known.
            Effect.succeed(
              error.reason._tag === "NotFound" ? emptyCanvasLayout() : null
            )
          ),
          // A layout that does not decode: its states are not known.
          Effect.catchTag("Conflict", () => Effect.succeed(null))
        );
      };

      /** Every page variant of the designs: those beside their page, and those without one. */
      const variantFiles = Effect.gen(function* () {
        const files = yield* designFiles;
        const ids = canvasIdsIn(files);
        const explicit = ids.length === 1 && ids[0] === ROOT_CANVAS ? [] : ids;
        const all = new Set(files);
        const found: VariantFile[] = [];
        for (const file of files) {
          const name = suffixOf(file);
          const canvas = canvasIdOf(explicit, file);
          if (name === null || canvas === null || !isPageFile(basename(file))) {
            continue;
          }
          const layout = yield* layoutRead(canvas);
          // Its states not known, a `@name` file may be one: nothing of the canvas is folded.
          if (layout === null || (layout.states ?? []).includes(name)) {
            continue;
          }
          const base = basePathOf(file);
          found.push({ base, canvas, file, name, orphan: !all.has(base) });
        }
        return found;
      });

      /** A variant's page, as its file draws it now; null when it does not read. */
      const variantOf = <E>(text: Effect.Effect<string | null, E>) =>
        text.pipe(
          // A file gone or unreadable draws no page: the variant is left as it is.
          Effect.orElseSucceed(() => null),
          Effect.flatMap((read) =>
            read === null
              ? Effect.succeed(null)
              : Effect.map(parseDocument(read), (parsed) =>
                  "root" in parsed ? parsed.root : null
                )
          )
        );

      const of = Effect.fn("PageVariants.of")(function* (doc: string) {
        if (!isPageFile(doc) || suffixOf(doc) !== null) {
          return [];
        }
        const dir = path.dirname(path.join(root, doc));
        const stem = basename(doc).slice(0, -PAGE_EXTENSION.length);
        const names = yield* fs.readDirectory(dir).pipe(
          // A page whose folder cannot be listed has no variants to read: it is read as it is.
          Effect.orElseSucceed((): string[] => [])
        );
        const files = new Set(
          names.map((n) => toPosix(path.relative(root, path.join(dir, n))))
        );
        const variants: PageVariant[] = [];
        for (const name of names) {
          const rel = toPosix(path.relative(root, path.join(dir, name)));
          const suffix = suffixOf(name);
          if (suffix === null || !name.startsWith(`${stem}@`)) {
            continue;
          }
          const layout = yield* layoutRead(yield* canvasOfFile(rel));
          // Its canvas's states not known, a `@name` file may be one: it is read as a page.
          if (layout === null || !isFoldedVariant(rel, files, layout)) {
            continue;
          }
          // Through the repository's paths: a link out of it reads as no page.
          const page = yield* variantOf(
            Effect.flatMap(paths.resolve(path.join(root, rel)), (abs) =>
              fs.readFileString(abs)
            )
          );
          if (page) {
            variants.push({ file: repoFile(rel), name: suffix, root: page });
          }
        }
        return variants;
      });

      /** The canvas a designs file is in: the nearest folder above it with a `canvas.json`. */
      const canvasOfFile = Effect.fnUntraced(function* (rel: string) {
        let dir = path.dirname(rel);
        while (dir !== "." && dir !== "") {
          if (
            yield* fs.exists(path.join(root, dir, CANVAS_FILE)).pipe(
              // A folder that cannot be looked into is no canvas.
              Effect.orElseSucceed(() => false)
            )
          ) {
            return toPosix(dir);
          }
          dir = path.dirname(dir);
        }
        return "";
      });

      /**
       * One page's variants folded into its variations: the first that reads of those without
       * their page becomes the page, its drawing the original named after it, and the others of
       * it its variations. Only what reads is folded, a variant that does not left as it is and
       * logged. Answers with the variants folded.
       */
      const foldPage = Effect.fnUntraced(function* (
        tx: EditTransaction,
        variants: readonly VariantFile[]
      ) {
        const read: {
          readonly file: VariantFile;
          readonly root: DesignNode;
        }[] = [];
        for (const v of variants) {
          const drawn = yield* variantOf(tx.read(repoFile(v.file)));
          if (drawn) {
            read.push({ file: v, root: drawn });
          } else {
            yield* log.log(
              "server",
              "warn",
              `${v.file} does not read: left as it is, not folded into variations`
            );
          }
        }
        const [first] = read;
        if (!first) {
          return [];
        }
        const pageFile = repoFile(first.file.base);
        const { orphan } = first.file;
        if (orphan) {
          yield* tx.move(repoFile(first.file.file), pageFile);
        }
        const page = orphan ? first.root : yield* variantOf(tx.read(pageFile));
        if (page === null) {
          return [];
        }
        const rest = orphan ? read.slice(1) : read;
        // A variant's own variations go with it: the sets of the nodes it draws, kept by the
        // page once it is a variation of it. One with sets of its whole drawing, of a node the
        // page draws too, or of one the page has sets of already, is left as it is: a set's
        // choice would be read of the page's node, not of the variant's.
        const sidecarOf = (v: VariantFile) =>
          variationsFileOf(repoFile(v.file));
        const setsOf = (file: string) =>
          tx.readDocument(file, variationsCodec(file));
        const setsFile = variationsFileOf(pageFile);
        let merged = orphan
          ? yield* setsOf(sidecarOf(first.file))
          : yield* setsOf(setsFile);
        const foldable: typeof rest = [];
        for (const v of rest) {
          const own = yield* setsOf(sidecarOf(v.file));
          const clash = Object.keys(own).filter(
            (id) =>
              id === page.id || id in merged || findNode(page, id) !== null
          );
          if (clash.length > 0) {
            yield* log.log(
              "server",
              "warn",
              `${v.file.file} has variations of ${clash.join(", ")}, which its page has too: left as it is, not folded`
            );
            continue;
          }
          merged = { ...merged, ...own };
          foldable.push(v);
        }
        const folded = withPageVariants(
          merged,
          page.id,
          foldable.map((v) => ({ name: v.file.name, root: v.root }))
        );
        yield* writeSets(
          tx,
          setsFile,
          orphan
            ? originalNamed(folded, page.id, humanise(first.file.name))
            : folded
        );
        if (orphan) {
          yield* tx.remove(sidecarOf(first.file));
        }
        for (const v of foldable) {
          yield* tx.remove(repoFile(v.file.file));
          yield* tx.remove(sidecarOf(v.file));
        }
        return [...(orphan ? [first] : []), ...foldable].map((v) => v.file);
      });

      /** A canvas's comments on its folded variants, on their page now: the same screen. */
      const moveComments = (
        tx: EditTransaction,
        canvas: string,
        here: readonly VariantFile[]
      ) => {
        const pageOf = new Map(
          here.map((v) => [
            pathInCanvas(canvas, v.file),
            pathInCanvas(canvas, v.base),
          ])
        );
        return comments.rewrite(tx, canvas, (all) =>
          all.map((c) => {
            const page = c.page === null ? undefined : pageOf.get(c.page);
            return page === undefined ? c : { ...c, page };
          })
        );
      };

      /** A canvas's layout without its variants' frames, and their list: a variant's frame was its. */
      const dropFrames = (
        tx: EditTransaction,
        canvas: string,
        here: readonly VariantFile[]
      ) => {
        const file = repoFile(path.join(canvas, CANVAS_FILE));
        return updateFile(tx, file, canvasFiles.codec(file), (layout) => {
          const frames = { ...layout.frames };
          for (const v of here) {
            const at = pathInCanvas(canvas, v.file);
            const frame = frames[at];
            delete frames[at];
            // A variant without its page is the page now, in its frame.
            if (v.orphan && frame) {
              frames[pathInCanvas(canvas, v.base)] ??= frame;
            }
          }
          return { ...layout, frames };
        }).pipe(
          // A layout that does not read keeps its frames; the next change reads it again.
          Effect.catchTag("Conflict", () => Effect.void)
        );
      };

      /** The canvases whose `canvas.json` still lists page variants (`variants`, ADR 0019). */
      const listingVariants = Effect.gen(function* () {
        const ids = canvasIdsIn(yield* designFiles);
        const listing: string[] = [];
        for (const id of ids) {
          const text = yield* fs
            .readFileString(path.join(root, id, CANVAS_FILE))
            .pipe(
              // A canvas without its file, or whose file does not read, lists nothing.
              Effect.orElseSucceed(() => "")
            );
          if (listsVariants(text) && (yield* layoutRead(id)) !== null) {
            listing.push(id);
          }
        }
        return listing;
      });

      const fold = Effect.gen(function* () {
        const folded = yield* edit.transaction(
          "Fold page variants into variations",
          (tx) =>
            Effect.gen(function* () {
              // Found under the journal's lock: a state drawn meanwhile is a state, not folded.
              const found = yield* variantFiles;
              const listing = yield* listingVariants;
              const byBase = new Map<string, VariantFile[]>();
              for (const v of found) {
                byBase.set(v.base, [...(byBase.get(v.base) ?? []), v]);
              }
              const done: VariantFile[] = [];
              for (const variants of byBase.values()) {
                done.push(...(yield* foldPage(tx, variants)));
              }
              const canvases = new Set([
                ...done.map((v) => v.canvas),
                ...listing,
              ]);
              for (const canvas of canvases) {
                const here = done.filter((v) => v.canvas === canvas);
                yield* dropFrames(tx, canvas, here);
                yield* moveComments(tx, canvas, here);
              }
              return done;
            })
        );
        if (folded.length > 0) {
          yield* log.log(
            "server",
            "info",
            `folded ${folded.length} page variant${folded.length === 1 ? "" : "s"} into variations (ADR 0098)`
          );
        }
      }).pipe(
        // A design that does not fold stays as it is read: its variants still read as variations,
        // and the project opens all the same.
        Effect.catch((error) =>
          log.log(
            "server",
            "warn",
            `page variants could not be folded: ${error.message}`
          )
        ),
        Effect.withSpan("PageVariants.fold")
      );

      // Settings kept: folded as the project opens. An unsaved session folds with its first
      // change's save (`ProjectManager.changed`), and one that never saves never does.
      const target = yield* storage.target;
      if (target.mode !== "ephemeral") {
        yield* fold;
      }

      return PageVariants.of({ fold, of });
    })
  );
}
