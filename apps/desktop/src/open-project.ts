/**
 * The project open in the window (PLAN-desktop D3): one at a time, but for a switch. Opening
 * another starts the next one's server beside the open one's, which stops once the next is ready
 * (ADR 0099); the window then shows its editor. A server with an agent at work is stopped only
 * once the user says so (D3, D13), asked before the next one starts; a server the app attached
 * to, rather than started (D5), is left running. A signal (SIGINT, SIGTERM) asks nobody: it
 * answers a question on screen no and stops the server at once.
 *
 * While a project opens the window says so on a splash, from the first moment until its editor
 * is ready (ADR 0099): each step with its time, the estimate from the project's last open, the
 * last line the start printed. Cancel goes back to the project open before, or the start screen;
 * a step that fails stays on the splash with why, and Try again opens it again.
 */
import {
  estimateFrom,
  failOpening,
  isEditorStep,
  noteLine,
  type Opening,
  type OpeningTimes,
  openingSteps,
  reachStep,
  stepTimes,
} from "@ultrapaint/contracts/opening";
import { CONFIG_FILE_NAMES } from "@ultrapaint/contracts/settings";
import type { FirstPrompt } from "@ultrapaint/contracts/shell-bridge";
import {
  Clock,
  Context,
  Deferred,
  Effect,
  Exit,
  FileSystem,
  Layer,
  Option,
  Path,
  Scope,
  Semaphore,
} from "effect";
import { Agents } from "./agents.ts";
import {
  ProjectOpen,
  ServerNotOurs,
  type ServerStartError,
  StoreError,
  type UnknownProject,
} from "./errors.ts";
import { Folders } from "./folders.ts";
import { LoginShell } from "./login-shell.ts";
import { OpeningReport } from "./opening-report.ts";
import { ProjectServer, type RunningServer } from "./project-server.ts";
import {
  type Project,
  ProjectStore,
  projectDetail,
  type RemoteProjectInput,
} from "./projects.ts";
import { RemoteProjects } from "./remote-project.ts";
import { Shell, type View } from "./shell.ts";

/** What stops the open project's server. */
type StopAction = "switch" | "quit" | "restart" | "move";

/** What the user is asked before agents at work are stopped. */
const stopQuestion = (
  action: StopAction,
  working: number,
  name: string,
  /**
   * For a switch, the project opened: asked once its editor is ready, declining goes back to
   * this one (ADR 0099); asked before it opens, declining stays.
   */
  next?: { readonly name: string; readonly ready: boolean }
) => {
  const stops = {
    move: "Moving your folder stops this project's server while it copies",
    quit: "Quitting stops this project's server",
    restart:
      "Applying the change starts this project's server again, which stops it",
    switch: `Opening ${next?.name ?? "another project"} stops this one's server`,
  }[action];
  return {
    ...(action === "switch"
      ? { cancel: next?.ready ? `Back to ${name}` : `Stay in ${name}` }
      : {}),
    action: {
      move: "Stop and move",
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

/** Why a project still opening is stopped. */
type StopReason = "list" | "switch" | "quit";

/** How a project's editor is shown. */
interface EditorView {
  /** The page the window is on stays, on the server's new address. */
  readonly keepLocation?: boolean;
}

interface Open {
  readonly project: Project;
  /** The server lives in it: closing it stops the server. */
  readonly scope: Scope.Closeable;
  readonly server: RunningServer;
}

/** How a launch that can be stopped ended: what it gave, or why it was stopped. */
type Launched<A> =
  | { readonly _tag: "done"; readonly value: A }
  | { readonly _tag: "stopped"; readonly reason: StopReason };

/** A project opening on the splash, and the state the window is told. */
interface ShownOpening {
  readonly project: Project;
  state: Opening;
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
     * open, as for `openFolder`; the one open shows its editor again, as there.
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
     * Adds a folder (named on the command line, or a new design) when it is not in the list yet,
     * under `name` or the folder's own, and opens it. Whether it is open: the user may rather
     * let an agent at work in the open project finish, and the folder then waits in the list.
     * The open project's own folder shows its editor again, from the start screen, with `start`.
     */
    readonly openFolder: (
      folder: string,
      name?: string,
      /** The start screen's prompt, kept for the editor to take (`takeFirstPrompt`). */
      start?: FirstPrompt
    ) => Effect.Effect<
      { readonly opened: boolean; readonly project: Project },
      StoreError | ServerStartError
    >;
    /**
     * Opens a project in place of the one open; nothing changes when the user would rather let
     * an agent at work in the open one finish. The open one shows its editor again, from the
     * start screen.
     */
    readonly open: (
      id: string
    ) => Effect.Effect<void, StoreError | UnknownProject | ServerStartError>;
    /**
     * Takes a project off the list, with the unsaved session the app kept for it; its folder,
     * here or on another machine, is left as it is. Nothing when it is not in the list. The
     * project open, opening or starting again stays: `ProjectOpen`.
     */
    readonly remove: (
      id: string
    ) => Effect.Effect<void, StoreError | ProjectOpen>;
    /**
     * Whether `remove` would delete work kept nowhere else: the app keeps a session for the
     * project that holds something, and its folder has no configuration, beside which a saved
     * project keeps everything. Never for a project on another machine, whose session is there
     * and stays.
     */
    readonly unsaved: (project: Project) => Effect.Effect<boolean>;
    /**
     * Starts the open project's server again, so that it takes up a change to the agents; the
     * editor comes back where it was. Asks first when agents are at work; nothing changes when
     * the user says no, nor for a server the app only attached to.
     */
    readonly restart: Effect.Effect<void, StoreError | ServerStartError>;
    /**
     * Runs `change` with the open project's server stopped, then starts it again, the editor
     * coming back where it was: for a change the server must not be running through, as the
     * person's folder moving (ADR 0091). Asks first when agents are at work; none, and `change`
     * does not run, when the user says no. With no server open, or one on another machine,
     * `change` just runs; a server only attached to (started outside the app, which cannot stop
     * it) refuses it with `ServerNotOurs`. The server starts again whether `change` failed or
     * not, which then fails with its error.
     */
    readonly whileStopped: <A, E>(
      change: Effect.Effect<A, E>
    ) => Effect.Effect<
      Option.Option<A>,
      E | ServerNotOurs | StoreError | ServerStartError
    >;
    /**
     * The start screen's prompt for the open project, once: the editor takes it as it loads.
     * None when the project was opened without one, or it was taken.
     */
    readonly takeFirstPrompt: Effect.Effect<FirstPrompt | null>;
    /** At start: the project opened last, or the page that asks for one. */
    readonly start: Effect.Effect<void, StoreError>;
    /**
     * Shows the start screen (ADR 0062) in place of the open project's editor, which stays open
     * behind it until another project opens, the start screen offering the way back.
     */
    readonly showStart: Effect.Effect<void>;
    /**
     * Stops the project opening, if one is, or gives up the one that failed: the project open
     * before shows again, or the start screen when none was.
     */
    readonly stopOpening: Effect.Effect<void>;
    /** Opens again the project whose open failed; nothing when none did. */
    readonly retryOpening: Effect.Effect<void>;
    /**
     * The editor's own steps are done, with their times: kept with the shell's for the next
     * open's estimate, and the splash is over. Nothing when the project opening is not the open
     * one's (another was picked meanwhile).
     */
    readonly openingDone: (times: OpeningTimes) => Effect.Effect<void>;
    /**
     * Stops the open project's server, as the app quits; a project still opening or starting
     * again is given up first, and none begins to open meanwhile, so that the quit waits for no
     * launch. With `ask`, an agent at work is the user's to stop: false when they would rather
     * it went on, and nothing is stopped; a second stop while the question is on screen asks
     * nothing more and has its answer. Without, a signal's: a question on screen (a quit's, a
     * switch's or a restart's) is answered no, and any asked after it, and the server stops at
     * once.
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
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        // Where each project's unsaved session is kept, by its id: the app's to remove, with
        // the project.
        const sessions = path.join(dataDir, "sessions");
        // The terminal's PATH, so that a new application's install finds the user's Node and
        // agents their tools.
        const { env } = yield* LoginShell;
        const agents = yield* Agents;
        const remote = yield* RemoteProjects;
        const folders = yield* Folders;
        // One switch at a time: a second click waits for the first to finish.
        const switching = yield* Semaphore.make(1);
        let open: Open | null = null;
        /**
         * The launch under way and how to stop it. `shown` is a project the window says is
         * opening, stopped for the list, when the user asks, for another project picked
         * meanwhile, or as the app quits; not one starting again, which only a quit stops.
         */
        let launching: {
          readonly id: string;
          readonly shown: boolean;
          readonly stop: Deferred.Deferred<StopReason>;
        } | null = null;
        // The quits waiting for the switch: a launch that would begin meanwhile does not.
        let quits = 0;
        // Done once a signal stops the app: no question is answered yes after it.
        const signalled = yield* Deferred.make<void>();
        // The quit being asked, whose answer a second close or Cmd-Q meanwhile waits for.
        let quitAsked: Deferred.Deferred<boolean> | null = null;

        /** Asks the user, unless a signal came first or comes while the question is on screen. */
        const confirm = (question: ReturnType<typeof stopQuestion>) =>
          Effect.flatMap(Deferred.isDone(signalled), (cut) =>
            cut
              ? Effect.succeed(false)
              : Effect.raceFirst(
                  shell.confirm(question),
                  // Interrupted, the shell takes the question off the screen.
                  Effect.as(Deferred.await(signalled), false)
                )
          );

        /**
         * Whether the user lets the open project's agents at work be stopped: asked when there
         * are any, in a server the app started. True when there is nothing to ask.
         */
        const agreeToStop = Effect.fnUntraced(function* (
          action: StopAction,
          was: Open
        ) {
          const working = was.server.attached ? 0 : yield* was.server.working;
          return (
            working === 0 ||
            (yield* confirm(stopQuestion(action, working, was.project.name)))
          );
        });

        /**
         * The open project whose agents the user agreed to stop for a switch still under way:
         * a quit meanwhile does not ask again.
         */
        let agreed: Open | null = null;

        /**
         * The project a switch left open behind the next one's editor until that one is ready
         * (its editor's steps done), or the switch is cancelled: Cancel shows it again at once,
         * and its server's stop never adds to the wait (ADR 0099).
         */
        let previous: Open | null = null;

        /** Lets go of a project that was open: its server stops, unless the app only attached. */
        const letGo = Effect.fnUntraced(function* (was: Open) {
          if (open === was) {
            open = null;
          }
          yield* Scope.close(was.scope, Exit.void);
          // Whatever it was saying (reconnecting) is no longer so.
          yield* shell.status(null);
        });

        /** Whether the person agreed to stop the agents of the project a switch left open. */
        let previousAgreed = false;

        /** Lets go of the project a switch left open, once the next one is ready. */
        const letGoOfPrevious = Effect.suspend(() => {
          const was = previous;
          previous = null;
          previousAgreed = false;
          return was ? letGo(was) : Effect.void;
        });

        /**
         * Lets go of the open project: its server stops, unless the app only attached to it.
         * Asked first when agents are at work in it; false when the user says no.
         */
        const release = Effect.fnUntraced(function* (
          action: StopAction,
          ask: boolean
        ) {
          const was = open;
          if (!was) {
            return true;
          }
          if (ask && agreed !== was && !(yield* agreeToStop(action, was))) {
            return false;
          }
          // The one a switch left open is asked about too, unless the person agreed as the
          // switch began: declined, both stay.
          const kept = previous;
          if (
            ask &&
            kept &&
            !previousAgreed &&
            !(yield* agreeToStop(action, kept))
          ) {
            return false;
          }
          yield* letGoOfPrevious;
          yield* letGo(was);
          return true;
        });

        /** Whether the start screen is shown over the open project's editor (`showStart`). */
        let behindStart = false;
        /** Whether the window shows an editor: a splash is drawn over it, on no page of its own. */
        let onEditor = false;

        /**
         * The start screen's prompt and the project it is for, until that project's editor takes
         * it. Kept here rather than on the editor's address, which could not hold its pictures.
         */
        let firstPrompt: {
          readonly projectId: string;
          readonly start: FirstPrompt;
        } | null = null;

        /** Shows a page in the window. */
        const showPage = (view: View) =>
          Effect.andThen(
            Effect.sync(() => {
              onEditor = view._tag === "Editor";
              if (onEditor) {
                behindStart = false;
              }
            }),
            shell.show(view)
          );

        /** Shows a server's editor. */
        const showEditor = (server: RunningServer, view: EditorView = {}) =>
          showPage({
            _tag: "Editor",
            ...(view.keepLocation ? { keepLocation: true } : {}),
            url: server.url,
          });

        /** Starts a project's server, in a scope of its own; nothing is shown. */
        const startServer = Effect.fn("OpenProject.startServer")(function* (
          project: Project
        ) {
          const scope = yield* Scope.make();
          const server = yield* (
            project.kind === "ssh"
              ? // There, the server runs the remote machine's own agents: the app's are not.
                remote.start(project, {
                  // The editor at another port, or another server's: loaded there again.
                  // Only while it is the one on screen: during a switch the window is the next's.
                  moved: (movedTo) =>
                    Effect.suspend(() =>
                      open?.project.id === project.id && onEditor
                        ? showPage({
                            _tag: "Editor",
                            keepLocation: true,
                            url: movedTo,
                          })
                        : Effect.void
                    ),
                  status: shell.status,
                })
              : Effect.gen(function* () {
                  // Asked at each start: an agent installed or set up since is in the next one.
                  const runtime = yield* agents.runtime;
                  // And where the person's folder is: moved since, it is there.
                  const { userDirIn } = yield* folders.current;
                  return yield* servers.start({
                    cwd: project.path,
                    env: {
                      ...env,
                      ULTRAPAINT_AGENT_RUNTIME: JSON.stringify(runtime),
                    },
                    sessionDir: path.join(sessions, project.id),
                    userDirIn,
                  });
                })
          ).pipe(
            Scope.provide(scope),
            Effect.onError(() => Scope.close(scope, Exit.void))
          );
          return { project, scope, server } satisfies Open;
        });

        /** Starts a project's server and shows its editor: for a start again, with no splash. */
        const launch = Effect.fn("OpenProject.launch")(function* (
          project: Project,
          view: EditorView = {}
        ) {
          const next = yield* startServer(project);
          open = next;
          yield* store.opened(project.id);
          yield* showEditor(next.server, view);
        });

        /** Shows why a project could not be started again, and fails with it. */
        const showFailure = <A, E extends { readonly message: string }, R>(
          effect: Effect.Effect<A, E, R>
        ) =>
          effect.pipe(
            Effect.tapError((error) =>
              showPage({ _tag: "Welcome", problem: error.message })
            )
          );

        /**
         * Runs a launch that can be stopped: what it gave, or why it was stopped. Stopped, the
         * launch is interrupted: its scope closes, and the connection with it. With a quit
         * waiting for the switch it does not begin: the quit would wait for the launch too.
         */
        const stoppable = Effect.fnUntraced(function* <A, E>(
          { id, shown }: { readonly id: string; readonly shown: boolean },
          launched: Effect.Effect<A, E>
        ) {
          if (quits > 0) {
            return { _tag: "stopped", reason: "quit" } as Launched<A>;
          }
          const stop = yield* Deferred.make<StopReason>();
          launching = { id, shown, stop };
          return yield* Effect.raceFirst(
            Effect.map(
              launched,
              (value): Launched<A> => ({ _tag: "done", value })
            ),
            Effect.map(
              Deferred.await(stop),
              (reason): Launched<A> => ({ _tag: "stopped", reason })
            )
          ).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                if (launching?.stop === stop) {
                  launching = null;
                }
              })
            )
          );
        });

        /**
         * Stops the project opening, for `reason`, and for a quit a project starting again
         * too; nothing when none is.
         */
        const stopLaunch = (reason: StopReason) =>
          Effect.suspend(() =>
            launching && (reason === "quit" || launching.shown)
              ? Effect.asVoid(Deferred.succeed(launching.stop, reason))
              : Effect.void
          );

        /** The project opening on the splash, kept after a failure for Try again. */
        let opening: ShownOpening | null = null;

        /** Tells the window the opening as it stands. */
        const tellOpening = Effect.suspend(() =>
          shell.opening(opening?.state ?? null)
        );

        /** Changes `underway`'s state and tells the window; nothing once another took its place. */
        const changeOpening = (
          underway: ShownOpening,
          change: (state: Opening, now: number) => Opening
        ) =>
          Effect.flatMap(Clock.currentTimeMillis, (now) =>
            Effect.suspend(() => {
              if (opening !== underway) {
                return Effect.void;
              }
              underway.state = change(underway.state, now);
              return tellOpening;
            })
          );

        /** What a start tells `underway`: its lines, and the steps it reaches. */
        const reportTo = (underway: ShownOpening): OpeningReport => ({
          line: (text) => changeOpening(underway, (o) => noteLine(o, text)),
          // A step reached again (a reconnection while the editor does its steps) changes nothing.
          reached: (step) =>
            changeOpening(underway, (o, now) =>
              o.steps.some((s) => s.id === step && s.state !== "next")
                ? o
                : reachStep(o, step, now)
            ),
        });

        /**
         * The splash for `project`, Cancel going back to `back`: on the editor on screen, or on
         * the app's own page when there is none.
         */
        const beginOpening = Effect.fnUntraced(function* (
          project: Project,
          back: Project | undefined
        ) {
          const now = yield* Clock.currentTimeMillis;
          const steps = openingSteps(
            project.kind,
            project.kind === "ssh" ? project.host : undefined
          );
          const estimate = estimateFrom(steps, project.lastOpening);
          const first = steps[0]?.id ?? null;
          const underway: ShownOpening = {
            project,
            state: reachStep(
              {
                ...(back ? { back: back.name } : {}),
                ...(estimate === undefined ? {} : { estimate }),
                log: [],
                name: project.name,
                remote: project.kind === "ssh",
                since: now,
                steps,
                where: projectDetail(project),
              },
              first,
              now
            ),
          };
          opening = underway;
          yield* tellOpening;
          if (!onEditor) {
            yield* showPage({ _tag: "Opening" });
          }
          return underway;
        });

        /**
         * The splash is over: given up (Cancel, a failure given up), it goes, and the window
         * shows what is left: the editor on screen as it is, or the start screen.
         */
        const endOpening = Effect.suspend(() => {
          if (!opening) {
            return Effect.void;
          }
          opening = null;
          return Effect.andThen(
            tellOpening,
            onEditor
              ? Effect.void
              : showPage({
                  _tag: "Welcome",
                  ...(open ? { back: open.project.name } : {}),
                })
          );
        });

        /**
         * The next project's editor is ready: the one a switch left open goes. An agent that
         * started there since the person was asked (or with nothing to ask then) is asked about
         * now: Stop and switch lets it go, Back to it shows it again and the next one goes.
         */
        const settlePrevious = Effect.fnUntraced(function* (nextName: string) {
          const was = previous;
          if (!was) {
            return;
          }
          const working =
            previousAgreed || was.server.attached
              ? 0
              : yield* was.server.working;
          if (
            working > 0 &&
            previous === was &&
            !(yield* confirm(
              stopQuestion("switch", working, was.project.name, {
                name: nextName,
                ready: true,
              })
            ))
          ) {
            const next = open;
            previous = null;
            open = was;
            yield* showEditor(was.server);
            if (next) {
              yield* letGo(next);
            }
            return;
          }
          yield* letGoOfPrevious;
        });

        /**
         * As a switch begins, whether the person lets the open project's agents at work be
         * stopped: "agreed" when asked and they did, "stay" when they would rather stay, "none"
         * when nothing was at work to ask about.
         */
        const askToSwitch = Effect.fnUntraced(function* (
          was: Open | null,
          nextName: string
        ) {
          const working =
            was && !was.server.attached ? yield* was.server.working : 0;
          if (!was || working === 0) {
            return "none" as const;
          }
          const agree = yield* confirm(
            stopQuestion("switch", working, was.project.name, {
              name: nextName,
              ready: false,
            })
          );
          return agree ? ("agreed" as const) : ("stay" as const);
        });

        /**
         * Cancel while the next project's editor does its steps: the one a switch left open is
         * the open one again, its editor on screen, or the start screen when none was; the next
         * one's server stops.
         */
        const backToPrevious = Effect.suspend(() => {
          const was = previous;
          const next = open;
          if (!(opening && next?.project.id === opening.project.id)) {
            return Effect.void;
          }
          previous = null;
          open = was;
          opening = null;
          return Effect.andThen(
            Effect.andThen(
              tellOpening,
              was ? showEditor(was.server) : showPage({ _tag: "Welcome" })
            ),
            letGo(next)
          );
        });

        /**
         * The next project's server is ready: its editor is shown, the shell's steps done and
         * timed, the one open kept behind it until the editor is ready. Cancelled meanwhile, the
         * open one stays as it was and the next one goes: false.
         */
        const installNext = Effect.fnUntraced(function* (
          underway: ShownOpening,
          next: Open,
          was: Open | null
        ) {
          // The shell's steps are done; the editor's begin as its page loads.
          yield* changeOpening(underway, (o, now) =>
            reachStep(
              o,
              o.steps.find((s) => isEditorStep(s.id))?.id ?? null,
              now
            )
          );
          // The times are for the next estimate only: a list that cannot be written loses
          // that, never the server just started.
          yield* Effect.ignore(
            store.timed(next.project.id, stepTimes(underway.state))
          );
          agreed = null;
          if (opening !== underway) {
            yield* Scope.close(next.scope, Exit.void);
            return false;
          }
          // The one open stays behind the next one's editor until that one is ready.
          previous = was;
          open = next;
          yield* store.opened(next.project.id);
          yield* showEditor(next.server);
          return true;
        });

        /**
         * Opens a project in place of the open one, on the splash, stopping one still opening.
         * The open one stays open until the next one's server is ready, so that Cancel, or a
         * failure, leaves it as it was. False when the user kept the open one for its agents,
         * or the opening was stopped; fails with why it could not be opened, which the splash
         * says.
         */
        const openProject = (project: Project) =>
          Effect.andThen(
            stopLaunch("switch"),
            switching.withPermits(1)(
              Effect.gen(function* () {
                const was = open;
                const asked = yield* askToSwitch(was, project.name);
                if (asked === "stay") {
                  return false;
                }
                // An agreement only when the person was asked: with nothing at work there was
                // nothing to agree to, and an agent that starts meanwhile is asked about.
                agreed = asked === "agreed" ? was : null;
                // One left open by a switch before goes now: a third project is coming.
                yield* letGoOfPrevious;
                // Asked now, the person is not asked again when it stops; otherwise an agent
                // that started there meanwhile is asked about then (ADR 0099).
                previousAgreed = asked === "agreed";
                const underway = yield* beginOpening(project, was?.project);
                const launched = yield* stoppable(
                  { id: project.id, shown: true },
                  startServer(project).pipe(
                    Effect.provideService(OpeningReport, reportTo(underway))
                  )
                ).pipe(
                  Effect.tapError((error) =>
                    Effect.andThen(
                      Effect.sync(() => {
                        agreed = null;
                      }),
                      changeOpening(underway, (o, now) =>
                        failOpening(o, error.message, now)
                      )
                    )
                  )
                );
                // Stopped, what stopped it saw to the splash: Cancel ended it, another project
                // picked meanwhile has it, and a quit takes the window with it, and what the
                // user agreed to stop.
                if (launched._tag === "stopped") {
                  if (launched.reason !== "quit") {
                    agreed = null;
                  }
                  return false;
                }
                return yield* installNext(underway, launched.value, was);
              })
            )
          );

        const openFolder = Effect.fn("OpenProject.openFolder")(function* (
          folder: string,
          name?: string,
          start?: FirstPrompt
        ) {
          const project = yield* store.add(folder, name);
          firstPrompt = start ? { projectId: project.id, start } : null;
          // The one open shows its editor again, from the start screen, with what it is given.
          // On screen already (a second launch naming its folder), it is left as it is: showing
          // it loads the page again.
          if (open?.project.id === project.id) {
            if (behindStart || start) {
              yield* showEditor(open.server);
            }
            return { opened: true, project };
          }
          // Not opened (an agent at work kept the open project, the launch was stopped or
          // failed), the prompt goes: the project opened later is opened for something else.
          const opened = yield* openProject(project).pipe(
            Effect.onError(() => forgetFirstPrompt)
          );
          if (!opened) {
            yield* forgetFirstPrompt;
          }
          return { opened, project };
        });

        const forgetFirstPrompt = Effect.sync(() => {
          firstPrompt = null;
        });

        const addRemote = Effect.fn("OpenProject.addRemote")(function* (
          input: RemoteProjectInput
        ) {
          const project = yield* store.addRemote(input);
          if (open?.project.id === project.id) {
            if (behindStart) {
              yield* showEditor(open.server);
            }
            return { opened: true, project };
          }
          return { opened: yield* openProject(project), project };
        });

        /** What a directory holds: nothing when it is not there, or cannot be read. */
        const entries = (dir: string) =>
          fs.readDirectory(dir).pipe(Effect.orElseSucceed((): string[] => []));

        const unsaved = Effect.fn("OpenProject.unsaved")(function* (
          project: Project
        ) {
          if (project.kind !== "local") {
            return false;
          }
          const kept = yield* entries(path.join(sessions, project.id));
          if (kept.length === 0) {
            return false;
          }
          // Saved, a session is copied beside the configuration and its server reads it there:
          // what is left here is no one's.
          const inFolder = yield* entries(project.path);
          return !CONFIG_FILE_NAMES.some((file) => inFolder.includes(file));
        });

        const remove = Effect.fn("OpenProject.remove")(function* (id: string) {
          const found = yield* Effect.catchTag(
            Effect.asSome(store.get(id)),
            "UnknownProject",
            () => Effect.succeedNone
          );
          if (Option.isNone(found)) {
            return;
          }
          if (
            open?.project.id === id ||
            previous?.project.id === id ||
            launching?.id === id
          ) {
            return yield* new ProjectOpen({ name: found.value.name });
          }
          yield* store.remove(id);
          // Its session alone, a directory of its own among the sessions: an id that names
          // another place deletes nothing.
          const session = path.join(sessions, id);
          if (path.dirname(session) === sessions) {
            yield* fs.remove(session, { force: true, recursive: true }).pipe(
              Effect.mapError(
                (error) =>
                  new StoreError({
                    message: `${found.value.name} is off the list, but its unsaved session could not be deleted from ${session}: ${error.message}`,
                  })
              )
            );
          }
        });

        /**
         * Lets go of the open project for a quit, which waits for no launch: the one under way
         * is given up, and none begins while the quit waits for the switch.
         */
        const releaseToQuit = (ask: boolean) =>
          Effect.suspend(() => {
            let waiting = true;
            quits += 1;
            const waited = Effect.sync(() => {
              if (waiting) {
                waiting = false;
                quits -= 1;
              }
            });
            return Effect.andThen(
              stopLaunch("quit"),
              switching.withPermits(1)(
                Effect.andThen(waited, release("quit", ask))
              )
            ).pipe(Effect.ensuring(waited));
          });

        /** A quit the user is asked about; a second one meanwhile has the first's answer. */
        const askToQuit = Effect.suspend(() => {
          if (quitAsked) {
            return Deferred.await(quitAsked);
          }
          const asked = Deferred.makeUnsafe<boolean>();
          quitAsked = asked;
          return Effect.onExit(releaseToQuit(true), (exit) => {
            quitAsked = null;
            return Deferred.done(asked, exit);
          });
        });

        /** A signal's quit: a question on screen is answered no, then the server stops. */
        const stopAtOnce = Effect.andThen(
          Deferred.succeed(signalled, undefined),
          releaseToQuit(false)
        );

        return OpenProject.of({
          add: Effect.gen(function* () {
            const folder = yield* shell.pickFolder({
              title: "Add a project folder",
            });
            return Option.isNone(folder)
              ? Option.none()
              : Option.some((yield* openFolder(folder.value)).project);
          }),
          addRemote,
          current: Effect.sync(() => Option.fromNullishOr(open?.project)),
          open: (id) =>
            Effect.flatMap(store.get(id), (project) => {
              // The one open shows its editor again, the splash of another given up; the one
              // opening goes on as it is.
              if (open?.project.id === id) {
                const shown = open.server;
                return Effect.andThen(
                  Effect.andThen(stopLaunch("list"), endOpening),
                  showEditor(shown)
                );
              }
              // Opened from the list, it is opened for no prompt: one it never took goes.
              return launching?.shown && launching.id === id
                ? Effect.void
                : Effect.andThen(
                    forgetFirstPrompt,
                    Effect.asVoid(openProject(project))
                  );
            }),
          openFolder,
          openingDone: Effect.fn("OpenProject.openingDone")(function* (
            times: OpeningTimes
          ) {
            const underway = opening;
            if (
              !underway ||
              underway.state.problem ||
              open?.project.id !== underway.project.id
            ) {
              return;
            }
            opening = null;
            yield* tellOpening;
            // The times are for the next estimate only: a list that cannot be written loses
            // that, and the open itself is done.
            yield* Effect.ignore(
              store.timed(underway.project.id, {
                ...stepTimes(underway.state),
                ...times,
              })
            );
            // The next one is ready: the one a switch left open goes, or the person goes back;
            // unless another switch began while the times were written, which settles it then.
            if (opening === null && open?.project.id === underway.project.id) {
              yield* settlePrevious(underway.project.name);
            }
          }),
          remove,
          restart: switching.withPermits(1)(
            Effect.gen(function* () {
              const was = open;
              if (!was || was.server.attached) {
                return;
              }
              if (yield* release("restart", true)) {
                // Given up for a quit, there is nothing to show: the app is going.
                yield* showFailure(
                  stoppable(
                    { id: was.project.id, shown: false },
                    launch(was.project, { keepLocation: true })
                  )
                );
              }
            })
          ),
          retryOpening: Effect.suspend(() =>
            opening?.state.problem
              ? // Failed again, the splash says why: the caller has nothing to add.
                Effect.ignore(openProject(opening.project))
              : Effect.void
          ),
          showStart: Effect.suspend(() => {
            behindStart = open !== null;
            return showPage({
              _tag: "Welcome",
              ...(open ? { back: open.project.name } : {}),
            });
          }),
          start: Effect.gen(function* () {
            const last = yield* store.last;
            if (Option.isNone(last)) {
              return yield* showPage({ _tag: "Welcome" });
            }
            // A project that cannot start leaves the splash saying why, with Try again.
            yield* Effect.ignore(openProject(last.value));
          }),
          stop: ({ ask }) => (ask ? askToQuit : stopAtOnce),
          stopOpening: Effect.andThen(
            stopLaunch("list"),
            Effect.andThen(backToPrevious, endOpening)
          ),
          takeFirstPrompt: Effect.sync(() => {
            const kept = firstPrompt;
            if (!kept || open?.project.id !== kept.projectId) {
              return null;
            }
            firstPrompt = null;
            return kept.start;
          }),
          unsaved,
          whileStopped: <A, E>(change: Effect.Effect<A, E>) =>
            switching.withPermits(1)(
              Effect.gen(function* () {
                const was = open;
                if (was?.server.attached && was.project.kind === "local") {
                  return yield* new ServerNotOurs({
                    message: `${was.project.name} runs on a server started outside the app, which uses your folder where it is. Stop it, open the project here, then try again.`,
                  });
                }
                if (was?.project.kind !== "local") {
                  return Option.some(yield* change);
                }
                if (!(yield* release("move", true))) {
                  return Option.none<A>();
                }
                const changed = yield* Effect.exit(change);
                // Given up for a quit, there is nothing to show: the app is going.
                yield* showFailure(
                  stoppable(
                    { id: was.project.id, shown: false },
                    launch(was.project, { keepLocation: true })
                  )
                );
                return Option.some(yield* changed);
              })
            ),
        });
      })
    );
}
