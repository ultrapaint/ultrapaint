import type { EditResult } from "@ultrapaint/contracts/edit";
import { BadRequest, ForbiddenPath } from "@ultrapaint/contracts/errors";
import {
  type AddImageInput,
  CANVAS_ASSETS_DIR,
  CANVAS_ITEMS_DIR,
  type CanvasItemResult,
  type CreateItemInput,
  type ExtractItemInput,
  type FrameLayout,
  type Page,
  type PlaceItemInput,
  type RemoveItemInput,
} from "@ultrapaint/contracts/pages";
import { humanise } from "@ultrapaint/shared/path";
import { routeOf } from "@ultrapaint/shared/route";
import { pathInSpace } from "@ultrapaint/shared/space";
import { Context, Effect, FileSystem, Layer, Path, Semaphore } from "effect";
import { toPosix } from "../hash.ts";
import {
  type EditFailure,
  EditService,
  type EditTransaction,
  unresolvedWarning,
} from "./edit.ts";
import { ProjectFramework } from "./framework.ts";
import { PagesService } from "./pages.ts";
import { RepoPaths } from "./repo-paths.ts";

/** Images a browser shows, by the extension they are saved under. */
const IMAGE_EXTENSIONS = new Set([
  "avif",
  "gif",
  "jpeg",
  "jpg",
  "png",
  "svg",
  "webp",
]);
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

/**
 * The canvas items of a space: components and images placed on the canvas beside the pages.
 * Each is a module in the space's `_canvas` directory whose default export renders it, so the
 * preview shows it with the design system and the editor edits it like a page. Every call here
 * is one undo step: the item's module, its place in the layout and whatever a page gave up or
 * took in go together.
 */
export class CanvasItems extends Context.Service<
  CanvasItems,
  {
    readonly addImage: (
      input: AddImageInput
    ) => Effect.Effect<CanvasItemResult, EditFailure>;
    readonly create: (
      input: CreateItemInput
    ) => Effect.Effect<CanvasItemResult, EditFailure>;
    /** Makes an item of an element of a page, which leaves the page unless `copy`. */
    readonly extract: (
      input: ExtractItemInput
    ) => Effect.Effect<CanvasItemResult, EditFailure>;
    /** Puts what an item renders into a page; the item goes unless `copy`. */
    readonly place: (
      input: PlaceItemInput
    ) => Effect.Effect<EditResult, EditFailure>;
    /** Deletes the item's module. An image it showed stays: a page may have taken it in. */
    readonly remove: (
      input: RemoveItemInput
    ) => Effect.Effect<void, EditFailure>;
  }
>()("ultrapaint/server/CanvasItems") {
  static readonly layer = Layer.effect(
    CanvasItems,
    Effect.gen(function* () {
      const paths = yield* RepoPaths;
      const framework = yield* ProjectFramework;
      const edit = yield* EditService;
      const layouts = yield* PagesService;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const { pages } = framework;
      // Two items made at once would pick the same free name.
      const naming = yield* Semaphore.make(1);

      const exists = (p: string) =>
        Effect.orElseSucceed(fs.exists(p), () => false);

      const spaceDir = (space: string) => path.join(paths.designsDir, space);

      /** A base name no item and no asset of the space uses yet. */
      const freeBase = Effect.fnUntraced(function* (
        space: string,
        name: string,
        assetExtension?: string
      ) {
        const slug = pages.fileName(name).slice(0, -pages.extension.length);
        const taken = (candidate: string) =>
          Effect.map(
            Effect.all([
              exists(
                path.join(
                  spaceDir(space),
                  CANVAS_ITEMS_DIR,
                  `${candidate}${pages.extension}`
                )
              ),
              assetExtension
                ? exists(
                    path.join(
                      spaceDir(space),
                      CANVAS_ASSETS_DIR,
                      `${candidate}.${assetExtension}`
                    )
                  )
                : Effect.succeed(false),
            ]),
            ([item, asset]) => item || asset
          );
        let base = slug;
        let n = 2;
        while (yield* taken(base)) {
          base = `${slug}-${n}`;
          n += 1;
        }
        return base;
      });

      const itemOf = (space: string, abs: string, name: string): Page => {
        const id = toPosix(path.relative(paths.designsDir, abs));
        const inSpace = pathInSpace(space, id);
        return {
          file: paths.relative(abs),
          id,
          name,
          path: inSpace,
          route: routeOf(inSpace),
          space,
        };
      };

      const itemFile = (space: string, base: string) =>
        paths.resolve(
          path.join(
            spaceDir(space),
            CANVAS_ITEMS_DIR,
            `${base}${pages.extension}`
          )
        );

      /** Writes the item's module and puts it on the canvas, inside the caller's action. */
      const place = Effect.fnUntraced(function* (
        tx: EditTransaction,
        space: string,
        abs: string,
        content: string,
        frame: FrameLayout
      ) {
        yield* tx.create(paths.relative(abs), content);
        const item = itemOf(
          space,
          abs,
          humanise(path.basename(abs, pages.extension))
        );
        yield* layouts.updateCanvas(tx, space, (layout) => ({
          ...layout,
          items: { ...layout.items, [item.path]: frame },
        }));
        return item;
      });

      const create = Effect.fn("CanvasItems.create")(function* ({
        frame,
        imports,
        jsx,
        name,
        space,
      }: CreateItemInput) {
        const item = yield* naming.withPermits(1)(
          Effect.gen(function* () {
            const abs = yield* itemFile(space, yield* freeBase(space, name));
            return yield* edit.transaction(`Add ${name}`, (tx) =>
              place(
                tx,
                space,
                abs,
                pages.renderItem({
                  declarations: [],
                  fileName: path.basename(abs),
                  imports,
                  jsx,
                }),
                frame
              )
            );
          })
        );
        return { item, warnings: [] } satisfies CanvasItemResult;
      });

      const extract = Effect.fn("CanvasItems.extract")(function* ({
        copy,
        frame,
        source,
        space,
      }: ExtractItemInput) {
        if (!paths.isEditable(source.file)) {
          return yield* new ForbiddenPath({
            message: `${source.file} is outside the designs directory`,
          });
        }
        const { content } = yield* edit.read(source.file);
        const lift = (destination: string) =>
          Effect.try({
            catch: (error) =>
              new BadRequest({
                message: `${source.file}: ${error instanceof Error ? error.message : String(error)}`,
              }),
            try: () => framework.source.extract(content, source, destination),
          });
        // Named after the element; the imports are rebased on the file the name picks.
        const { name } = yield* lift(source.file);
        return yield* naming.withPermits(1)(
          Effect.gen(function* () {
            const abs = yield* itemFile(space, yield* freeBase(space, name));
            const lifted = yield* lift(paths.relative(abs));
            const label = `${copy ? "Copy" : "Move"} ${name} onto the canvas`;
            const item = yield* edit.transaction(label, (tx) =>
              Effect.gen(function* () {
                const placed = yield* place(
                  tx,
                  space,
                  abs,
                  pages.renderItem({
                    declarations: lifted.declarations,
                    fileName: path.basename(abs),
                    imports: lifted.imports,
                    jsx: lifted.jsx,
                  }),
                  frame
                );
                if (!copy) {
                  yield* tx.apply({ kind: "delete", target: source });
                }
                return placed;
              })
            );
            return {
              item,
              warnings: unresolvedWarning(lifted, source.file),
            } satisfies CanvasItemResult;
          })
        );
      });

      const addImage = Effect.fn("CanvasItems.addImage")(function* ({
        data,
        frame,
        name,
        space,
      }: AddImageInput) {
        const extension = name.includes(".")
          ? name.split(".").at(-1)?.toLowerCase()
          : undefined;
        if (!(extension && IMAGE_EXTENSIONS.has(extension))) {
          return yield* new BadRequest({
            message: `${name} is not an image the canvas can show`,
          });
        }
        const bytes = Buffer.from(data, "base64");
        if (bytes.byteLength > MAX_IMAGE_BYTES) {
          return yield* new BadRequest({
            message: `${name} is larger than ${MAX_IMAGE_BYTES / 1024 / 1024} MB`,
          });
        }
        const stem = name.slice(0, -(extension.length + 1)) || "image";
        const item = yield* naming.withPermits(1)(
          Effect.gen(function* () {
            const base = yield* freeBase(space, stem, extension);
            const asset = yield* paths.resolve(
              path.join(
                spaceDir(space),
                CANVAS_ASSETS_DIR,
                `${base}.${extension}`
              )
            );
            // The image itself is kept out of the journal: undoing leaves it for a redo, and a
            // page may still show it.
            yield* Effect.orDie(
              fs.makeDirectory(path.dirname(asset), { recursive: true })
            );
            yield* Effect.orDie(fs.writeFile(asset, bytes));
            const abs = yield* itemFile(space, base);
            return yield* edit.transaction("Add an image", (tx) =>
              place(
                tx,
                space,
                abs,
                pages.renderImageItem({
                  fileName: path.basename(abs),
                  src: `../${CANVAS_ASSETS_DIR}/${base}.${extension}`,
                }),
                frame
              )
            );
          })
        );
        return { item, warnings: [] } satisfies CanvasItemResult;
      });

      /** Takes the item's module and its place on the canvas away, inside the caller's action. */
      const unplace = Effect.fnUntraced(function* (
        tx: EditTransaction,
        { id, space }: RemoveItemInput
      ) {
        const segments = toPosix(id).split("/");
        if (segments.at(-2) !== CANVAS_ITEMS_DIR) {
          return yield* new BadRequest({ message: `not a canvas item: ${id}` });
        }
        const abs = yield* paths.resolve(path.join(paths.designsDir, id));
        const inSpace = pathInSpace(space, toPosix(id));
        yield* tx.remove(paths.relative(abs));
        yield* layouts.updateCanvas(tx, space, (layout) => {
          const { [inSpace]: _gone, ...items } = layout.items ?? {};
          return { ...layout, items };
        });
      });

      const remove = Effect.fn("CanvasItems.remove")(function* (
        input: RemoveItemInput
      ) {
        const name = humanise(path.basename(input.id, pages.extension));
        yield* edit.transaction(`Remove ${name}`, (tx) => unplace(tx, input));
      });

      const placeInPage = Effect.fn("CanvasItems.place")(function* (
        input: PlaceItemInput
      ) {
        const name = humanise(path.basename(input.id, pages.extension));
        return yield* edit.transaction(`Put ${name} into the page`, (tx) =>
          Effect.gen(function* () {
            const result = yield* edit.transfer(
              {
                copy: true,
                index: input.index,
                into: input.into,
                target: input.root,
              },
              tx
            );
            if (!input.copy) {
              yield* unplace(tx, input);
            }
            return result;
          })
        );
      });

      return CanvasItems.of({
        addImage,
        create,
        extract,
        place: placeInPage,
        remove,
      });
    })
  );
}
