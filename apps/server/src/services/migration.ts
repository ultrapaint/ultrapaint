/**
 * What came before ADRs 0040 and 0041, brought up to date (ADRs 0041, 0042): Sync's one step. The
 * instances of every page and canvas as `migrate.ts` draws them now (system components and drafts
 * as they were named, the repository's components a system component is like), each
 * `specs/<Name>.spec.json` as `components/<Name>.component.json`, and their implementations'
 * snapshots and `spec:<Name>` targets as a component's, in one undo step.
 *
 * One module, on the documents' `apply` and the implementation's entries, so that retiring the
 * migration is deleting this file and its Sync step.
 */

import {
  type ComponentFile,
  componentFileOf,
} from "@ultrapaint/contracts/components";
import type { DocOp, DocumentEdit } from "@ultrapaint/contracts/document";
import type { Conflict } from "@ultrapaint/contracts/errors";
import {
  COMPONENT_TARGET_PREFIX,
  IMPLEMENTED_COMPONENTS,
  IMPLEMENTED_DIR,
  type ImplementationEntry,
} from "@ultrapaint/contracts/implementation";
import { serialise } from "@ultrapaint/design-document/factories";
import {
  componentOfSpec,
  LEGACY_SPEC_EXTENSION,
  LEGACY_SPECS_DIR,
  LegacyComponentSpec,
  migrationOf,
} from "@ultrapaint/system-components/migrate";
import { Context, Effect, FileSystem, Layer, Path, Schema } from "effect";
import { componentHash, hashContent, stableJson } from "../hash.ts";
import { componentText } from "./component-files.ts";
import { DocumentService } from "./documents.ts";
import type { EditFailure, EditTransaction } from "./edit.ts";
import { type EntryEdit, ImplementationService } from "./implementation.ts";
import { RepoPaths } from "./repo-paths.ts";

/** Where an implemented spec's snapshot was kept, inside `_implemented/`. */
const LEGACY_IMPLEMENTED_SPECS = "specs";
/** What a spec's link to the code was named in `implementation.json`. */
const LEGACY_SPEC_TARGET_PREFIX = "spec:";

const decodeSpec = Schema.decodeUnknownEffect(LegacyComponentSpec);

/** What is left from before ADR 0041 to migrate. */
export interface Legacy {
  /** Instances drawn as now once migrated. */
  readonly drawn: number;
  /** Instances of the repository's components no system component is like. */
  readonly left: number;
  /** Specs' files, each a component's once migrated. */
  readonly specs: number;
}

/** A spec's file as it was read. */
interface SpecRead {
  readonly file: string;
  readonly raw: unknown;
  readonly spec: LegacyComponentSpec;
}

export class Migration extends Context.Service<
  Migration,
  {
    /** What is left to migrate. */
    readonly left: Effect.Effect<Legacy, EditFailure>;
    /**
     * Everything from before brought up to date, in one undo step. Answers with how many
     * instances are drawn as now, in how many documents, and how many components were made.
     */
    readonly run: Effect.Effect<
      {
        readonly components: number;
        readonly documents: number;
        readonly drawn: number;
      },
      EditFailure | Conflict
    >;
  }
>()("ultrapaint/server/Migration") {
  static readonly layer = Layer.effect(
    Migration,
    Effect.gen(function* () {
      const paths = yield* RepoPaths;
      const documents = yield* DocumentService;
      const implementation = yield* ImplementationService;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      /** A path inside the designs directory as the repository has it. */
      const repoOf = (designs: string) =>
        paths.relative(path.join(paths.designsDir, designs));

      /** The specs' files from before, each read, or left out when it does not read. */
      const specs = Effect.gen(function* () {
        const dir = path.join(paths.designsDir, LEGACY_SPECS_DIR);
        const names = yield* fs
          .readDirectory(dir)
          .pipe(Effect.orElseSucceed((): string[] => []));
        const read = yield* Effect.forEach(
          names.filter((n) => n.endsWith(LEGACY_SPEC_EXTENSION)).sort(),
          (name) =>
            fs.readFileString(path.join(dir, name)).pipe(
              Effect.flatMap((text) =>
                Effect.try({
                  catch: (error) => String(error),
                  try: () => JSON.parse(text) as unknown,
                })
              ),
              Effect.flatMap((raw) =>
                Effect.map(
                  decodeSpec(raw),
                  (spec): SpecRead => ({ file: name, raw, spec })
                )
              ),
              Effect.option
            )
        );
        return read.flatMap((o) => (o._tag === "Some" ? [o.value] : []));
      });

      /** Every document's instances from before, each put back where it was as it is drawn now. */
      const instances = Effect.gen(function* () {
        let drawn = 0;
        let left = 0;
        const edits: DocumentEdit[] = [];
        for (const state of yield* documents.all) {
          const tree = state.root;
          if (!tree) {
            continue;
          }
          const migration = migrationOf(tree);
          left += migration.left.length;
          // What an instance holds goes with it.
          const ops = migration.replaced.map(
            (node): DocOp => ({ ids: [node.id], node, op: "replace" })
          );
          if (ops.length > 0) {
            drawn += migration.drawn;
            edits.push({ doc: state.doc, expectedHash: state.hash, ops });
          }
        }
        return { drawn, edits, left };
      });

      const left = Effect.gen(function* () {
        const { drawn, left: stay } = yield* instances;
        return { drawn, left: stay, specs: (yield* specs).length };
      }).pipe(Effect.withSpan("Migration.left"));

      /** The implementations' snapshots from before, each as a component's, by file name. */
      const snapshots = Effect.gen(function* () {
        const dir = path.join(
          paths.designsDir,
          IMPLEMENTED_DIR,
          LEGACY_IMPLEMENTED_SPECS
        );
        const names = yield* fs
          .readDirectory(dir)
          .pipe(Effect.orElseSucceed((): string[] => []));
        return yield* Effect.forEach(names, (name) =>
          fs.readFileString(path.join(dir, name)).pipe(
            Effect.flatMap((text) =>
              Effect.try(() => JSON.parse(text) as { spec?: unknown })
            ),
            Effect.flatMap((json) => decodeSpec(json.spec)),
            Effect.map(componentOfSpec),
            Effect.orElseSucceed(() => null),
            Effect.map((component) => ({ component, name }))
          )
        );
      });

      /**
       * The links to the code moved from the specs to the components: each `spec:<Name>` target
       * as `component:<Name>`, its design hash the component's as implemented (its snapshot's,
       * or, without one, the component's now when the spec had not changed since).
       */
      const entries =
        (
          made: readonly SpecRead[],
          kept: readonly { readonly component: ComponentFile | null }[]
        ) =>
        (items: Readonly<Record<string, ImplementationEntry>>): EntryEdit[] => {
          const now = new Map(
            made.flatMap(({ raw, spec }) => {
              const component = componentOfSpec(spec);
              return component
                ? [
                    [
                      spec.component,
                      {
                        hash: componentHash(component),
                        was: hashContent(stableJson(raw)),
                      },
                    ] as const,
                  ]
                : [];
            })
          );
          const implementedHash = new Map(
            kept.flatMap(({ component }) =>
              component
                ? [[component.name, componentHash(component)] as const]
                : []
            )
          );
          return Object.entries(items).flatMap(
            ([target, entry]): EntryEdit[] => {
              if (!target.startsWith(LEGACY_SPEC_TARGET_PREFIX)) {
                return [];
              }
              const name = target.slice(LEGACY_SPEC_TARGET_PREFIX.length);
              const component = now.get(name);
              const hash =
                implementedHash.get(name) ??
                (component && entry.implemented?.design === component.was
                  ? component.hash
                  : undefined);
              return [
                { target, update: () => null },
                {
                  target: `${COMPONENT_TARGET_PREFIX}${name}`,
                  update: () =>
                    entry.implemented && hash
                      ? {
                          ...entry,
                          implemented: { ...entry.implemented, design: hash },
                        }
                      : entry,
                },
              ];
            }
          );
        };

      /** The implementations' snapshots moved to the components', each in a component's format. */
      const snapshotsMoved = (
        tx: EditTransaction,
        kept: readonly {
          readonly component: ComponentFile | null;
          readonly name: string;
        }[]
      ) =>
        Effect.forEach(
          kept,
          Effect.fnUntraced(function* ({ component, name }) {
            yield* tx.remove(
              repoOf(`${IMPLEMENTED_DIR}/${LEGACY_IMPLEMENTED_SPECS}/${name}`)
            );
            if (component) {
              yield* tx.write(
                repoOf(`${IMPLEMENTED_DIR}/${IMPLEMENTED_COMPONENTS}/${name}`),
                serialise({ component, kind: "component" })
              );
            }
          }),
          { discard: true }
        );

      /** The specs' files as components' files. */
      const files = (tx: EditTransaction, made: readonly SpecRead[]) =>
        Effect.forEach(
          made,
          Effect.fnUntraced(function* ({ file, spec }) {
            const component = componentOfSpec(spec);
            yield* tx.remove(repoOf(`${LEGACY_SPECS_DIR}/${file}`));
            if (component) {
              yield* tx.write(
                repoOf(componentFileOf(component.name)),
                componentText(component)
              );
            }
          }),
          { discard: true }
        );

      const run = Effect.gen(function* () {
        const { drawn, edits } = yield* instances;
        const made = yield* specs;
        if (edits.length === 0 && made.length === 0) {
          return { components: 0, documents: 0, drawn: 0 };
        }
        const kept = yield* snapshots;
        yield* documents.apply(
          { edits, label: "Bring the designs up to date" },
          (tx) =>
            Effect.all(
              [
                files(tx, made),
                snapshotsMoved(tx, kept),
                implementation.editIn(tx, entries(made, kept)),
              ],
              { discard: true }
            )
        );
        return {
          components: made.filter(({ spec }) => componentOfSpec(spec)).length,
          documents: edits.length,
          drawn,
        };
      }).pipe(Effect.withSpan("Migration.run"));

      return Migration.of({ left, run });
    })
  );
}
