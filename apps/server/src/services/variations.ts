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
  ORIGINAL,
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
import { PageVariants } from "./page-variants.ts";
import { PagesService } from "./pages.ts";
import { RepoPaths } from "./repo-paths.ts";
import {
  documentFileOfVariations,
  opsPutting,
  variationsCodec,
  withPageVariants,
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

/**
 * The set's variations, the tree in the document kept in the one in use as another is put in use:
 * the original, for a thing with none yet. With none in use, the tree is kept by none.
 */
const keptAside = (
  set: VariationSet | undefined,
  node: DesignNode
): readonly Variation[] =>
  set === undefined
    ? [{ ...ORIGINAL, tree: node }]
    : set.variations.map((v) =>
        v.id === set.inUse ? { ...v, tree: node } : v
      );

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

/** An agent's take: its name, what it varied, and its tree, the thing's id at its root. */
export interface Take {
  readonly name: string;
  readonly tree: DesignNode;
  readonly varied?: string | undefined;
}

export class VariationsService extends Context.Service<
  VariationsService,
  {
    /** A copy of the one in use, as a new variation put in use to be edited by hand. */
    readonly add: (
      target: VariationTarget
    ) => Effect.Effect<DocumentVariations, EditFailure>;
    /**
     * An agent's take saved into the thing's set, after the others, the one in use left in use:
     * the set begun with the original when the thing has none yet. Answers with the take's id.
     */
    readonly addTake: (
      target: VariationTarget,
      take: Take
    ) => Effect.Effect<string, EditFailure>;
    /** The set gone, the thing as it is drawn now. */
    readonly clear: (
      target: VariationTarget
    ) => Effect.Effect<DocumentVariations, EditFailure>;
    /** The variations of every document of a canvas, and of every component. */
    readonly list: (
      canvas: string
    ) => Effect.Effect<Pick<VariationsList, "documents">, EditFailure>;
    /**
     * One deleted, the thing left as it is drawn: the one in use deleted, none is in use. The
     * original stays while others remain.
     */
    readonly remove: (
      target: VariationTarget,
      variation: string
    ) => Effect.Effect<DocumentVariations, EditFailure>;
    /** A document's sets, by node id, as its file holds them now. */
    readonly sets: (doc: string) => Effect.Effect<VariationSets, EditFailure>;
    readonly rename: (
      target: VariationTarget,
      variation: string,
      name: string
    ) => Effect.Effect<DocumentVariations, EditFailure>;
    /**
     * A tree of the thing's put in use as a new variation named `name`: a preview made of
     * several variations (ADR 0098). The tree in the document is kept in the one it was.
     */
    readonly useTree: (
      target: VariationTarget,
      name: string,
      tree: DesignNode
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
      const pageVariants = yield* PageVariants;
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

      /** The sets with a page's variants from before ADR 0098 among its root's variations. */
      const withVariantsOf = Effect.fnUntraced(function* (
        doc: string,
        sets: VariationSets,
        rootId?: string
      ) {
        const variants = yield* pageVariants.of(doc);
        if (variants.length === 0) {
          return sets;
        }
        const id = rootId ?? (yield* documents.get(doc)).root?.id;
        return id === undefined ? sets : withPageVariants(sets, id, variants);
      });

      const setsOf = Effect.fnUntraced(function* (doc: string) {
        const sets = yield* readSets(
          variationsFileOf(yield* documents.fileOf(doc))
        );
        return yield* withVariantsOf(doc, sets);
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
        } satisfies Pick<VariationsList, "documents">;
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
            const sets = yield* withVariantsOf(
              target.doc,
              yield* step.tx.readDocument(file, variationsCodec(file)),
              root.id
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
        // A file written by hand or merged may keep another node's tree under this one.
        if (next.tree.id !== node.id) {
          return Effect.fail(
            new BadRequest({
              message: `${variation} draws ${next.tree.id}, not ${node.id}`,
            })
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
          return Effect.succeed({
            set: {
              inUse: id,
              variations: [...keptAside(set, node), { id, name }],
            },
          });
        });
      });

      const addTake = Effect.fn("VariationsService.addTake")(function* (
        target: VariationTarget,
        take: Take
      ) {
        if (take.tree.id !== target.node) {
          return yield* new BadRequest({
            message: `a take of ${target.node} draws ${take.tree.id}`,
          });
        }
        // Decided inside the step that writes it: another take may land right after.
        let made = "";
        yield* change(`Variation “${take.name}”`, target, (set) => {
          const { id } = nextVariationOf(set);
          made = id;
          // The original, in use, is the tree in the document: it keeps none of its own.
          const variations = set?.variations ?? [ORIGINAL];
          return Effect.succeed({
            set: {
              inUse: set === undefined ? ORIGINAL_ID : set.inUse,
              variations: [
                ...variations,
                {
                  id,
                  name: take.name,
                  tree: take.tree,
                  ...(take.varied !== undefined && { varied: take.varied }),
                },
              ],
            },
          });
        });
        return made;
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

      const useTree = Effect.fn("VariationsService.useTree")(function* (
        target: VariationTarget,
        name: string,
        tree: DesignNode
      ) {
        if (tree.id !== target.node) {
          return yield* new BadRequest({
            message: `a variation of ${target.node} draws ${tree.id}`,
          });
        }
        return yield* change("Use a variation", target, (set, node) => {
          const { id } = nextVariationOf(set);
          return Effect.succeed({
            put: tree,
            set: {
              inUse: id,
              variations: [...keptAside(set, node), { id, name }],
            },
          });
        });
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
        return yield* change("Delete a variation", target, (set) =>
          Effect.gen(function* () {
            const { set: s } = yield* variationIn(set, variation);
            const left = s.variations.filter((v) => v.id !== variation);
            if (variation === ORIGINAL_ID && left.length > 0) {
              return yield* new BadRequest({
                message: "the original stays while other variations remain",
              });
            }
            // The thing stays as it is drawn (ADR 0098): the one in use
            // deleted, none is in use until another is used.
            const inUse = variation === s.inUse ? null : s.inUse;
            const onlyInUse = left.length === 1 && left[0]?.id === inUse;
            return {
              set:
                left.length === 0 || onlyInUse
                  ? null
                  : { inUse, variations: left },
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

      return VariationsService.of({
        add,
        addTake,
        clear,
        list,
        remove,
        rename,
        sets: setsOf,
        use,
        useTree,
      });
    })
  );
}
