/**
 * The code's side of the design system (ADR 0028): the tokens the stylesheets declare, read
 * through the style system once and kept until a stylesheet they come from changes, for every
 * caller; the stylesheets written all or nothing; what the code and the design system agree on
 * (`codeSync` in `design-system.json`); the code compared with the design; and the stylesheet
 * that draws the design's values over the code's in the preview.
 *
 * The code follows the design: a value reaches it on export (`write`), or at once with
 * `codeTokens: auto` (`follow`). Sync's adapter for the code is in `sync-sides.ts`.
 */
import {
  DESIGN_SYSTEM_FILE,
  type DesignSystem,
  type DocumentBaseline,
} from "@ultrapaint/contracts/design-system";
import { BadRequest } from "@ultrapaint/contracts/errors";
import type { TokenComparison } from "@ultrapaint/contracts/sync";
import type { SourceToken, TokenChange } from "@ultrapaint/contracts/tokens";
import type { DesignSystemScan } from "@ultrapaint/framework-api/node";
import {
  Clock,
  Context,
  Effect,
  FileSystem,
  Layer,
  Path,
  PubSub,
  Semaphore,
  Stream,
} from "effect";
import { makeWriteAtomic } from "../atomic-write.ts";
import { makeStampedCache } from "../file-stamp.ts";
import { withAgreement } from "./design-system-files.ts";
import { EditService } from "./edit.ts";
import { RepoPaths } from "./repo-paths.ts";
import { ProjectStyleSystem } from "./style-system.ts";
import { codeAgreement, compareCode, designTokensOf } from "./sync-readings.ts";

/** The tokens the code declares, as the style system reads them. */
export interface CodeTokens {
  readonly byName: ReadonlyMap<string, SourceToken>;
  /** The stylesheets they were read from, repository-relative: none when none could be read. */
  readonly files: readonly string[];
  /** What could not be read. */
  readonly notes: readonly string[];
  readonly tokens: readonly SourceToken[];
}

/** The code's tokens against the design's; `read` says whether any stylesheet was read. */
export type CodeComparison = TokenComparison & { readonly read: boolean };

const nothingRead: CodeTokens = {
  byName: new Map(),
  files: [],
  notes: [],
  tokens: [],
};

export class CodeSide extends Context.Service<
  CodeSide,
  {
    /** The tokens the code declares now: kept until a stylesheet they come from changes. */
    readonly tokens: Effect.Effect<CodeTokens>;
    /**
     * The tokens read again from scratch: after a change the stylesheets read last time would
     * not show, such as a stylesheet that was not there.
     */
    readonly refresh: Effect.Effect<void>;
    /** Each time the code's tokens may have changed: written, or read again. */
    readonly changes: Stream.Stream<void>;
    /** What the stylesheets say, as a first design system by the style system's fixed rules. */
    readonly scan: Effect.Effect<DesignSystemScan>;
    /**
     * What a design system and the code agree on, kept in its `codeSync`: the last agreement,
     * with every value they now share taken as agreed, and what neither has any more dropped.
     */
    readonly agreement: (ds: DesignSystem) => Effect.Effect<DocumentBaseline>;
    /**
     * The code's tokens against the design system's (ADR 0028), against what the two last
     * agreed on: what waits for the code, what the code changed alone, and what both changed.
     */
    readonly comparison: (ds: DesignSystem) => Effect.Effect<CodeComparison>;
    /**
     * Token changes written to the stylesheets where the style system declares them (the
     * export): all of them or, when one file cannot be written, none. With a design system,
     * what it and the code agree on is moved with them, outside the undo history as the
     * stylesheets are.
     */
    readonly write: (
      changes: readonly TokenChange[],
      against: DesignSystem | null
    ) => Effect.Effect<{ readonly files: readonly string[] }, BadRequest>;
    /** The changes written to the code as well when it follows the design (`codeTokens: auto`). */
    readonly follow: (
      changes: readonly TokenChange[],
      against: DesignSystem
    ) => Effect.Effect<{ readonly files: readonly string[] }, BadRequest>;
  }
>()("ultrapaint/server/CodeSide") {
  static readonly layer = Layer.effect(
    CodeSide,
    Effect.gen(function* () {
      const paths = yield* RepoPaths;
      const styleSystem = yield* ProjectStyleSystem;
      const edit = yield* EditService;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const writeAtomic = makeWriteAtomic(fs, path);
      const writes = yield* Semaphore.make(1);
      const changed = yield* PubSub.unbounded<void>();
      const context = {
        anchorDir: paths.anchorDir,
        root: paths.root,
        settings: paths.settings,
      };
      const systemRel = paths.relative(
        path.join(paths.designsDir, DESIGN_SYSTEM_FILE)
      );

      const cache = makeStampedCache(
        fs,
        Effect.try(() => {
          const source = styleSystem.readTokens(context);
          return {
            files: source.files.map((file) => path.resolve(paths.root, file)),
            value: {
              byName: new Map(source.tokens.map((t) => [t.name, t])),
              files: source.files,
              notes: source.notes,
              tokens: source.tokens,
            } satisfies CodeTokens,
          };
        })
      );
      const tokens = cache.get.pipe(
        // A stylesheet that cannot be read leaves the design system's own values in force.
        Effect.orElseSucceed(() => nothingRead)
      );

      const agreement = (ds: DesignSystem) =>
        Effect.map(tokens, (code) => codeAgreement(ds, code.tokens));

      const comparison = (ds: DesignSystem) =>
        Effect.map(tokens, (code): CodeComparison => {
          const design = designTokensOf(ds);
          const [only] = code.files;
          return {
            baseline: ds.codeSync !== undefined,
            diffs: compareCode(
              code.tokens,
              design,
              ds.codeSync ?? null,
              new Set(ds.omitted ?? [])
            ),
            file: code.files.length === 1 && only ? only : "the code",
            notes: [...code.notes],
            read: code.files.length > 0,
            source: "code",
            targets: design.map((t) => ({ kind: t.kind, name: t.name })),
          };
        });

      const readOptional = (file: string) =>
        Effect.orElseSucceed(
          Effect.map(fs.readFileString(file), (text): string | null => text),
          () => null
        );

      /**
       * What the design system and the code agree on, moved after the code was written. A
       * `design-system.json` that does not read is left alone (reading it says why), and one
       * taken away meanwhile stays away.
       */
      const settle = Effect.fnUntraced(function* (ds: DesignSystem) {
        const { agreed } = yield* agreement(ds);
        const at = yield* Clock.currentTimeMillis;
        yield* edit.amend(systemRel, (content) => {
          const next = withAgreement(content, "codeSync", agreed, at);
          return next === null
            ? Effect.fail("unread" as const)
            : Effect.succeed([next, null] as const);
        });
      });

      /**
       * Writes the files a list of token changes comes to, all inside the repository. The
       * stylesheets are outside the designs directory and its undo journal: a file written
       * already is put back as it was when a later one cannot be written.
       */
      const writeFiles = Effect.fnUntraced(function* (
        changes: readonly TokenChange[],
        against: DesignSystem | null
      ) {
        const edits = yield* Effect.try({
          catch: (error) =>
            new BadRequest({
              message: `the stylesheets could not be written: ${String(error)}`,
            }),
          try: () => styleSystem.writeTokens(context, changes),
        });
        const root = path.resolve(paths.root);
        const files: { readonly abs: string; readonly text: string }[] = [];
        for (const written of edits) {
          const abs = path.resolve(root, written.file);
          if (!abs.startsWith(root + path.sep)) {
            return yield* new BadRequest({
              message: `${written.file} is outside the repository`,
            });
          }
          files.push({ abs, text: written.text });
        }
        const before = yield* Effect.forEach(files, ({ abs }) =>
          readOptional(abs)
        );
        const done: number[] = [];
        yield* Effect.forEach(files, ({ abs, text }, i) =>
          writeAtomic(abs, text).pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                done.push(i);
              })
            )
          )
        ).pipe(
          Effect.mapError(
            (error) =>
              new BadRequest({
                message: `the stylesheets could not be written: ${error.message}`,
              })
          ),
          // What was written already goes back, file by file, as far as it can.
          Effect.onError(() =>
            Effect.forEach(done.toReversed(), (i) => {
              const file = files[i];
              const content = before[i];
              if (file === undefined || content === undefined) {
                return Effect.void;
              }
              return (
                content === null
                  ? fs.remove(file.abs, { force: true })
                  : writeAtomic(file.abs, content)
              ).pipe(Effect.ignore({ log: true }));
            })
          )
        );
        if (edits.length > 0) {
          yield* cache.clear;
          if (against !== null) {
            yield* Effect.ignore(settle(against));
          }
          yield* PubSub.publish(changed, undefined);
        }
        return { files: edits.map((e) => e.file) };
      });

      const write = Effect.fn("CodeSide.write")(
        (changes: readonly TokenChange[], against: DesignSystem | null) =>
          writes.withPermits(1)(writeFiles(changes, against))
      );

      return CodeSide.of({
        agreement,
        changes: Stream.fromPubSub(changed),
        comparison,
        follow: (changes, against) =>
          paths.settings.codeTokens === "auto" && changes.length > 0
            ? write(changes, against)
            : Effect.succeed({ files: [] }),
        refresh: cache.clear.pipe(
          Effect.andThen(PubSub.publish(changed, undefined))
        ),
        scan: Effect.sync(() => styleSystem.scan(context)),
        tokens,
        write,
      });
    })
  );
}
