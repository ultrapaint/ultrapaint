/**
 * The project open in the window (PLAN-desktop D3): one at a time. Opening another stops the
 * server of the one open and starts the next one's; the window then shows its editor.
 */
import {
  Context,
  Effect,
  Exit,
  Layer,
  Option,
  Path,
  Scope,
  Semaphore,
} from "effect";
import type { ServerStartError, StoreError, UnknownProject } from "./errors.ts";
import { ProjectServer, type RunningServer } from "./project-server.ts";
import { type Project, ProjectStore } from "./projects.ts";
import { Shell } from "./shell.ts";

interface Open {
  readonly project: Project;
  /** The server lives in it: closing it stops the server. */
  readonly scope: Scope.Closeable;
  readonly server: RunningServer;
}

export class OpenProject extends Context.Service<
  OpenProject,
  {
    /** Picks a folder, adds it to the list and opens it. Nothing when the picker is cancelled. */
    readonly add: Effect.Effect<
      Option.Option<Project>,
      StoreError | ServerStartError
    >;
    /** The project open now. */
    readonly current: Effect.Effect<Option.Option<Project>>;
    /** Adds a folder named on the command line, when it is not in the list yet, and opens it. */
    readonly openFolder: (
      folder: string
    ) => Effect.Effect<Project, StoreError | ServerStartError>;
    /** Opens a project in place of the one open. */
    readonly open: (
      id: string
    ) => Effect.Effect<void, StoreError | UnknownProject | ServerStartError>;
    /** At start: the project opened last, or the page that asks for one. */
    readonly start: Effect.Effect<void, StoreError>;
    /** Stops the open project's server, as the app quits. */
    readonly stop: Effect.Effect<void>;
  }
>()("ultrapaint/desktop/OpenProject") {
  /** `dataDir` is the app's data directory, where unsaved sessions are kept. */
  static readonly layer = (dataDir: string) =>
    Layer.effect(
      OpenProject,
      Effect.gen(function* () {
        const store = yield* ProjectStore;
        const servers = yield* ProjectServer;
        const shell = yield* Shell;
        const path = yield* Path.Path;
        const env: Readonly<Record<string, string>> = {};
        // One switch at a time: a second click waits for the first to finish.
        const switching = yield* Semaphore.make(1);
        let open: Open | null = null;

        const close = Effect.suspend(() => {
          const was = open;
          open = null;
          return was ? Scope.close(was.scope, Exit.void) : Effect.void;
        });

        const launch = Effect.fn("OpenProject.launch")(function* (
          project: Project
        ) {
          const scope = yield* Scope.make();
          const server = yield* servers
            .start({
              cwd: project.path,
              env,
              sessionDir: path.join(dataDir, "sessions", project.id),
            })
            .pipe(
              Scope.provide(scope),
              Effect.onError(() => Scope.close(scope, Exit.void))
            );
          open = { project, scope, server };
          yield* store.opened(project.id);
          yield* shell.show({ _tag: "Editor", url: server.url });
        });

        /** Shows why a project could not be opened, and fails with it. */
        const showFailure = <A, E extends { readonly message: string }, R>(
          effect: Effect.Effect<A, E, R>
        ) =>
          effect.pipe(
            Effect.tapError((error) =>
              shell.show({ _tag: "Welcome", problem: error.message })
            )
          );

        const openProject = (project: Project) =>
          switching.withPermits(1)(
            Effect.andThen(close, showFailure(launch(project)))
          );

        const openFolder = Effect.fn("OpenProject.openFolder")(function* (
          folder: string
        ) {
          const project = yield* store.add(folder);
          if (open?.project.id !== project.id) {
            yield* openProject(project);
          }
          return project;
        });

        return OpenProject.of({
          add: Effect.gen(function* () {
            const folder = yield* shell.pickFolder("Add a project folder");
            return Option.isNone(folder)
              ? Option.none()
              : Option.some(yield* openFolder(folder.value));
          }),
          current: Effect.sync(() => Option.fromNullishOr(open?.project)),
          open: (id) =>
            Effect.flatMap(store.get(id), (project) =>
              open?.project.id === id ? Effect.void : openProject(project)
            ),
          openFolder,
          start: Effect.gen(function* () {
            const last = yield* store.last;
            if (Option.isNone(last)) {
              return yield* shell.show({ _tag: "Welcome" });
            }
            // A project that cannot start leaves the window on the welcome page, saying why.
            yield* Effect.ignore(openProject(last.value));
          }),
          stop: switching.withPermits(1)(close),
        });
      })
    );
}
