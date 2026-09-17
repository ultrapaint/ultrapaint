import { NotConfigured } from "@ultrapaint/contracts/errors";
import type { ProjectInfo } from "@ultrapaint/contracts/project";
import type { Settings } from "@ultrapaint/contracts/settings";
import {
  Context,
  Effect,
  Exit,
  Fiber,
  type FileSystem,
  Layer,
  Path,
  Scope,
  Semaphore,
  Stream,
} from "effect";
import type { ChildProcessSpawner } from "effect/unstable/process";
import { AppLog } from "./app-log.ts";
import { EventBus } from "./events.ts";
import { CatalogueService } from "./services/catalogue.ts";
import { EditService } from "./services/edit.ts";
import { ProjectFramework } from "./services/framework.ts";
import { GitService } from "./services/git.ts";
import { HostManager } from "./services/host.ts";
import { RepoPaths } from "./services/repo-paths.ts";
import { ScreensService } from "./services/screens.ts";
import { Storage } from "./services/storage.ts";

/** Everything that exists once a target repository is configured. */
export type ProjectServices =
  | CatalogueService
  | EditService
  | GitService
  | HostManager
  | ProjectFramework
  | RepoPaths
  | ScreensService;

type ProjectRequirements =
  | AppLog
  | ChildProcessSpawner.ChildProcessSpawner
  | EventBus
  | FileSystem.FileSystem
  | Path.Path
  | Storage;

const projectLayer = (settings: Settings) =>
  Layer.mergeAll(
    CatalogueService.layer,
    EditService.layer,
    GitService.layer,
    HostManager.layer,
    ScreensService.layer
  ).pipe(
    Layer.provideMerge(ProjectFramework.layer),
    Layer.provideMerge(RepoPaths.layer(settings))
  );

interface OpenProject {
  readonly scope: Scope.Closeable;
  readonly services: Context.Context<ProjectServices>;
}

const notConfigured = () =>
  new NotConfigured({ message: "no target repository configured" });

/**
 * Owns the one open project. The project is a layer built into its own scope: the preview
 * host, the file watcher and every agent session live there, so changing the settings or
 * shutting down closes all of them together.
 */
export class ProjectManager extends Context.Service<
  ProjectManager,
  {
    readonly close: Effect.Effect<void>;
    readonly info: Effect.Effect<ProjectInfo>;
    /** Closes the open project, if any, and opens the one the settings describe. */
    readonly open: (settings: Settings) => Effect.Effect<void>;
    /** Tells the editor the project changed; saving a configuration changes the storage. */
    readonly publishInfo: Effect.Effect<void>;
    /** Scope of the open project, for work that must end when the project does. */
    readonly scope: Effect.Effect<Scope.Scope, NotConfigured>;
    /** Runs an effect against the open project. */
    readonly use: <A, E>(
      effect: Effect.Effect<A, E, ProjectServices>
    ) => Effect.Effect<A, E | NotConfigured>;
  }
>()("ultrapaint/server/ProjectManager") {
  static readonly layer = Layer.effect(
    ProjectManager,
    Effect.gen(function* () {
      const requirements = yield* Effect.context<ProjectRequirements>();
      const path = yield* Path.Path;
      const events = yield* EventBus;
      const log = yield* AppLog;
      const storage = yield* Storage;
      const managerScope = yield* Effect.scope;
      // open and close never interleave.
      const lifecycle = yield* Semaphore.make(1);
      let current: OpenProject | null = null;

      const use = <A, E>(
        effect: Effect.Effect<A, E, ProjectServices>
      ): Effect.Effect<A, E | NotConfigured> =>
        Effect.suspend(
          (): Effect.Effect<A, E | NotConfigured> =>
            current
              ? Effect.provideContext(effect, current.services)
              : Effect.fail(notConfigured())
        );

      const openInfo = use(
        Effect.gen(function* () {
          const paths = yield* RepoPaths;
          const git = yield* GitService;
          const host = yield* HostManager;
          return {
            // A detached HEAD or a broken git must not hide the rest of the project.
            branch: yield* Effect.orElseSucceed(git.branch, () => ""),
            configured: true,
            designsDir: paths.settings.designsDir,
            host: yield* host.status,
            name: path.basename(paths.root),
            repoPath: paths.root,
          };
        })
      ).pipe(
        Effect.orElseSucceed(() => ({
          configured: false,
          host: { state: "stopped" as const },
        }))
      );
      const info: Effect.Effect<ProjectInfo> = Effect.zipWith(
        openInfo,
        storage.info,
        (project, storageInfo): ProjectInfo => ({
          ...project,
          storage: storageInfo,
        })
      );

      const publishInfo = Effect.flatMap(info, (value) =>
        events.publish("project", value)
      );

      const closeCurrent = Effect.suspend(() => {
        const open = current;
        current = null;
        return open ? Scope.close(open.scope, Exit.void) : Effect.void;
      });

      const open = (settings: Settings) =>
        lifecycle
          .withPermits(1)(
            Effect.gen(function* () {
              yield* closeCurrent;
              const scope = yield* Scope.fork(managerScope);
              const services = yield* Layer.buildWithScope(
                projectLayer(settings),
                scope
              ).pipe(
                Effect.provideContext(requirements),
                Effect.onError(() => Scope.close(scope, Exit.void))
              );
              current = { scope, services };
              const host = Context.get(services, HostManager);
              // Every host status change is a project change for the editor.
              yield* host.changes.pipe(
                Stream.runForEach(() => publishInfo),
                Effect.forkIn(scope)
              );
              yield* Effect.forkIn(host.start, scope);
            })
          )
          .pipe(
            // A repository that moved or vanished leaves the server running and unconfigured,
            // and the editor is told so.
            Effect.catchCause((cause) =>
              Effect.andThen(
                log.log(
                  "server",
                  "error",
                  `could not open ${settings.repoPath}: ${String(cause)}`
                ),
                publishInfo
              )
            ),
            // The old project is already closed by the time the new one is built; a caller that
            // goes away in between must not leave the server with neither.
            (effect) =>
              Effect.flatMap(Effect.forkIn(effect, managerScope), Fiber.join),
            Effect.withSpan("ProjectManager.open")
          );

      return ProjectManager.of({
        close: lifecycle.withPermits(1)(closeCurrent),
        info,
        open,
        publishInfo,
        scope: Effect.suspend(() =>
          current ? Effect.succeed(current.scope) : Effect.fail(notConfigured())
        ),
        use,
      });
    })
  );
}
