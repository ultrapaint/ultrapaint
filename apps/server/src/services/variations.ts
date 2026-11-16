/**
 * A thing's variations (ADR 0098), kept in a designs file beside its document: listed, one made
 * by hand from the one in use, one put in use, renamed, deleted, or the set cleared. Each change
 * is one undo step, made through `DocumentService.apply`, so a variation put in use and the file
 * that keeps the one it replaced are written together. The file's changes from anywhere (an undo,
 * an agent, a checkout) are told to the editor.
 */
import {
  COMPONENTS_DIR,
  componentDocOf,
} from "@ultrapaint/contracts/components";
import type { DesignNode } from "@ultrapaint/contracts/document";
import { BadRequest, Conflict, NotFound } from "@ultrapaint/contracts/errors";
import {
  type DocumentVariations,
  ORIGINAL_ID,
  VARIATIONS_EXTENSION,
  type Variation,
  type VariationSet,
  type VariationSets,
  type VariationsList,
  type VariationTarget,
  variationsFileOf,
} from "@ultrapaint/contracts/variations";
import { canvasDocOf, findNode } from "@ultrapaint/design-document/tree";
import { Context, Effect, FileSystem, Layer, Path, Stream } from "effect";
import { EventBus } from "../events.ts";
import { toPosix } from "../hash.ts";
import { DesignFiles } from "./design-files.ts";
import { DocumentService } from "./documents.ts";
import type { EditFailure } from "./edit.ts";
import { PagesService } from "./pages.ts";
import { RepoPaths } from "./repo-paths.ts";
import {
  documentFileOfVariations,
  opsPutting,
  variationsCodec,
  writeSets,
} from "./variations-file.ts";

/** What a change makes of a thing's set: the set it leaves (null: none), and a tree to put in. */
interface Decided {
  readonly put?: DesignNode | undefined;
  readonly set: VariationSet | null;
}

const withoutTree = (variation: Variation): Variation => {
  const { tree: _tree, ...rest } = variation;
  return rest;
};

/** The sets with a thing's set as given; null takes it out. */
const withSet = (
  sets: VariationSets,
  node: string,
  set: VariationSet | null
): VariationSets => {
  const { [node]: _was, ...others } = sets;
  return set === null ? others : { ...others, [node]: set };
};

/** A new variation's id and name: the first number from 2 neither takes. */
const nextVariationOf = (set: VariationSet | undefined) => {
  const ids = new Set(set?.variations.map((v) => v.id));
  const names = new Set(set?.variations.map((v) => v.name));
  let n = Math.max(2, (set?.variations.length ?? 1) + 1);
  while (ids.has(`v${n}`) || names.has(`Variation ${n}`)) {
    n += 1;
  }
  return { id: `v${n}`, name: `Variation ${n}` };
};

export class VariationsService extends Context.Service<
  VariationsService,
  {
    /** A copy of the one in use, as a new variation put in use to be edited by hand. */
    readonly add: (
      target: VariationTarget
    ) => Effect.Effect<DocumentVariations, EditFailure>;
    /** The set gone, the thing as it is drawn now. */
    readonly clear: (
      target: VariationTarget
    ) => Effect.Effect<DocumentVariations, EditFailure>;
    /** The variations of every document of a canvas, and of every component. */
    readonly list: (
      canvas: string
    ) => Effect.Effect<VariationsList, EditFailure>;
    /** One deleted; the original stays while others remain, and one in use leaves it in use. */
    readonly remove: (
      target: VariationTarget,
      variation: string
    ) => Effect.Effect<DocumentVariations, EditFailure>;
    readonly rename: (
      target: VariationTarget,
      variation: string,
      name: string
    ) => Effect.Effect<DocumentVariations, EditFailure>;
    /** One put in use: the tree in the document is kept in the one it was, and this one put in. */
    readonly use: (
      target: VariationTarget,
      variation: string
    ) => Effect.Effect<DocumentVariations, EditFailure>;
  }
>()("ultrapaint/server/VariationsService") {
  static readonly layer = Layer.effect(
    VariationsService,
    Effect.gen(function* () {
      const paths = yield* RepoPaths;
      const documents = yield* DocumentService;
      const pages = yield* PagesService;
      const events = yield* EventBus;
      const designFiles = yield* DesignFiles;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;

      /** A file's sets as they are on disk now. */
      const readSets = Effect.fnUntraced(function* (file: string) {
        const text = yield* fs.readFileString(yield* paths.resolve(file)).pipe(
          // A document with no file beside it has no variations yet.
          Effect.catchReason("PlatformError", "NotFound", () =>
            Effect.succeed(null)
          ),
          Effect.mapError(
            (error) =>
              new Conflict({
                message: `${file} cannot be read: ${error.message}`,
              })
          )
        );
        return yield* variationsCodec(file).decode(text);
      });

      const setsOf = Effect.fnUntraced(function* (doc: string) {
        return yield* readSets(variationsFileOf(yield* documents.fileOf(doc)));
      });

      const list = Effect.fn("VariationsService.list")(function* (
        canvas: string
      ) {
        const { pages: all } = yield* pages.list;
        const componentsDir = yield* paths.resolve(
          path.join(paths.designsDir, COMPONENTS_DIR)
        );
        const components = (yield* fs.readDirectory(componentsDir).pipe(
          // A project with no components folder yet has no component's variations.
          Effect.catchReason("PlatformError", "NotFound", () =>
            Effect.succeed([] as string[])
          ),
          Effect.mapError(
            (error) =>
              new Conflict({
                message: `the components cannot be listed: ${error.message}`,
              })
          )
        ))
          .filter((name) => name.endsWith(VARIATIONS_EXTENSION))
          .map((name) =>
            componentDocOf(name.slice(0, -VARIATIONS_EXTENSION.length))
          );
        const docs = [
          ...all.filter((p) => p.canvas === canvas).map((p) => p.id),
          canvasDocOf(canvas),
          ...components,
        ];
        const read = yield* Effect.forEach(docs, (doc) =>
          setsOf(doc).pipe(
            // A file that does not read (a merge left half done) lists none; a change says why.
            Effect.catchTag("Conflict", () => Effect.succeed({})),
            Effect.map((sets) => ({ doc, sets }))
          )
        );
        return {
          documents: read.filter((d) => Object.keys(d.sets).length > 0),
        } satisfies VariationsList;
      });

      /**
       * Changes a thing's set as `decide` says, in one undo step with the tree it puts in its
       * document; answers with the document's variations as they are then.
       */
      const change = Effect.fnUntraced(function* (
        label: string,
        target: VariationTarget,
        decide: (
          set: VariationSet | undefined,
          node: DesignNode
        ) => Effect.Effect<Decided, EditFailure>
      ) {
        const file = variationsFileOf(yield* documents.fileOf(target.doc));
        yield* documents.apply({ edits: [], label }, (step) =>
          Effect.gen(function* () {
            const { root } = yield* step.get(target.doc);
            const node = findNode(root, target.node);
            if (root === null || node === null) {
              return yield* new NotFound({
                message: `there is no node ${target.node} in ${target.doc}`,
              });
            }
            const sets = yield* step.tx.readDocument(
              file,
              variationsCodec(file)
            );
            const decided = yield* decide(sets[target.node], node);
            yield* writeSets(
              step.tx,
              file,
              withSet(sets, target.node, decided.set)
            );
            return decided.put === undefined
              ? undefined
              : [{ doc: target.doc, ops: opsPutting(root, decided.put) }];
          })
        );
        // The editors are told by the file's change, as of an undo's.
        const sets = yield* setsOf(target.doc);
        return { doc: target.doc, sets } satisfies DocumentVariations;
      });

      const variationIn = (
        set: VariationSet | undefined,
        variation: string
      ) => {
        const entry = set?.variations.find((v) => v.id === variation);
        return entry === undefined || set === undefined
          ? Effect.fail(
              new NotFound({ message: `there is no variation ${variation}` })
            )
          : Effect.succeed({ entry, set });
      };

      /** The set with `variation` put in use: the tree in the document kept in the one it was. */
      const putInUse = (
        set: VariationSet,
        node: DesignNode,
        variation: string
      ): Effect.Effect<Decided, EditFailure> => {
        if (variation === set.inUse) {
          return Effect.succeed({ set });
        }
        const next = set.variations.find((v) => v.id === variation);
        if (next?.tree === undefined) {
          return Effect.fail(
            new BadRequest({ message: `${variation} has nothing to draw` })
          );
        }
        return Effect.succeed({
          put: next.tree,
          set: {
            inUse: variation,
            variations: set.variations.map((v) => {
              if (v.id === set.inUse) {
                return { ...v, tree: node };
              }
              return v.id === variation ? withoutTree(v) : v;
            }),
          },
        });
      };

      const add = Effect.fn("VariationsService.add")(function* (
        target: VariationTarget
      ) {
        return yield* change("New variation", target, (set, node) => {
          const { id, name } = nextVariationOf(set);
          const variations =
            set === undefined
              ? [{ id: ORIGINAL_ID, name: "Original", tree: node }]
              : set.variations.map((v) =>
                  v.id === set.inUse ? { ...v, tree: node } : v
                );
          return Effect.succeed({
            set: { inUse: id, variations: [...variations, { id, name }] },
          });
        });
      });

      const use = Effect.fn("VariationsService.use")(function* (
        target: VariationTarget,
        variation: string
      ) {
        return yield* change("Use a variation", target, (set, node) =>
          Effect.flatMap(variationIn(set, variation), ({ set: s }) =>
            putInUse(s, node, variation)
          )
        );
      });

      const rename = Effect.fn("VariationsService.rename")(function* (
        target: VariationTarget,
        variation: string,
        name: string
      ) {
        return yield* change("Rename a variation", target, (set) =>
          Effect.map(variationIn(set, variation), ({ set: s }) => ({
            set: {
              ...s,
              variations: s.variations.map((v) =>
                v.id === variation ? { ...v, name } : v
              ),
            },
          }))
        );
      });

      const remove = Effect.fn("VariationsService.remove")(function* (
        target: VariationTarget,
        variation: string
      ) {
        return yield* change("Delete a variation", target, (set, node) =>
          Effect.gen(function* () {
            const { set: s } = yield* variationIn(set, variation);
            if (variation === ORIGINAL_ID) {
              return yield* new BadRequest({
                message: "the original stays while other variations remain",
              });
            }
            // The one in use goes: the original is put in use in its place.
            const swapped =
              variation === s.inUse
                ? yield* putInUse(s, node, ORIGINAL_ID)
                : { set: s };
            const from = swapped.set ?? s;
            const left = from.variations.filter((v) => v.id !== variation);
            return {
              put: swapped.put,
              set:
                left.length < 2
                  ? null
                  : { inUse: from.inUse, variations: left },
            } satisfies Decided;
          })
        );
      });

      const clear = Effect.fn("VariationsService.clear")(function* (
        target: VariationTarget
      ) {
        return yield* change("Clear variations", target, () =>
          Effect.succeed({ set: null })
        );
      });

      // An undo, an agent or a checkout changes a file behind the editor's back.
      yield* designFiles.changes(["variations"]).pipe(
        Stream.mapEffect(({ file }) => {
          const rel = toPosix(
            path.relative(paths.designsDir, path.resolve(paths.root, file))
          );
          const doc = documents.documentOf(
            path.join(
              path.relative(paths.root, paths.designsDir),
              documentFileOfVariations(rel)
            )
          );
          if (doc === null) {
            return Effect.void;
          }
          return readSets(file).pipe(
            Effect.flatMap((sets) =>
              events.publish("variations", { doc, sets })
            ),
            Effect.catchCause((cause) =>
              Effect.logWarning(`${file} changed and could not be read`, cause)
            )
          );
        }),
        Stream.runDrain,
        Effect.forkScoped
      );

      return VariationsService.of({ add, clear, list, remove, rename, use });
    })
  );
}
