import {
  COMPONENT_EXTENSION,
  COMPONENTS_DIR,
} from "@ultrapaint/contracts/component-names";
import {
  DESIGN_SYSTEM_FILE,
  type DesignFinding,
  type DesignSystem,
  type DesignSystemState,
} from "@ultrapaint/contracts/design-system";
import type { DesignNode } from "@ultrapaint/contracts/document";
import { BadRequest } from "@ultrapaint/contracts/errors";
import { withTokenChanges } from "@ultrapaint/contracts/token-table";
import type { SourceToken, TokenChange } from "@ultrapaint/contracts/tokens";
import { breakpointsOf } from "@ultrapaint/design-document/breakpoints";
import {
  type CodeOptions,
  componentsImportBase,
  toCode,
} from "@ultrapaint/design-document/code";
import type { DesignSystemScan } from "@ultrapaint/framework-api/node";
import {
  Context,
  Effect,
  FileSystem,
  Layer,
  Path,
  Semaphore,
  Stream,
} from "effect";
import { EventBus } from "../events.ts";
import { makeStampedCache } from "../file-stamp.ts";
import { CodeSide } from "./code-side.ts";
import { DesignMd } from "./design-md.ts";
import {
  type DesignSystemRead,
  readDesignSystem,
  readGivenDesignSystem,
  writeDesignSystem,
} from "./design-system-files.ts";
import { DESIGN_TOKENS_FILE } from "./dtcg.ts";
import { type EditFailure, EditService, type EditTransaction } from "./edit.ts";
import { FigmaBaseline } from "./figma-baseline.ts";
import { RepoPaths } from "./repo-paths.ts";
import { ProjectStyleSystem } from "./style-system.ts";
import { designTokensOf } from "./sync-readings.ts";

/**
 * The design system as the project records it: `design-system.json` at the root of the designs
 * directory, and `design.tokens.json` beside it with every value, in the Design Tokens format
 * (ADR 0035). `/init` has an agent write it through `write`, which validates; `detect` writes
 * what the fixed-rule scan finds, for a project without an agent. Each change is one undo step,
 * and the editor hears of every change once, whoever made it: the tool, an undo, an agent
 * writing the files by hand, a checkout, the code.
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
    readonly get: Effect.Effect<DesignSystemState>;
    /**
     * The state read again, the stylesheets and the components from scratch: after a change to
     * them that the files read last time would not show, such as a stylesheet that was not there.
     */
    readonly refresh: Effect.Effect<DesignSystemState>;
    /** What the stylesheets say, with the catalogue's categories for the components. */
    readonly scan: Effect.Effect<DesignSystemScan>;
    /**
     * A token's value set in the design system, added when it does not list it yet, or taken out
     * (ADR 0028); one undo step. With `codeTokens: auto` the code is written too. Returns the
     * files written and the value before, for an undo.
     */
    readonly setToken: (change: TokenChange) => Effect.Effect<
      {
        readonly files: readonly string[];
        readonly previous: string | null;
      },
      BadRequest
    >;
    /** Several token changes to the design system at once, in one undo step. */
    readonly setTokens: (
      changes: readonly TokenChange[],
      label?: string
    ) => Effect.Effect<{ readonly files: readonly string[] }, BadRequest>;
    /**
     * A node of the designs as the application's code writes it: the markup the design
     * document's, the classes the style system's (ADR 0024), at the design system's breakpoints.
     */
    readonly codeOf: (
      node: DesignNode,
      options: Omit<CodeOptions, "breakpoints">
    ) => Effect.Effect<string>;
    /**
     * Saves the design system and `DESIGN.md` as given, in one undo step: for Sync, which has
     * merged them itself (ADR 0027).
     */
    readonly replace: (
      designSystem: DesignSystem,
      document: string,
      label: string
    ) => Effect.Effect<void, EditFailure>;
    /**
     * Validates and saves; `document` replaces `DESIGN.md` when given, at the root. Its mirrored
     * token groups are the design system's, filled in whatever it says; `findings` are what the
     * format's linter says and what was put back. A linter error refuses the whole write.
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
      const edit = yield* EditService;
      const code = yield* CodeSide;
      const designMd = yield* DesignMd;
      const figma = yield* FigmaBaseline;
      const styleSystem = yield* ProjectStyleSystem;
      const events = yield* EventBus;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const systemFile = path.join(paths.designsDir, DESIGN_SYSTEM_FILE);
      const systemRel = paths.relative(systemFile);
      const tokensFile = path.join(paths.designsDir, DESIGN_TOKENS_FILE);
      const tokensRel = paths.relative(tokensFile);
      const componentsPrefix = `${paths.relative(path.join(paths.designsDir, COMPONENTS_DIR))}/`;

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
            value: { system, tokens },
          })
        )
      );

      /**
       * The design system the files come to with the code's values (`design-system-files.ts`):
       * kept until the files or the code change.
       */
      let lastRead: {
        readonly code: ReadonlyMap<string, SourceToken>;
        readonly read: DesignSystemRead;
        readonly texts: Effect.Success<typeof filesCache.get>;
      } | null = null;
      const filesRead = Effect.gen(function* () {
        const texts = yield* filesCache.get;
        const { byName } = yield* code.tokens;
        if (!(lastRead?.texts === texts && lastRead.code === byName)) {
          lastRead = {
            code: byName,
            read: readDesignSystem(texts, byName),
            texts,
          };
        }
        return lastRead.read;
      });

      /**
       * Writes the design system: `design-system.json` without its values and `design.tokens.json`
       * with them. Refused while the tokens file cannot be read: writing it again would lose the
       * values it holds.
       */
      const writeFiles = Effect.fnUntraced(function* (
        tx: EditTransaction,
        ds: DesignSystem
      ) {
        const { tokensProblem } = yield* filesRead;
        if (tokensProblem !== null) {
          return yield* new BadRequest({
            message: `${tokensProblem}. The design system is written again once it reads.`,
          });
        }
        const texts = writeDesignSystem(ds);
        yield* tx.write(systemRel, texts.system);
        yield* tx.write(tokensRel, texts.tokens);
      });

      /**
       * A write and what follows from it on disk (DESIGN.md's front matter, the code with
       * `codeTokens: auto`) run one at a time, and finish before the write returns: whoever
       * reads the files next reads them current. Only telling the editor waits for the changes
       * to settle.
       */
      const writes = yield* Semaphore.make(1);
      const serially = writes.withPermits(1);

      /**
       * DESIGN.md's front matter brought up to the design system as the files read when its
       * turn comes: inside a write, or under its lock, so a reading made before a write (or
       * before DESIGN.md was placed) never follows after it.
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

      const scan = code.scan.pipe(Effect.withSpan("DesignSystemService.scan"));

      /**
       * A design system the tool changed itself (a token, a sync) saved as it is, in one undo
       * step, with what it and the code agree on worked out again.
       */
      const save = Effect.fn("DesignSystemService.save")(function* (
        designSystem: DesignSystem,
        label: string,
        document?: string
      ) {
        const saved: DesignSystem = {
          ...designSystem,
          codeSync: yield* code.agreement(designSystem),
        };
        yield* edit.transaction(label, (tx) =>
          Effect.gen(function* () {
            yield* writeFiles(tx, saved);
            if (document !== undefined) {
              yield* tx.write(designMd.file, document);
            }
          })
        );
        yield* mirror;
        return saved;
      });

      const write = Effect.fn("DesignSystemService.write")(function* (
        input: unknown,
        document?: string
      ) {
        const { byName } = yield* code.tokens;
        const before = yield* get;
        const given = readGivenDesignSystem(input, {
          code: byName,
          current: before.designSystem,
        });
        if ("problem" in given) {
          return yield* new BadRequest({ message: given.problem });
        }
        const filled = given.designSystem;
        // A sync's baselines are the tool's, not the writer's: an agent rewriting the design
        // system without them keeps the ones there are, or the one waiting for a design system.
        const kept =
          filled.sync ??
          before.designSystem?.sync ??
          (yield* figma.pending) ??
          undefined;
        const keptDocument = filled.designMd ?? before.designSystem?.designMd;
        const keptCode = filled.codeSync ?? before.designSystem?.codeSync;
        const designSystem: DesignSystem = {
          ...filled,
          codeSync: yield* code.agreement({
            ...filled,
            ...(keptCode && { codeSync: keptCode }),
          }),
        };
        const written =
          document === undefined
            ? null
            : yield* designMd.toWrite(document, {
                ...designSystem,
                ...(keptDocument && { designMd: keptDocument }),
              });
        const saved: DesignSystem = {
          ...designSystem,
          ...(kept && { sync: kept }),
          ...(written
            ? { designMd: written.designMd }
            : keptDocument && { designMd: keptDocument }),
        };
        yield* edit.transaction("Update the design system", (tx) =>
          Effect.gen(function* () {
            yield* writeFiles(tx, saved);
            if (written) {
              yield* tx.write(designMd.file, written.text);
              // The designs directory's DESIGN.md is replaced by the root's.
              if (before.document?.legacy) {
                yield* tx.remove(before.document.path);
              }
            }
          })
        );
        yield* mirror;
        return { designSystem, findings: written?.findings ?? [] };
      }, serially);

      const replace = Effect.fn("DesignSystemService.replace")(function* (
        designSystem: DesignSystem,
        document: string,
        label: string
      ) {
        yield* save(designSystem, label, document);
      }, serially);

      const detect = Effect.flatMap(scan, (found) =>
        Effect.map(write(found.designSystem), (w) => w.designSystem)
      );

      const noDesignSystem = new BadRequest({
        message:
          "There is no design system yet to change a token in: Sync makes one.",
      });

      const setTokens = Effect.fn("DesignSystemService.setTokens")(function* (
        changes: readonly TokenChange[],
        label = "Change tokens"
      ) {
        const { designSystem: ds } = yield* filesRead;
        if (!ds) {
          return yield* noDesignSystem;
        }
        const saved = yield* save(withTokenChanges(ds, changes), label).pipe(
          Effect.mapError(
            (error) =>
              new BadRequest({
                message: `the design system could not be written: ${error.message}`,
              })
          )
        );
        const followed = yield* code.follow(changes, saved);
        return { files: [systemRel, tokensRel, ...followed.files] };
      }, serially);

      const setToken = Effect.fn("DesignSystemService.setToken")(function* (
        change: TokenChange
      ) {
        const { designSystem: ds } = yield* filesRead;
        if (!ds) {
          return yield* noDesignSystem;
        }
        const before = designTokensOf(ds).find((t) => t.name === change.name);
        const { files } = yield* setTokens(
          [change],
          `Change ${change.name}${change.theme ? ` in ${change.theme}` : ""}`
        );
        return {
          files,
          previous:
            (change.theme ? before?.values?.[change.theme] : before?.value) ??
            null,
        };
      });

      // The one place the editor hears of a change, whoever made it: the tool's own writes, an
      // undo, an agent writing the files by hand, a checkout (the files), DESIGN.md, the code.
      yield* Stream.mergeAll(
        [
          events.subscribe("file.changed").pipe(
            Stream.filter(
              ({ file }) =>
                file === systemRel ||
                file === tokensRel ||
                // A system component's look is DESIGN.md's component tokens (ADRs 0027, 0041).
                (file.startsWith(componentsPrefix) &&
                  file.endsWith(COMPONENT_EXTENSION))
            ),
            Stream.as(undefined)
          ),
          designMd.changes,
          code.changes,
        ],
        { concurrency: "unbounded" }
      ).pipe(
        Stream.debounce("50 millis"),
        Stream.runForEach(() =>
          Effect.gen(function* () {
            yield* serially(mirror);
            yield* events.publish("designSystem", yield* get);
          })
        ),
        Effect.forkScoped
      );

      return DesignSystemService.of({
        codeOf: (node, options) =>
          Effect.map(get, ({ designSystem: ds }) =>
            toCode(node, styleSystem.nodeClasses(ds), {
              componentsFrom: componentsImportBase(paths.settings),
              ...options,
              breakpoints: breakpointsOf(ds),
              designSystem: ds,
            })
          ),
        detect,
        get,
        refresh: code.refresh.pipe(
          Effect.andThen(serially(mirror)),
          Effect.andThen(get)
        ),
        replace,
        scan,
        setToken,
        setTokens,
        write,
      });
    })
  );
}
