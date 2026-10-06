/**
 * The design-system sync (ADR 0025): reads what the open project has, works out its case and
 * lays out the steps, and says how far the design system and the code have drifted apart. The
 * plan is worked out again whenever something it reads changes, and pushed to the editor, whose
 * Design system tab counts what is left to do.
 */
import type { NotConfigured } from "@ultrapaint/contracts/errors";
import type { SyncFacts, SyncPlan } from "@ultrapaint/contracts/sync";
import {
  Clock,
  Context,
  Effect,
  FiberHandle,
  FileSystem,
  Layer,
  Path,
  PubSub,
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
  driftOf,
  planOf,
  summaryOf,
} from "./design-system-sync-rules.ts";
import { FigmaImportService } from "./figma-import.ts";
import { RepoPaths } from "./repo-paths.ts";
import { ProjectStyleSystem } from "./style-system.ts";

const STYLESHEET_RE = /\.css$/;

interface Manifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

export class DesignSystemSyncService extends Context.Service<
  DesignSystemSyncService,
  {
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

      /** Whether the package the pages resolve from renders with React. */
      const hasApp = (anchorDir: string) =>
        fs.readFileString(path.join(anchorDir, "package.json")).pipe(
          Effect.map((text) => {
            const manifest = JSON.parse(text) as Manifest;
            return [
              manifest.dependencies,
              manifest.devDependencies,
              manifest.peerDependencies,
            ].some((deps) => deps?.react !== undefined);
          }),
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
          const state = yield* (yield* DesignSystemService).get;
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
          const baseline = state.designSystem?.sync;
          const figmaSynced =
            latest !== null &&
            baseline !== undefined &&
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
          Stream.runForEach(() => PubSub.publish(pokes, undefined))
        );
        yield* FiberHandle.run(watching, watch);
      });
      yield* events.subscribe("project").pipe(
        Stream.debounce("200 millis"),
        Stream.runForEach(() => rewatch),
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
            // Nothing open, or a reading that failed: the next change tries again.
            Effect.ignore
          )
        ),
        Effect.forkScoped
      );

      return DesignSystemSyncService.of({ plan });
    })
  );
}
