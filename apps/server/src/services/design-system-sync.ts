/**
 * The design-system sync (ADR 0025): reads what the open project has, works out its case and
 * lays out the steps, and says how far the design system and the code have drifted apart. The
 * plan is worked out again whenever something it reads changes, and pushed to the editor, whose
 * Design system tab counts what is left to do.
 */
import { BadRequest, type NotConfigured } from "@ultrapaint/contracts/errors";
import {
  baselineKey,
  type FigmaDecision,
  type FigmaMatch,
  type FigmaMatchInput,
  type FigmaMatchSource,
  type FigmaTokenComparison,
  type SyncBaseline,
  type SyncFacts,
  type SyncPlan,
} from "@ultrapaint/contracts/sync";
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
import { CatalogueService } from "./catalogue.ts";
import { DesignSystemService } from "./design-system.ts";
import { DesignSystemSetupService } from "./design-system-setup.ts";
import {
  caseOf,
  compareFigma,
  driftOf,
  type FigmaSide,
  figmaChanges,
  matchFigma,
  matchKeyOf,
  matchProblem,
  planOf,
  summaryOf,
} from "./design-system-sync-rules.ts";
import { FigmaImportService } from "./figma-import.ts";
import { RepoPaths } from "./repo-paths.ts";
import { ProjectStyleSystem } from "./style-system.ts";

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

/** Keyed in order: the baseline is committed, and merges line by line. */
const sorted = <A>(record: Readonly<Record<string, A>>): Record<string, A> =>
  Object.fromEntries(
    Object.entries(record).sort(([a], [b]) => a.localeCompare(b))
  );

/** What every matched Figma token is in the code, to keep in the baseline by Figma's id. */
const matchesOf = (
  tokens: readonly FigmaSide[],
  matched: ReadonlyMap<string, { by: FigmaMatchSource; to: string | null }>
): Record<string, FigmaMatch> =>
  sorted(
    Object.fromEntries(
      tokens.flatMap((token) => {
        const match = matched.get(token.variable);
        return match
          ? [[matchKeyOf(token), { ...match, figma: token.variable }]]
          : [];
      })
    )
  );

export class DesignSystemSyncService extends Context.Service<
  DesignSystemSyncService,
  {
    /**
     * Figma's tokens against the code's and the last sync's, for the newest import; null when
     * there is none.
     */
    readonly figmaTokens: Effect.Effect<
      FigmaTokenComparison | null,
      NotConfigured | BadRequest
    >;
    /**
     * Writes what Figma changed alone, and the conflicts the user gave to Figma, into the code,
     * and keeps where the two now agree as the baseline of the next sync.
     */
    readonly applyFigma: (
      decisions: readonly FigmaDecision[]
    ) => Effect.Effect<
      { readonly files: readonly string[]; readonly written: number },
      NotConfigured | BadRequest
    >;
    /**
     * Says what Figma tokens of the newest import are in the code (ADR 0025), by where they are
     * in Figma; what cannot be matched as asked is said in `problems`.
     */
    readonly matchFigma: (
      entries: readonly FigmaMatchInput[],
      by: Exclude<FigmaMatchSource, "rule">
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
          const components = yield* (yield* CatalogueService).get(false).pipe(
            Effect.map((c) => c.components.map((component) => component.name)),
            // A catalogue that cannot be built reads as no components, which the plan says.
            Effect.orElseSucceed((): string[] => [])
          );
          const source = yield* Effect.sync(() =>
            styleSystem.readTokens({
              anchorDir: paths.anchorDir,
              root: paths.root,
              settings,
            })
          );
          const designSystem = yield* DesignSystemService;
          const state = yield* designSystem.get;
          const latest = yield* (yield* FigmaImportService).latest;
          const facts: SyncFacts = {
            app: yield* hasApp(paths.anchorDir),
            components: components.length,
            designSystem: state.designSystem !== null,
            ...(latest && { figma: { id: latest.id, name: latest.name } }),
            libraryDirs: [...settings.libraryDirs],
            styleSystem: styleSystem.id,
            stylesheets: settings.hostCss.length,
            tokens: source.tokens.filter((t) => t.own).length,
          };
          const baseline = yield* designSystem.baseline;
          const figmaSynced =
            latest !== null &&
            baseline !== null &&
            baseline.file === latest.name &&
            baseline.at >= latest.createdAt;
          return {
            drift: driftOf(
              state.designSystem,
              source.tokens,
              components,
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
          const styleSystem = yield* ProjectStyleSystem;
          const source = styleSystem.readTokens({
            anchorDir: paths.anchorDir,
            root: paths.root,
            settings: paths.settings,
          });
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
              // The design system's values are the code's: the editor hears they changed.
              yield* project
                .use(Effect.flatMap(DesignSystemService, (d) => d.refresh))
                .pipe(
                  Effect.flatMap((state) =>
                    events.publish("designSystem", state)
                  ),
                  (effect) =>
                    survive(effect, "the design system could not be re-read")
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

      /** The newest import's tokens compared, with what the comparison was made from. */
      const compare = project.use(
        Effect.gen(function* () {
          const latest = yield* (yield* FigmaImportService).latest;
          if (!latest) {
            return null;
          }
          const paths = yield* RepoPaths;
          const figma = yield* (yield* FigmaImportService)
            .tokens(latest.id)
            .pipe(
              Effect.mapError(
                (error) =>
                  new BadRequest({
                    message: `${latest.name} could not be read: ${error.message}`,
                  })
              )
            );
          const code = (yield* ProjectStyleSystem).readTokens({
            anchorDir: paths.anchorDir,
            root: paths.root,
            settings: paths.settings,
          });
          const stored = yield* (yield* DesignSystemService).baseline;
          // A baseline from another Figma file says nothing about this one.
          const baseline = stored?.file === latest.name ? stored : null;
          const diffs = compareFigma(figma.tokens, code.tokens, baseline);
          const own = code.tokens.filter((t) => t.own);
          return {
            baseline,
            code: code.tokens,
            comparison: {
              // Matches saved before any value was taken are no earlier sync to compare with.
              baseline:
                baseline !== null && Object.keys(baseline.figma).length > 0,
              diffs,
              file: latest.name,
              importId: latest.id,
              notes: [...figma.notes],
              targets: own.map((t) => ({ kind: t.kind, name: t.name })),
            } satisfies FigmaTokenComparison,
            figma,
          };
        })
      );

      const figmaTokens = Effect.map(
        compare,
        (found) => found?.comparison ?? null
      );

      const applyFigma = Effect.fn("DesignSystemSyncService.applyFigma")(
        function* (decisions: readonly FigmaDecision[]) {
          const found = yield* compare;
          if (!found) {
            return yield* new BadRequest({
              message: "There is no Figma import to take tokens from.",
            });
          }
          const changes = figmaChanges(found.comparison.diffs, decisions);
          const result = yield* project.use(
            Effect.gen(function* () {
              const designSystem = yield* DesignSystemService;
              const { files } =
                changes.length > 0
                  ? yield* designSystem.setTokens(changes)
                  : { files: [] as readonly string[] };
              // Where Figma and the code stand now, for the next sync to compare against.
              const paths = yield* RepoPaths;
              const code = (yield* ProjectStyleSystem).readTokens({
                anchorDir: paths.anchorDir,
                root: paths.root,
                settings: paths.settings,
              });
              const declared = new Map(
                code.tokens.filter((t) => t.own).map((t) => [t.name, t])
              );
              const figma: Record<string, string> = {};
              const inCode: Record<string, string> = {};
              for (const d of found.comparison.diffs.filter(
                (diff) =>
                  diff.outcome !== "unmatched" && diff.outcome !== "ignored"
              )) {
                const key = baselineKey(d.name, d.theme);
                figma[key] = d.figma;
                const now = declared.get(d.name);
                const value = d.theme ? now?.values?.[d.theme] : now?.value;
                if (value !== undefined) {
                  inCode[key] = value;
                }
              }
              yield* designSystem
                .saveBaseline({
                  at: yield* Clock.currentTimeMillis,
                  code: inCode,
                  figma,
                  file: found.comparison.file,
                  // What the rules matched is kept too: the code changing later does not
                  // move a token the user has seen written.
                  matches: matchesOf(
                    found.figma.tokens,
                    matchFigma(
                      found.figma.tokens,
                      found.code,
                      found.baseline?.matches
                    )
                  ),
                })
                .pipe(
                  Effect.mapError(
                    (error) =>
                      new BadRequest({
                        message: `the baseline could not be saved: ${error.message}`,
                      })
                  )
                );
              return { files, written: changes.length };
            })
          );
          yield* Effect.ignore(plan);
          return result;
        },
        (effect) => baselineLock.withPermits(1)(effect)
      );

      const saveMatches = Effect.fn("DesignSystemSyncService.matchFigma")(
        function* (
          entries: readonly FigmaMatchInput[],
          by: Exclude<FigmaMatchSource, "rule">
        ) {
          const found = yield* compare;
          if (!found) {
            return yield* new BadRequest({
              message: "There is no Figma import to match tokens from.",
            });
          }
          const { file } = found.comparison;
          const tokens = new Map(
            found.figma.tokens.map((t) => [t.variable, t] as const)
          );
          const matches: Record<string, FigmaMatch> = {
            ...found.baseline?.matches,
          };
          const problems: string[] = [];
          let saved = 0;
          for (const entry of entries) {
            const token = tokens.get(entry.variable);
            if (!token) {
              problems.push(
                `${entry.variable} is not a variable or style of ${file}`
              );
              continue;
            }
            const problem = entry.to ? matchProblem(token, entry.to) : null;
            if (problem) {
              problems.push(problem);
              continue;
            }
            const key = matchKeyOf(token);
            if (entry.to === undefined) {
              delete matches[key];
            } else {
              matches[key] = { by, figma: token.variable, to: entry.to };
            }
            saved += 1;
          }
          const next: SyncBaseline = {
            ...(found.baseline ?? { at: 0, code: {}, figma: {} }),
            file,
            matches: sorted(matches),
          };
          const diffs = compareFigma(found.figma.tokens, found.code, next);
          // A match that leaves something to write puts the step back in front of the user.
          const pending = diffs.some(
            (d) => d.outcome === "to-code" || d.outcome === "conflict"
          );
          yield* project
            .use(
              Effect.flatMap(DesignSystemService, (d) =>
                d.saveBaseline(pending ? { ...next, at: 0 } : next)
              )
            )
            .pipe(
              Effect.mapError(
                (error) =>
                  new BadRequest({
                    message: `the matches could not be saved: ${error.message}`,
                  })
              )
            );
          yield* Effect.ignore(plan);
          const unmatched = new Set(
            diffs
              .filter((d) => d.outcome === "unmatched")
              .map((d) => d.variable)
          ).size;
          return { problems, saved, unmatched };
        },
        (effect) => baselineLock.withPermits(1)(effect)
      );

      return DesignSystemSyncService.of({
        applyFigma,
        figmaTokens,
        matchFigma: saveMatches,
        plan,
      });
    })
  );
}
