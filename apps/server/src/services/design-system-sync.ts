/**
 * The design-system sync (ADR 0025): reads what the open project has, works out its case and
 * lays out the steps, and says how far the design system and the code have drifted apart. The
 * plan is worked out again whenever something it reads changes, and pushed to the editor, whose
 * Design system tab counts what is left to do.
 */
import {
  type DesignSystem,
  type DocumentMatch,
  designSystemTokenNames,
} from "@ultrapaint/contracts/design-system";
import { BadRequest, type NotConfigured } from "@ultrapaint/contracts/errors";
import {
  baselineKey,
  type FigmaMatch,
  type FigmaMatchSource,
  type MatchSource,
  type SyncBaseline,
  type SyncFacts,
  type SyncPlan,
  type TokenComparison,
  type TokenDecision,
  type TokenMatchInput,
  type TokenSourceKind,
} from "@ultrapaint/contracts/sync";
import type { TokenChange } from "@ultrapaint/contracts/tokens";
import { emptyGroups, SECTIONS } from "@ultrapaint/design-md/format";
import { flatten } from "@ultrapaint/design-md/merge";
import { mirrorOf } from "@ultrapaint/design-md/mirror";
import { parse } from "@ultrapaint/design-md/parse";
import {
  documentPathOf,
  documentTokens,
  groupsOf,
} from "@ultrapaint/design-md/tokens";
import { renameRefs, withMirror } from "@ultrapaint/design-md/write";
import { plural } from "@ultrapaint/shared/text";
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
  compareDocument,
  compareFigma,
  documentSide,
  driftOf,
  type FigmaSide,
  listTokens,
  matchFigma,
  matchKeyOf,
  matchProblem,
  planOf,
  summaryOf,
  tokenChanges,
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

/** The tokens a write adds to the code that the design system does not list yet, with values. */
const newTokens = (ds: DesignSystem, changes: readonly TokenChange[]) => {
  const listed = new Set(designSystemTokenNames(ds));
  return changes.flatMap((c) =>
    c.theme === undefined && c.value !== undefined && !listed.has(c.name)
      ? [{ name: c.name, value: c.value }]
      : []
  );
};

/**
 * DESIGN.md once its tokens are taken (ADR 0027): every matched token under the code's name, its
 * references renamed; the colours, radii and spacing the design system's, with the code's
 * values; what is still unmatched kept as the document has it; its text styles as they are, for
 * the agent. Null when its YAML does not read.
 */
const documentAfter = (
  text: string,
  diffs: TokenComparison["diffs"],
  ds: DesignSystem
): string | null => {
  const renames = new Map<string, string>();
  for (const d of diffs) {
    if (d.outcome === "unmatched" || d.outcome === "ignored") {
      continue;
    }
    const to = documentPathOf(d.name);
    if (to !== null && to !== d.variable) {
      renames.set(d.variable, to);
    }
  }
  const renamed = renameRefs(text, renames);
  const unmatched = new Set(
    diffs.filter((d) => d.outcome === "unmatched").map((d) => d.variable)
  );
  const own = groupsOf(parse(renamed)).groups;
  const kept = <A>(group: "colors" | "rounded" | "spacing") =>
    Object.fromEntries(
      Object.entries(own[group]).filter(([key]) =>
        unmatched.has(`${group}.${key}`)
      )
    ) as Record<string, A>;
  const mirror = mirrorOf(ds).groups;
  const written = withMirror(renamed, {
    ...emptyGroups(),
    colors: { ...mirror.colors, ...kept<string>("colors") },
    rounded: { ...mirror.rounded, ...kept<string>("rounded") },
    spacing: { ...mirror.spacing, ...kept<number | string>("spacing") },
    typography: own.typography,
  });
  return "problem" in written ? null : written.text;
};

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
     * A source's tokens against the code's and the last agreement's: the newest Figma import's
     * (ADR 0025) or DESIGN.md's (ADR 0027); null when there is no such source.
     */
    readonly tokens: (
      source: TokenSourceKind
    ) => Effect.Effect<TokenComparison | null, NotConfigured | BadRequest>;
    /**
     * Writes what the source changed alone, and the conflicts the user gave to it, into the
     * code, and keeps where the two now agree for the next sync.
     */
    readonly apply: (
      source: TokenSourceKind,
      decisions: readonly TokenDecision[]
    ) => Effect.Effect<
      { readonly files: readonly string[]; readonly written: number },
      NotConfigured | BadRequest
    >;
    /**
     * Says what a source's tokens are in the code, by where they are in the source; what cannot
     * be matched as asked is said in `problems`.
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
              source: "figma",
              targets: own.map((t) => ({ kind: t.kind, name: t.name })),
            } satisfies TokenComparison,
            figma,
          };
        })
      );

      const figmaTokens = Effect.map(
        compare,
        (found) => found?.comparison ?? null
      );

      const applyFigma = Effect.fn("DesignSystemSyncService.applyFigma")(
        function* (decisions: readonly TokenDecision[]) {
          const found = yield* compare;
          if (!found) {
            return yield* new BadRequest({
              message: "There is no Figma import to take tokens from.",
            });
          }
          const changes = tokenChanges(found.comparison.diffs, decisions);
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
                figma[key] = d.source;
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
          entries: readonly TokenMatchInput[],
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

      /** DESIGN.md's tokens compared, with what the comparison was made from (ADR 0027). */
      const compareDesign = project.use(
        Effect.gen(function* () {
          const { designSystem: ds, document } =
            yield* (yield* DesignSystemService).get;
          if (!(ds && document) || document.legacy) {
            return null;
          }
          const paths = yield* RepoPaths;
          const code = (yield* ProjectStyleSystem).readTokens({
            anchorDir: paths.anchorDir,
            root: paths.root,
            settings: paths.settings,
          });
          const { problems, tokens } = documentTokens(parse(document.text));
          const side = documentSide(tokens);
          const baseline = ds.designMd ?? null;
          const typography = document.held
            .filter((h) => h.path.startsWith("typography."))
            .map((h) => h.path);
          const own = code.tokens.filter((t) => t.own);
          return {
            code: code.tokens,
            comparison: {
              baseline: baseline !== null && baseline.at > 0,
              diffs: compareDocument(side, code.tokens, baseline),
              file: document.path,
              notes: [
                ...problems,
                ...(typography.length > 0
                  ? [
                      `${plural(typography.length, "text style setting")} of ${document.path} differ from the code's (${typography.slice(0, 4).join(", ")}${typography.length > 4 ? ", …" : ""}): a text style is several tokens, so /sync design settles them with you.`,
                    ]
                  : []),
              ],
              source: "design",
              targets: own.map((t) => ({ kind: t.kind, name: t.name })),
            } satisfies TokenComparison,
            designSystem: ds,
            side,
          };
        })
      );

      const designTokens = Effect.map(
        compareDesign,
        (found) => found?.comparison ?? null
      );

      const noDocument = new BadRequest({
        message:
          "There is no DESIGN.md at the root of the repository, beside a design system, to take tokens from.",
      });

      /**
       * DESIGN.md's tokens taken (ADR 0027): the code takes what the document changed alone and
       * the conflicts given to it; the design system lists the tokens new to it; the document is
       * rewritten in the code's names, its references with it, what was left out of the code
       * taken out of it, and what is still unmatched kept.
       */
      const applyDesign = Effect.fn("DesignSystemSyncService.applyDesign")(
        function* (decisions: readonly TokenDecision[]) {
          const found = yield* compareDesign;
          if (!found) {
            return yield* noDocument;
          }
          const { diffs } = found.comparison;
          const changes = tokenChanges(diffs, decisions);
          const result = yield* project.use(
            Effect.gen(function* () {
              const service = yield* DesignSystemService;
              const { files } =
                changes.length > 0
                  ? yield* service.setTokens(changes)
                  : { files: [] as readonly string[] };
              const after = yield* service.get;
              const ds = after.designSystem ?? found.designSystem;
              const listed = listTokens(ds, newTokens(ds, changes));
              const { document } = after;
              if (!document) {
                return yield* noDocument;
              }
              const text = documentAfter(document.text, diffs, listed);
              if (text === null) {
                return yield* new BadRequest({
                  message: `${document.path}'s YAML does not read, so it cannot be rewritten.`,
                });
              }
              const mirror = mirrorOf(listed).groups;
              const agreed = {
                // A text style is the agent's to settle: what was agreed on them stays.
                ...Object.fromEntries(
                  Object.entries(ds.designMd?.agreed ?? {}).filter(([k]) =>
                    k.startsWith("typography.")
                  )
                ),
                ...Object.fromEntries(
                  Object.entries(flatten({ ...mirror, typography: {} })).map(
                    ([k, v]) => [k, String(v)]
                  )
                ),
              };
              yield* service
                .replace(
                  {
                    ...listed,
                    designMd: { agreed, at: yield* Clock.currentTimeMillis },
                  },
                  text,
                  `Take ${document.path}'s tokens into the code`
                )
                .pipe(
                  Effect.mapError(
                    (error) =>
                      new BadRequest({
                        message: `${document.path} could not be written: ${error.message}`,
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

      const matchDesign = Effect.fn("DesignSystemSyncService.matchDesign")(
        function* (
          entries: readonly TokenMatchInput[],
          by: Exclude<MatchSource, "rule">
        ) {
          const found = yield* compareDesign;
          if (!found) {
            return yield* noDocument;
          }
          const tokens = new Map(
            found.side.map((t) => [t.variable, t] as const)
          );
          const ds = found.designSystem;
          const matches: Record<string, DocumentMatch> = {
            ...ds.designMd?.matches,
          };
          const problems: string[] = [];
          let saved = 0;
          for (const entry of entries) {
            const token = tokens.get(entry.variable);
            if (!token) {
              problems.push(
                `${entry.variable} is not a token of ${found.comparison.file}`
              );
              continue;
            }
            const problem = entry.to ? matchProblem(token, entry.to) : null;
            if (problem) {
              problems.push(problem);
              continue;
            }
            if (entry.to === undefined) {
              delete matches[entry.variable];
            } else {
              matches[entry.variable] = { by, to: entry.to };
            }
            saved += 1;
          }
          const next = {
            // Matches saved before anything is taken are no agreement yet (`at` 0).
            ...(ds.designMd ?? { agreed: {}, at: 0 }),
            matches: sorted(matches),
          };
          yield* project
            .use(
              Effect.flatMap(DesignSystemService, (d) =>
                d.write({ ...ds, designMd: next })
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
          const unmatched = compareDocument(
            found.side,
            found.code,
            next
          ).filter((d) => d.outcome === "unmatched").length;
          return { problems, saved, unmatched };
        },
        (effect) => baselineLock.withPermits(1)(effect)
      );

      return DesignSystemSyncService.of({
        apply: (source, decisions) =>
          source === "figma" ? applyFigma(decisions) : applyDesign(decisions),
        match: (source, entries, by) =>
          source === "figma"
            ? saveMatches(entries, by)
            : matchDesign(entries, by),
        plan,
        tokens: (source) => (source === "figma" ? figmaTokens : designTokens),
      });
    })
  );
}
