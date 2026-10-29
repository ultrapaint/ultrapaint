/**
 * The design-system sync (ADR 0025): reads what the open project has, works out its case and
 * lays out the steps, and says how far the design system and the code have drifted apart. The
 * plan is worked out again whenever something it reads changes, and pushed to the editor, whose
 * Design system tab counts what is left to do.
 *
 * A side's tokens (the code's, Figma's, DESIGN.md's) are compared, taken and matched the same way
 * whichever it is: its adapter (`sync-sides.ts`) reads and writes it, the engine
 * (`sync-engine.ts`) says what each value comes to and what the user's picks change.
 */
import { BadRequest, type NotConfigured } from "@ultrapaint/contracts/errors";
import type {
  MatchSource,
  SyncFacts,
  SyncPlan,
  TokenComparison,
  TokenDecision,
  TokenMatchInput,
  TokenSourceKind,
} from "@ultrapaint/contracts/sync";
import { SECTIONS } from "@ultrapaint/design-md/format";
import {
  Clock,
  Context,
  Effect,
  FiberHandle,
  FileSystem,
  Layer,
  Path,
  PubSub,
  Schema,
  Semaphore,
  Stream,
} from "effect";
import { EventBus } from "../events.ts";
import { ProjectManager } from "../project.ts";
import { CodeSide } from "./code-side.ts";
import { DesignSystemService } from "./design-system.ts";
import { DesignSystemSetupService } from "./design-system-setup.ts";
import { FigmaImportService } from "./figma-import.ts";
import { Migration } from "./migration.ts";
import { RepoPaths } from "./repo-paths.ts";
import { ProjectStyleSystem } from "./style-system.ts";
import {
  changesOf,
  matchEntries,
  namedDiffs,
  settledKeys,
} from "./sync-engine.ts";
import { caseOf, codeCounts, driftOf, planOf, summaryOf } from "./sync-plan.ts";
import { figmaBaselineOf, syncSides } from "./sync-sides.ts";

const STYLESHEET_RE = /\.css$/;

const Dependencies = Schema.optional(
  Schema.Record(Schema.String, Schema.Unknown)
);

/** The parts of a package.json that say whether it renders with React. */
const decodeManifest = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Struct({
      dependencies: Dependencies,
      devDependencies: Dependencies,
      peerDependencies: Dependencies,
    })
  )
);

/**
 * One change seen, whatever happens to it: a reading that fails or breaks is logged, and the
 * next change tries again. The loops that call this run for as long as the server does.
 */
const survive = <A, E, R>(effect: Effect.Effect<A, E, R>, what: string) =>
  effect.pipe(
    Effect.asVoid,
    Effect.catchCause((cause) => Effect.logWarning(what, cause))
  );

/**
 * The format's sections a DESIGN.md has with nothing under them, or all of them when its prose is
 * in none (ADR 0027): what `/sync describe` has an agent write.
 */
const unwrittenOf = (
  sections: readonly {
    readonly section: string | null;
    readonly text: string;
  }[]
) => {
  const known = sections.filter((s) => s.section !== null);
  return known.length === 0
    ? SECTIONS.length
    : known.filter((s) => s.text.trim() === "").length;
};

export class DesignSystemSyncService extends Context.Service<
  DesignSystemSyncService,
  {
    /**
     * A source's tokens against the design system's and the last agreement's: the newest Figma
     * import's (ADR 0025), DESIGN.md's (ADR 0027) or the code's (ADR 0028); null when there is no
     * such source, or no design system to compare the code with.
     */
    readonly tokens: (
      source: TokenSourceKind
    ) => Effect.Effect<TokenComparison | null, NotConfigured | BadRequest>;
    /**
     * Takes what the source changed alone, and the conflicts the user gave to it, into the
     * design system (into the code while there is no design system yet), and keeps where the two
     * now agree for the next sync. For the code, what the design system changed and the
     * conflicts given to it are written to the code: the export; `only` keeps to one direction,
     * and `tokens`, when it names any, to those tokens (by name, or `name@theme`).
     */
    readonly apply: (
      source: TokenSourceKind,
      decisions: readonly TokenDecision[],
      only?: "export" | "import",
      tokens?: readonly string[]
    ) => Effect.Effect<
      { readonly files: readonly string[]; readonly written: number },
      NotConfigured | BadRequest
    >;
    /**
     * Says what a source's tokens are in the design system, by where they are in the source;
     * what cannot be matched as asked is said in `problems`. The code's are matched by name.
     */
    readonly match: (
      source: TokenSourceKind,
      entries: readonly TokenMatchInput[],
      by: Exclude<MatchSource, "rule">
    ) => Effect.Effect<
      {
        readonly problems: readonly string[];
        readonly saved: number;
        readonly unmatched: number;
      },
      NotConfigured | BadRequest
    >;
    /** The plan as the project is now; also pushed to the editor. */
    readonly plan: Effect.Effect<SyncPlan, NotConfigured>;
  }
>()("ultrapaint/server/DesignSystemSyncService") {
  static readonly layer = Layer.effect(
    DesignSystemSyncService,
    Effect.gen(function* () {
      const project = yield* ProjectManager;
      const setup = yield* DesignSystemSetupService;
      const events = yield* EventBus;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      // One reading at a time: they read the catalogue and the code.
      const lock = yield* Semaphore.make(1);
      // Taking from Figma and saving matches read the baseline and write it back whole: two at
      // once would lose one's matches.
      const baselineLock = yield* Semaphore.make(1);

      /** Whether the package the pages resolve from renders with React. */
      const hasApp = (anchorDir: string) =>
        fs.readFileString(path.join(anchorDir, "package.json")).pipe(
          Effect.flatMap(decodeManifest),
          Effect.map((manifest) =>
            [
              manifest.dependencies,
              manifest.devDependencies,
              manifest.peerDependencies,
            ].some((deps) => deps?.react !== undefined)
          ),
          // No manifest, or one that does not read: no application to speak of.
          Effect.orElseSucceed(() => false)
        );

      const read = project.use(
        Effect.gen(function* () {
          const paths = yield* RepoPaths;
          const styleSystem = yield* ProjectStyleSystem;
          const { settings } = paths;
          const code = yield* CodeSide;
          const source = yield* code.tokens;
          const state = yield* (yield* DesignSystemService).get;
          const latest = yield* (yield* FigmaImportService).latest;
          const old = yield* (yield* Migration).left.pipe(
            // Pages that cannot be read say nothing of what they hold.
            Effect.orElseSucceed(() => ({ drawn: 0, left: 0, specs: 0 }))
          );
          const ds = state.designSystem;
          const comparison = ds ? yield* code.comparison(ds) : null;
          const codeTokens = comparison?.read
            ? codeCounts(comparison.diffs)
            : undefined;
          const facts: SyncFacts = {
            app: yield* hasApp(paths.anchorDir),
            ...(state.document && {
              designMd: {
                held: state.document.held.length,
                legacy: state.document.legacy,
                path: state.document.path,
                unwritten: unwrittenOf(state.document.sections),
              },
            }),
            designSystem: state.designSystem !== null,
            ...(latest && { figma: { id: latest.id, name: latest.name } }),
            libraryDirs: [...settings.libraryDirs],
            ...(old.drawn + old.left + old.specs > 0 && {
              oldInstances: old,
            }),
            styleSystem: styleSystem.id,
            stylesheets: settings.hostCss.length,
            tokens: source.tokens.filter((t) => t.own).length,
            ...(codeTokens && { codeTokens }),
          };
          const baseline = latest ? yield* figmaBaselineOf(latest.name) : null;
          const figmaSynced =
            latest !== null &&
            baseline !== null &&
            baseline.at >= latest.createdAt;
          return {
            drift: driftOf(
              state.designSystem,
              source.tokens,
              source.files.length > 0
            ),
            facts,
            figmaSynced,
          };
        })
      );

      const plan = Effect.gen(function* () {
        const found = yield* read;
        const steps = planOf({ ...found, setup: yield* setup.get });
        const kind = caseOf(found.facts);
        const result: SyncPlan = {
          at: yield* Clock.currentTimeMillis,
          case: kind,
          drift: found.drift,
          facts: found.facts,
          steps,
          summary: summaryOf(kind, steps),
        };
        yield* events.publish("syncPlan", result);
        return result;
      }).pipe(
        lock.withPermits(1),
        Effect.withSpan("DesignSystemSyncService.plan")
      );

      // The code the plan reads is outside the designs directory, which is all the pages
      // watch: the stylesheets' directories and the component directories are watched here,
      // again for each project that opens.
      const pokes = yield* PubSub.unbounded<undefined>();
      const watching = yield* FiberHandle.make<void, never>();
      const codeDirs = project.use(
        Effect.gen(function* () {
          const paths = yield* RepoPaths;
          const source = yield* (yield* CodeSide).tokens;
          return [
            ...new Set([
              ...source.files
                .filter((f) => !f.includes("node_modules"))
                .map((f) => path.dirname(path.resolve(paths.root, f))),
              ...paths.settings.libraryDirs.map((d) =>
                path.resolve(paths.root, d)
              ),
            ]),
          ];
        })
      );
      // The project's info is published often; the watchers change only with the directories.
      let watched = "";
      const rewatch = Effect.gen(function* () {
        const dirs = yield* Effect.orElseSucceed(codeDirs, (): string[] => []);
        const key = dirs.join("\n");
        if (key === watched) {
          return;
        }
        watched = key;
        const watch = Stream.mergeAll(
          dirs.map((dir) =>
            fs.watch(dir, { recursive: true }).pipe(
              // A directory that cannot be watched only means its changes are seen later.
              Stream.catch(() => Stream.empty)
            )
          ),
          { concurrency: "unbounded" }
        ).pipe(
          Stream.filter(
            (event) =>
              STYLESHEET_RE.test(event.path) || event.path.endsWith(".tsx")
          ),
          Stream.debounce("150 millis"),
          Stream.runForEach(() =>
            Effect.gen(function* () {
              // The preview draws the design over the code's values, and DESIGN.md mirrors the
              // components' classes: both are read again, and the editor hears of it.
              yield* survive(
                project.use(
                  Effect.flatMap(DesignSystemService, (d) => d.refresh)
                ),
                "the design system could not be re-read"
              );
              yield* PubSub.publish(pokes, undefined);
            })
          )
        );
        yield* FiberHandle.run(watching, watch);
      });
      yield* events.subscribe("project").pipe(
        Stream.debounce("200 millis"),
        Stream.runForEach(() =>
          survive(rewatch, "the code's directories could not be watched")
        ),
        Effect.forkScoped
      );

      // Whatever the plan reads changed: the project opened, the design system was written,
      // a step moved, a stylesheet or a component file changed.
      const triggers = Stream.mergeAll(
        [
          Stream.fromPubSub(pokes),
          Stream.map(events.subscribe("project"), () => undefined),
          Stream.map(events.subscribe("designSystem"), () => undefined),
          Stream.map(events.subscribe("dsSetup"), () => undefined),
          events.subscribe("file.changed").pipe(
            Stream.filter(
              ({ file }) => STYLESHEET_RE.test(file) || file.endsWith(".tsx")
            ),
            Stream.map(() => undefined)
          ),
        ],
        { concurrency: "unbounded" }
      );
      yield* triggers.pipe(
        Stream.debounce("400 millis"),
        Stream.runForEach(() =>
          plan.pipe(
            // Nothing open is no plan to speak of; a reading that failed is logged, and the
            // next change tries again.
            Effect.catchTag("NotConfigured", () => Effect.void),
            (effect) => survive(effect, "the sync plan could not be worked out")
          )
        ),
        Effect.forkScoped
      );

      /** A side read and compared, through its adapter (`sync-sides.ts`). */
      const readSide = (source: TokenSourceKind) =>
        project.use(syncSides[source].read);

      /**
       * What the user picked, written: the engine works out the changes each way and the values
       * the sync settles, the side writes them and moves its baseline forward.
       */
      const apply = Effect.fn("DesignSystemSyncService.apply")(
        function* (
          source: TokenSourceKind,
          decisions: readonly TokenDecision[],
          only?: "export" | "import",
          tokens: readonly string[] = []
        ) {
          const reading = yield* readSide(source);
          if (!reading) {
            return yield* new BadRequest({
              message: syncSides[source].missing("take"),
            });
          }
          const chosen = namedDiffs(reading.comparison.diffs, tokens);
          const result = yield* project.use(
            reading.write(
              changesOf(chosen, decisions, only),
              settledKeys(chosen, decisions, only)
            )
          );
          yield* Effect.ignore(plan);
          return result;
        },
        (effect) => baselineLock.withPermits(1)(effect)
      );

      const byName = new BadRequest({
        message:
          "The code's tokens are matched to the design system's by name: there is nothing to match.",
      });

      /** Matches an agent or the user gives, checked by the engine and kept by the side. */
      const match = Effect.fn("DesignSystemSyncService.match")(
        function* (
          source: TokenSourceKind,
          entries: readonly TokenMatchInput[],
          by: Exclude<MatchSource, "rule">
        ) {
          const side = syncSides[source];
          if (side.byName) {
            return yield* byName;
          }
          const reading = yield* readSide(source);
          if (!reading) {
            return yield* new BadRequest({ message: side.missing("match") });
          }
          if (!reading.matching) {
            return yield* byName;
          }
          const { problems, set } = matchEntries(
            reading.matching.tokens,
            entries,
            by,
            reading.matching.what
          );
          const diffs = yield* project.use(reading.matching.save(set));
          yield* Effect.ignore(plan);
          const unmatched = new Set(
            diffs
              .filter((d) => d.outcome === "unmatched")
              .map((d) => d.variable)
          ).size;
          return { problems, saved: set.size, unmatched };
        },
        (effect) => baselineLock.withPermits(1)(effect)
      );

      return DesignSystemSyncService.of({
        apply,
        match,
        plan,
        tokens: (source) =>
          Effect.map(
            readSide(source),
            (reading) => reading?.comparison ?? null
          ),
      });
    })
  );
}
