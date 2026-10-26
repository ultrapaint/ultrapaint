/**
 * The project open in the window (PLAN-desktop D3): one at a time. Opening another stops the
 * server of the one open and starts the next one's; the window then shows its editor. A server
 * with an agent at work is stopped only once the user says so (D3, D13); a server the app
 * attached to, rather than started (D5), is left running.
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
import { Agents } from "./agents.ts";
import type { ServerStartError, StoreError, UnknownProject } from "./errors.ts";
import { LoginShell } from "./login-shell.ts";
import { ProjectServer, type RunningServer } from "./project-server.ts";
import {
  type Project,
  ProjectStore,
  type RemoteProjectInput,
} from "./projects.ts";
import { RemoteProjects } from "./remote-project.ts";
import { Shell } from "./shell.ts";

/** What the user is asked before agents at work are stopped. */
export const stopQuestion = (
  action: "switch" | "quit" | "restart",
  working: number,
  name: string
) => {
  const stops = {
    quit: "Quitting stops this project's server",
    restart:
      "Applying the change starts this project's server again, which stops it",
    switch: "Opening another project stops this one's server",
  }[action];
  return {
    action: {
      quit: "Stop and quit",
      restart: "Stop and apply",
      switch: "Stop and switch",
    }[action],
    detail: `${stops}, and the agent's work with it. What it wrote so far stays.`,
    message:
      working === 1
        ? `An agent is working in ${name}`
        : `${working} agents are working in ${name}`,
  };
};

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
    /**
     * Adds a folder on another machine (or finds it in the list) and opens it. Whether it is
     * open, as for `openFolder`.
     */
    readonly addRemote: (
      input: RemoteProjectInput
    ) => Effect.Effect<
      { readonly opened: boolean; readonly project: Project },
      StoreError | ServerStartError
    >;
    /** The project open now. */
    readonly current: Effect.Effect<Option.Option<Project>>;
    /**
     * The open project's preview URL as the window reaches it (`RunningServer.mapPreviewUrl`):
     * as it is for a project on this machine, or when none is open.
     */
    readonly mapPreviewUrl: (url: string) => Effect.Effect<{
      readonly forwarded: boolean;
      readonly url: string;
    }>;
    /**
     * Adds a folder (named on the command line, or a new design) when it is not in the list yet,
     * under `name` or the folder's own, and opens it. Whether it is open: the user may rather
     * let an agent at work in the open project finish, and the folder then waits in the list.
     */
    readonly openFolder: (
      folder: string,
      name?: string,
      /** For the editor, on its address: `new-design` for a design just written. */
      query?: Readonly<Record<string, string>>
    ) => Effect.Effect<
      { readonly opened: boolean; readonly project: Project },
      StoreError | ServerStartError
    >;
    /**
     * Opens a project in place of the one open; nothing changes when the user would rather let
     * an agent at work in the open one finish.
     */
    readonly open: (
      id: string
    ) => Effect.Effect<void, StoreError | UnknownProject | ServerStartError>;
    /**
     * Starts the open project's server again, so that it takes up a change to the agents; the
     * editor comes back where it was. Asks first when agents are at work; nothing changes when
     * the user says no, nor for a server the app only attached to.
     */
    readonly restart: Effect.Effect<void, StoreError | ServerStartError>;
    /** At start: the project opened last, or the page that asks for one. */
    readonly start: Effect.Effect<void, StoreError>;
    /**
     * Stops the open project's server, as the app quits. With `ask`, an agent at work is the
     * user's to stop: false when they would rather it went on, and nothing is stopped.
     */
    readonly stop: (options: {
      readonly ask: boolean;
    }) => Effect.Effect<boolean>;
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
        // The terminal's PATH, so that the preview finds the user's Node and agents their tools.
        const { env } = yield* LoginShell;
        const agents = yield* Agents;
        const remote = yield* RemoteProjects;
        // One switch at a time: a second click waits for the first to finish.
        const switching = yield* Semaphore.make(1);
        let open: Open | null = null;

        /**
         * Lets go of the open project: its server stops, unless the app only attached to it.
         * Asked first when agents are at work in it; false when the user says no.
         */
        const release = Effect.fnUntraced(function* (
          action: "switch" | "quit" | "restart",
          ask: boolean
        ) {
          const was = open;
          if (!was) {
            return true;
          }
          const working =
            ask && !was.server.attached ? yield* was.server.working : 0;
          if (working > 0) {
            const agree = yield* shell.confirm(
              stopQuestion(action, working, was.project.name)
            );
            if (!agree) {
              return false;
            }
          }
          open = null;
          yield* Scope.close(was.scope, Exit.void);
          return true;
        });

        const launch = Effect.fn("OpenProject.launch")(function* (
          project: Project,
          view: {
            readonly keepLocation?: boolean;
            readonly query?: Readonly<Record<string, string>> | undefined;
          } = {}
        ) {
          const scope = yield* Scope.make();
          const server = yield* (
            project.kind === "ssh"
              ? // There, the server runs the remote machine's own agents: the app's are not.
                remote.start(project)
              : Effect.gen(function* () {
                  // Asked at each start: an agent installed or set up since is in the next one.
                  const runtime = yield* agents.runtime;
                  return yield* servers.start({
                    cwd: project.path,
                    env: {
                      ...env,
                      ULTRAPAINT_AGENT_RUNTIME: JSON.stringify(runtime),
                    },
                    sessionDir: path.join(dataDir, "sessions", project.id),
                  });
                })
          ).pipe(
            Scope.provide(scope),
            Effect.onError(() => Scope.close(scope, Exit.void))
          );
          open = { project, scope, server };
          yield* store.opened(project.id);
          const url = new URL(server.url);
          for (const [key, value] of Object.entries(view.query ?? {})) {
            url.searchParams.set(key, value);
          }
          yield* shell.show({
            _tag: "Editor",
            ...(view.keepLocation ? { keepLocation: true } : {}),
            url: view.query ? url.href : server.url,
          });
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

        /** Opens a project in place of the open one; false when the user kept that one. */
        const openProject = (
          project: Project,
          query?: Readonly<Record<string, string>>
        ) =>
          switching.withPermits(1)(
            Effect.flatMap(release("switch", true), (released) =>
              released
                ? Effect.as(showFailure(launch(project, { query })), true)
                : Effect.succeed(false)
            )
          );

        const openFolder = Effect.fn("OpenProject.openFolder")(function* (
          folder: string,
          name?: string,
          query?: Readonly<Record<string, string>>
        ) {
          const project = yield* store.add(folder, name);
          const opened =
            open?.project.id === project.id ||
            (yield* openProject(project, query));
          return { opened, project };
        });

        const addRemote = Effect.fn("OpenProject.addRemote")(function* (
          input: RemoteProjectInput
        ) {
          const project = yield* store.addRemote(input);
          const opened =
            open?.project.id === project.id || (yield* openProject(project));
          return { opened, project };
        });

        return OpenProject.of({
          add: Effect.gen(function* () {
            const folder = yield* shell.pickFolder("Add a project folder");
            return Option.isNone(folder)
              ? Option.none()
              : Option.some((yield* openFolder(folder.value)).project);
          }),
          addRemote,
          current: Effect.sync(() => Option.fromNullishOr(open?.project)),
          mapPreviewUrl: (url) =>
            Effect.suspend(
              () =>
                open?.server.mapPreviewUrl?.(url) ??
                Effect.succeed({ forwarded: true, url })
            ),
          open: (id) =>
            Effect.flatMap(store.get(id), (project) =>
              open?.project.id === id
                ? Effect.void
                : Effect.asVoid(openProject(project))
            ),
          openFolder,
          restart: switching.withPermits(1)(
            Effect.gen(function* () {
              const was = open;
              if (!was || was.server.attached) {
                return;
              }
              if (yield* release("restart", true)) {
                yield* showFailure(launch(was.project, { keepLocation: true }));
              }
            })
          ),
          start: Effect.gen(function* () {
            const last = yield* store.last;
            if (Option.isNone(last)) {
              return yield* shell.show({ _tag: "Welcome" });
            }
            // A project that cannot start leaves the window on the welcome page, saying why.
            yield* Effect.ignore(openProject(last.value));
          }),
          stop: ({ ask }) => switching.withPermits(1)(release("quit", ask)),
        });
      })
    );
}
