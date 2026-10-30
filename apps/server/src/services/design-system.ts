import {
  DESIGN_SYSTEM_FILE,
  type DesignFinding,
  type DesignSystem,
  type DesignSystemState,
} from "@ultrapaint/contracts/design-system";
import type { DesignSystemEdit } from "@ultrapaint/contracts/design-system-edit";
import type { DesignNode } from "@ultrapaint/contracts/document";
import { BadRequest } from "@ultrapaint/contracts/errors";
import { tokenChangesBetween } from "@ultrapaint/contracts/token-table";
import type { SourceToken } from "@ultrapaint/contracts/tokens";
import { breakpointsOf } from "@ultrapaint/design-document/breakpoints";
import {
  type CodeOptions,
  componentsImportBase,
  toCode,
} from "@ultrapaint/design-document/code";
import {
  applyEdits,
  editLabel,
} from "@ultrapaint/design-document/design-system-edits";
import { Context, Effect, FileSystem, Layer, Path, Stream } from "effect";
import { EventBus } from "../events.ts";
import { makeStampedCache } from "../file-stamp.ts";
import { CodeSide } from "./code-side.ts";
import { ComponentService } from "./components.ts";
import { DesignFiles } from "./design-files.ts";
import { DesignMd } from "./design-md.ts";
import {
  type BaselineMove,
  type BaselineSide,
  type Baselines,
  baselineMover,
  type DesignSystemRead,
  type DesignSystemTexts,
  keepBaselines,
  readDesignSystem,
  readGivenDesignSystem,
  writeDesignSystem,
} from "./design-system-files.ts";
import { DESIGN_TOKENS_FILE } from "./dtcg.ts";
import { type EditFailure, EditService, type EditTransaction } from "./edit.ts";
import { FigmaBaseline } from "./figma-baseline.ts";
import { RepoPaths } from "./repo-paths.ts";
import { ProjectStyleSystem } from "./style-system.ts";

/**
 * The design system as the project records it: `design-system.json` at the root of the designs
 * directory, and `design.tokens.json` beside it with every value, in the Design Tokens format
 * (ADR 0035). `/init` has an agent write it through `write`, which validates; `detect` writes
 * what the fixed-rule scan finds, for a project without an agent. Each change is one undo step,
 * and the editor hears of every change once, whoever made it: the tool, an undo, an agent
 * writing the files by hand, a checkout, the code.
 *
 * Every write goes one way (`save`): the files are read inside the step, under the journal's
 * lock, so an edit, an undo or a sync made meanwhile lands before it or after it; what the step
 * changed in the tokens' values is what the code is told, with `codeTokens: auto`, whichever of
 * `edit`, `write` or `replace` made it; and the sides' baselines are the file's, moved only by
 * `moveBaseline`, outside the undo history.
 *
 * A token's value is the design's (ADR 0028): another tool's change to the tokens file is the
 * design's value as soon as it is read, and a value neither file has is read from the code. A
 * `design-system.json` written before ADR 0035 still holds its values, which the tokens file's
 * win over. The sides own what they know: the code's tokens, its stylesheets and what it agrees
 * on are `CodeSide`'s; DESIGN.md, its mirror of the tokens and its baseline are `DesignMd`'s,
 * which `write` and `replace` write beside the design system; Figma's baseline waiting for a
 * design system is `FigmaBaseline`'s.
 */
export class DesignSystemService extends Context.Service<
  DesignSystemService,
  {
    readonly detect: Effect.Effect<DesignSystem, EditFailure>;
    /**
     * The editor's operations made in order (ADR 0045, `applyEdits`) and saved as one undo step.
     * Nothing is written when one does not fit. Returns the files written, the code's with
     * `codeTokens: auto`.
     */
    readonly edit: (
      ops: readonly DesignSystemEdit[],
      label?: string
    ) => Effect.Effect<{ readonly files: readonly string[] }, BadRequest>;
    readonly get: Effect.Effect<DesignSystemState>;
    /**
     * The state read again, the stylesheets and the components from scratch: after a change to
     * them that the files read last time would not show, such as a stylesheet that was not there.
     */
    readonly refresh: Effect.Effect<DesignSystemState>;
    /**
     * A node of the designs as the application's code writes it: the markup the design
     * document's, the classes the style system's (ADR 0024), at the design system's breakpoints.
     */
    readonly codeOf: (
      node: DesignNode,
      options: Omit<CodeOptions, "breakpoints" | "catalogue">
    ) => Effect.Effect<string>;
    /**
     * One side's baseline in `design-system.json` moved, outside the undo history (ADR 0025,
     * 0027, 0028): what the code, DESIGN.md or Figma and the design system agree on, and the
     * matches each keeps.
     */
    readonly moveBaseline: <S extends BaselineSide>(
      side: S,
      move: BaselineMove<S>
    ) => Effect.Effect<void, BadRequest>;
    /** `DESIGN.md` written where it is looked for, from the design system as it is now. */
    readonly placeDocument: Effect.Effect<
      { readonly path: string },
      EditFailure
    >;
    /**
     * Saves the design system and `DESIGN.md` as given, in one undo step: for Sync, which has
     * merged them itself (ADR 0027). The baselines it gives are moved, outside the undo history.
     * Returns the files written.
     */
    readonly replace: (
      designSystem: DesignSystem,
      document: string,
      label: string
    ) => Effect.Effect<{ readonly files: readonly string[] }, EditFailure>;
    /**
     * Validates and saves; `document` replaces `DESIGN.md` when given, at the root. Its mirrored
     * token groups are the design system's, filled in whatever it says; `findings` are what the
     * format's linter says and what was put back. A linter error refuses the whole write. The
     * baselines are the tool's, not the writer's: the ones there are stay.
     */
    readonly write: (
      designSystem: unknown,
      document?: string
    ) => Effect.Effect<
      {
        readonly designSystem: DesignSystem;
        readonly findings: readonly DesignFinding[];
      },
      EditFailure
    >;
  }
>()("ultrapaint/server/DesignSystemService") {
  static readonly layer = Layer.effect(
    DesignSystemService,
    Effect.gen(function* () {
      const paths = yield* RepoPaths;
      const journal = yield* EditService;
      const code = yield* CodeSide;
      const designMd = yield* DesignMd;
      const figma = yield* FigmaBaseline;
      const styleSystem = yield* ProjectStyleSystem;
      // The Code tab lays an instance's children out as the components' slots do (ADR 0042).
      const { catalogue } = yield* ComponentService;
      const events = yield* EventBus;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const systemFile = path.join(paths.designsDir, DESIGN_SYSTEM_FILE);
      const systemRel = paths.relative(systemFile);
      const tokensFile = path.join(paths.designsDir, DESIGN_TOKENS_FILE);
      const tokensRel = paths.relative(tokensFile);
      const moveBaseline = baselineMover(journal, systemRel);

      const readOptional = (file: string) =>
        Effect.orElseSucceed(
          Effect.map(fs.readFileString(file), (text): string | null => text),
          () => null
        );

      /** The two files' texts as they read: kept until one of them changes. */
      const filesCache = makeStampedCache(
        fs,
        Effect.map(
          Effect.all([readOptional(systemFile), readOptional(tokensFile)]),
          ([system, tokens]) => ({
            files: [systemFile, tokensFile],
            value: { system, tokens } satisfies DesignSystemTexts,
          })
        )
      );

      /**
       * The design system the files come to with the code's values (`design-system-files.ts`):
       * the last one kept while the texts and the code are the same.
       */
      let lastRead: {
        readonly code: ReadonlyMap<string, SourceToken>;
        readonly read: DesignSystemRead;
        readonly texts: DesignSystemTexts;
      } | null = null;
      const designSystemOf = Effect.fnUntraced(function* (
        texts: DesignSystemTexts
      ) {
        const { byName } = yield* code.tokens;
        if (
          !(
            lastRead?.code === byName &&
            lastRead.texts.system === texts.system &&
            lastRead.texts.tokens === texts.tokens
          )
        ) {
          lastRead = {
            code: byName,
            read: readDesignSystem(texts, byName),
            texts,
          };
        }
        return lastRead.read;
      });
      const filesRead = Effect.flatMap(filesCache.get, designSystemOf);

      /** The design system as a step finds it: its own writes included, under the journal's lock. */
      const readIn = Effect.fnUntraced(function* (tx: EditTransaction) {
        return yield* designSystemOf({
          system: yield* tx.read(systemRel),
          tokens: yield* tx.read(tokensRel),
        });
      });

      /**
       * DESIGN.md's front matter brought up to the design system as the files read when its
       * turn comes, after whatever wrote them.
       */
      const mirror = designMd.follow(
        Effect.map(filesRead, ({ designSystem }) => designSystem)
      );

      const get: Effect.Effect<DesignSystemState> = Effect.gen(function* () {
        const { designSystem, problem, tokensNotes, tokensProblem } =
          yield* filesRead;
        const document = yield* designMd.document(designSystem);
        if (problem !== null) {
          return { designSystem: null, document, problem };
        }
        return {
          designSystem,
          document,
          ...(tokensProblem !== null && {
            problem: `${tokensProblem}: the values are design-system.json's and the code's until it reads`,
          }),
          ...(tokensNotes.length > 0 && {
            notes: tokensNotes.map((n) => `${DESIGN_TOKENS_FILE}: ${n}`),
          }),
        };
      }).pipe(Effect.withSpan("DesignSystemService.get"));

      /** What a step saves: the design system, DESIGN.md beside it, the baselines it moves. */
      interface Saving<R> {
        readonly baselines?: Partial<Baselines>;
        readonly designSystem: DesignSystem;
        readonly document?: {
          readonly text: string;
          /** The designs directory's DESIGN.md, replaced by the root's. */
          readonly replaces?: string;
        };
        /** What the write answers besides. */
        readonly result: R;
      }

      /**
       * The one way the design system is written. `make` is given the design system as the step
       * finds it, under the journal's lock, and says what to save; the files are written in one
       * undo step, the baselines as the file has them. Then, outside the undo history: the
       * baselines `make` gave are moved, the code is told what changed in the tokens' values
       * (`codeTokens: auto`; nothing when there was no design system before, which the code is
       * where it came from), what the code and the design system agree on is moved, and DESIGN.md's
       * front matter follows. All of it is done before the write returns: whoever reads the
       * files next reads them current.
       */
      const save = <R, E>(
        label: string,
        make: (read: DesignSystemRead) => Effect.Effect<Saving<R>, E>
      ) =>
        Effect.gen(function* () {
          const { before, saved, saving } = yield* journal.transaction(
            label,
            (tx) =>
              Effect.gen(function* () {
                const read = yield* readIn(tx);
                if (read.tokensProblem !== null) {
                  return yield* new BadRequest({
                    message: `${read.tokensProblem}. The design system is written again once it reads.`,
                  });
                }
                const made = yield* make(read);
                const kept = keepBaselines(
                  made.designSystem,
                  read.designSystem
                );
                const texts = writeDesignSystem(kept);
                yield* tx.write(systemRel, texts.system);
                yield* tx.write(tokensRel, texts.tokens);
                if (made.document) {
                  yield* tx.write(designMd.file, made.document.text);
                  if (made.document.replaces) {
                    yield* tx.remove(made.document.replaces);
                  }
                }
                return { before: read.designSystem, saved: kept, saving: made };
              })
          );
          for (const [side, baseline] of Object.entries(
            saving.baselines ?? {}
          ) as [BaselineSide, Baselines[BaselineSide]][]) {
            yield* moveBaseline(side, () => baseline);
          }
          const followed = before
            ? yield* code.follow(tokenChangesBetween(before, saved), saved)
            : { files: [] };
          if (followed.files.length === 0) {
            yield* code.settle(saved);
          }
          yield* mirror;
          return {
            files: [
              systemRel,
              tokensRel,
              ...(saving.document ? [designMd.file] : []),
              ...followed.files,
            ],
            result: saving.result,
            saved,
          };
        });

      const noDesignSystem = new BadRequest({
        message:
          "There is no design system yet to change a token in: Sync makes one.",
      });

      const edit = Effect.fn("DesignSystemService.edit")(
        function* (ops: readonly DesignSystemEdit[], label?: string) {
          const { files } = yield* save(label ?? editLabel(ops), (read) => {
            if (!read.designSystem) {
              return Effect.fail(noDesignSystem);
            }
            const next = applyEdits(read.designSystem, ops);
            return "problem" in next
              ? Effect.fail(new BadRequest({ message: next.problem }))
              : Effect.succeed({ designSystem: next, result: null });
          });
          return { files };
        },
        Effect.mapError((error) =>
          error._tag === "BadRequest"
            ? error
            : new BadRequest({
                message: `the design system could not be written: ${error.message}`,
              })
        )
      );

      const write = Effect.fn("DesignSystemService.write")(function* (
        input: unknown,
        document?: string
      ) {
        const pending = yield* figma.pending;
        const { result, saved } = yield* save(
          "Update the design system",
          (read) =>
            Effect.gen(function* () {
              const given = readGivenDesignSystem(input, {
                code: (yield* code.tokens).byName,
                current: read.designSystem,
              });
              if ("problem" in given) {
                return yield* new BadRequest({ message: given.problem });
              }
              const current = keepBaselines(
                given.designSystem,
                read.designSystem
              );
              const written =
                document === undefined
                  ? null
                  : yield* designMd.toWrite(document, current);
              const found = written ? yield* designMd.document(null) : null;
              return {
                baselines: {
                  ...(written && { designMd: written.designMd }),
                  // A sync with Figma waiting for a design system is kept in it.
                  ...(!current.sync && pending && { sync: pending }),
                },
                designSystem: current,
                ...(written && {
                  document: {
                    text: written.text,
                    ...(found?.legacy && { replaces: found.path }),
                  },
                }),
                result: {
                  findings: written?.findings ?? [],
                  pendingTaken: !current.sync && pending !== null,
                },
              } satisfies Saving<{
                readonly findings: readonly DesignFinding[];
                readonly pendingTaken: boolean;
              }>;
            })
        );
        if (result.pendingTaken) {
          yield* figma.clear;
        }
        return { designSystem: saved, findings: result.findings };
      });

      const replace = Effect.fn("DesignSystemService.replace")(function* (
        designSystem: DesignSystem,
        document: string,
        label: string
      ) {
        const { files } = yield* save(label, () =>
          Effect.succeed({
            baselines: {
              ...(designSystem.codeSync && { codeSync: designSystem.codeSync }),
              ...(designSystem.designMd && { designMd: designSystem.designMd }),
              ...(designSystem.sync && { sync: designSystem.sync }),
            },
            designSystem,
            document: { text: document },
            result: null,
          })
        );
        return { files };
      });

      const detect = Effect.flatMap(code.scan, (found) =>
        Effect.map(write(found.designSystem), (w) => w.designSystem)
      );

      // The one place the editor hears of a change, whoever made it: the tool's own writes, an
      // undo, an agent writing the files by hand, a checkout (the files), DESIGN.md, the code.
      yield* Stream.mergeAll(
        [
          // A system component's look is DESIGN.md's component tokens (ADRs 0027, 0041).
          (yield* DesignFiles)
            .changes(["designSystem", "tokens", "component"])
            .pipe(Stream.as(undefined)),
          designMd.changes,
          code.changes,
        ],
        { concurrency: "unbounded" }
      ).pipe(
        Stream.debounce("50 millis"),
        Stream.runForEach(() =>
          Effect.gen(function* () {
            yield* mirror;
            yield* events.publish("designSystem", yield* get);
          })
        ),
        Effect.forkScoped
      );

      return DesignSystemService.of({
        codeOf: (node, options) =>
          Effect.map(
            Effect.all([get, catalogue]),
            ([{ designSystem: ds }, components]) =>
              toCode(node, styleSystem.nodeClasses(ds), {
                componentsFrom: componentsImportBase(paths.settings),
                ...options,
                breakpoints: breakpointsOf(ds),
                catalogue: components,
                designSystem: ds,
              })
          ),
        detect,
        edit,
        get,
        moveBaseline: (side, move) =>
          moveBaseline(side, move).pipe(
            Effect.withSpan("DesignSystemService.moveBaseline")
          ),
        placeDocument: Effect.flatMap(get, ({ designSystem: ds }) =>
          designMd.place(ds)
        ),
        refresh: code.refresh.pipe(Effect.andThen(mirror), Effect.andThen(get)),
        replace,
        write,
      });
    })
  );
}
