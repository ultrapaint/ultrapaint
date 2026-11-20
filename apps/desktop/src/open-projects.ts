/**
 * The projects open in the window (ADR 0107), one tab each in the order they were opened. Every
 * open project keeps its server, started in a scope of its own the first time its tab is shown
 * and stopped when the tab closes or the app quits; a switch between tabs stops nothing. A server
 * with an agent at work is stopped only once the person says so; a server the app attached to,
 * rather than started (D5), is left running and never asked about. A signal (SIGINT, SIGTERM)
 * asks nobody: it answers a question on screen no and stops the servers at once.
 *
 * Each open project has a project view, its editor; at most `MAX_VIEWS` are kept loaded, and past
 * them the view shown least recently is let go, its server still running, to load again when its
 * tab is next shown. A tab's server changes one change at a time (its lock), and a change to every
 * server waits for those under way and holds the others back (the hold). The tabs, and the one shown, are kept in `projects.json` for the next start, which
 * brings every tab back and starts only the shown one's server.
 *
 * Each running server is asked every two seconds how many agents are at work in it, how many
 * wait on the person and how many stopped on an error, for its tab's spinner and dot. An agent in a
 * project not on screen that comes to ask the person something, finishes or stops on an error is
 * news: told over the view on screen (the editor, or Home's start page) while the window is in
 * front, by the system as the person's Notifications preference says while it is behind. A
 * project on screen at any moment since the last poll tells its own, from its editor
 * (`agent-notifications.ts`), so one event is told once. A project whose view was let go is asked
 * all the same.
 *
 * While a project opens its view says so on a splash, from the first moment until its editor is
 * ready (ADR 0099): each step with its time, the estimate from the project's last open, the last
 * line the start printed. Cancel closes its tab; a step that fails stays on the splash with why,
 * and Try again opens it again.
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
import {
  CONFIG_FILE_NAMES,
  type Notifications,
} from "@ultrapaint/contracts/settings";
import type {
  FirstPrompt,
  ProjectLook,
  ProjectNotice,
  ShellTab,
  TabState,
} from "@ultrapaint/contracts/shell-bridge";
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
  Schedule,
  Scope,
  Semaphore,
} from "effect";
import { Agents } from "./agents.ts";
import type { AppEditor } from "./app-editor.ts";
import { changes } from "./changes.ts";
import {
  ProjectOpen,
  ServerNotOurs,
  type ServerStartError,
  StoreError,
  type UnknownProject,
} from "./errors.ts";
import { Folders } from "./folders.ts";
import { LoginShell } from "./login-shell.ts";
import { notifyPreference } from "./notify-preference.ts";
import { OpeningReport } from "./opening-report.ts";
import {
  type AgentCounts,
  countsOr,
  NO_AGENTS,
  ProjectServer,
  type RunningServer,
  serverVersion,
} from "./project-server.ts";
import {
  type Project,
  ProjectStore,
  projectDetail,
  type RemoteProjectInput,
  withLook,
} from "./projects.ts";
import { RemoteProjects } from "./remote-project.ts";
import { Shell, type View } from "./shell.ts";

/** How many project views are kept loaded; past them the one seen least recently goes. */
export const MAX_VIEWS = 5;

/**
 * The hold's permits: a change to one tab's server takes one, a change to every server (a
 * restart, the person's folder moving) takes them all, so neither runs through the other.
 */
const HOLD = 1_000_000;

/** How often each running server is asked about its agents, for its tab and the notices. */
const POLL_EVERY = "2 seconds";

/** "a", "a and b", "a, b and c". */
const listOf = (names: readonly string[]) =>
  names.length <= 1
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

/** A project with agents at work in it, and how many. */
interface Busy {
  readonly id: string;
  readonly name: string;
  readonly working: number;
}

/** "An agent is working in a", or "Agents are working in a and b". */
const atWork = (busy: readonly Busy[]) =>
  busy.length === 1 && busy[0]?.working === 1
    ? `An agent is working in ${busy[0].name}`
    : `Agents are working in ${listOf(busy.map((b) => b.name))}`;

/** Whether a sentence about `busy`'s agents takes "it" or "them". */
const one = (busy: readonly Busy[]) =>
  busy.length === 1 && busy[0]?.working === 1;

/** What stops several projects' servers at once. */
type StopAll = "quit" | "restart" | "move";

/** What the person is asked before the agents at work in `busy` are stopped. */
const stopQuestion = (action: StopAll, busy: readonly Busy[]) => {
  const it = one(busy) ? "it" : "them";
  const servers = busy.length === 1 ? "its server" : "their servers";
  return {
    action: { move: "Stop and move", quit: "Quit", restart: "Stop and apply" }[
      action
    ],
    detail: {
      move: `${atWork(busy)}. Moving your folder stops ${servers} while it copies, which stops ${it}. What ${one(busy) ? "it" : "they"} wrote so far stays.`,
      quit: `${atWork(busy)}. Quitting stops ${it}.`,
      restart: `${atWork(busy)}. Applying the change starts ${servers} again, which stops ${it}. What ${one(busy) ? "it" : "they"} wrote so far stays.`,
    }[action],
    message: {
      move: "Move your folder?",
      quit: "Quit Ultrapaint?",
      restart: "Apply the change?",
    }[action],
  };
};

/** What the person is asked before a tab with agents at work closes (ADR 0107). */
const closeQuestion = (name: string, working: number) => ({
  action: "Close project",
  detail:
    working === 1
      ? "An agent is working there. Closing the project stops it."
      : `${working} agents are working there. Closing the project stops them.`,
  message: `Close ${name}?`,
});

/** What changed in a project's agents that is news to the person: one asks, or one finished. */
type News = ProjectNotice["news"];

/**
 * The news between what a server said of its agents and what it says now, if any: a new agent
 * waiting on the person, else one fewer at work, which stopped when one more turn failed and
 * finished otherwise.
 */
export const newsOf = (before: AgentCounts, now: AgentCounts): News | null => {
  if (now.waiting > before.waiting) {
    return "asks";
  }
  if (now.working >= before.working) {
    return null;
  }
  return now.failed > before.failed ? "stopped" : "done";
};

/**
 * What a project's news says: the notice over the editor (`<project>: <notice>`), and the
 * system's notification, under the project's name.
 */
const NEWS_WORDS: Record<
  News,
  { readonly body: string; readonly notice: string }
> = {
  asks: {
    body: "An agent asks you something.",
    notice: "an agent asks you something",
  },
  done: { body: "An agent finished.", notice: "an agent finished" },
  stopped: {
    body: "An agent stopped before it finished.",
    notice: "an agent stopped before it finished",
  },
};

/**
 * Why a launch is stopped: its tab closed, the app quits, or another start of the tab is under
 * way already (which the tab's lock rules out; refused rather than run twice).
 */
type StopReason = "close" | "quit" | "taken";

/** How a launch that can be stopped ended: what it gave, or why it was stopped. */
type Launched<A> =
  | { readonly _tag: "done"; readonly value: A }
  | { readonly _tag: "stopped"; readonly reason: StopReason };

/** How a start again ended: as a launch does, or failed, its splash saying why. */
type StartedAgain<A> = Launched<A> | { readonly _tag: "failed" };

/** A project's server running, in its scope: closing it stops the server. */
interface Running {
  readonly scope: Scope.Closeable;
  readonly server: RunningServer;
}

/** A project opening on its splash, and the state its view is told. */
interface ShownOpening {
  state: Opening;
}

/** An open project, as its tab holds it. */
interface Tab {
  /** The agents at work in it and waiting on the person, as its server last said. */
  agents: AgentCounts;
  /**
   * The start screen's prompt, until its editor takes it. Kept here rather than on the editor's
   * address, which could not hold its pictures.
   */
  firstPrompt: FirstPrompt | null;
  /**
   * The run `agents` was last heard from, its server and token: the first answer of a server
   * just started, or reached again over SSH (a new run), is no news, only what it says after.
   */
  heard: { readonly running: Running; readonly token: string } | null;
  readonly id: string;
  /** The start under way and how to stop it. */
  launch: { readonly stop: Deferred.Deferred<StopReason> } | null;
  /** One change to its server at a time: a start, a stop, a start again. */
  readonly lock: Semaphore.Semaphore;
  /** The address its editor is at, when the server moved since it started (a reconnection). */
  movedTo: string | null;
  /** Its splash, from the click until its editor is ready; kept after a failure for Try again. */
  opening: ShownOpening | null;
  /** As the list has it, its name and icon as its view last said (`describe`). */
  project: Project;
  /** Its server, once started and until it stops; none for a tab not shown since the start. */
  running: Running | null;
  /** Whether its tab was on screen at any moment since the last poll: its news is its view's. */
  shownSincePoll: boolean;
}

export class OpenProjects extends Context.Service<
  OpenProjects,
  {
    /** Picks a folder, adds it to the list and opens it. Nothing when the picker is cancelled. */
    readonly add: Effect.Effect<
      Option.Option<Project>,
      StoreError | UnknownProject | ServerStartError
    >;
    /**
     * Adds a folder on another machine (or finds it in the list) and opens it, as `openFolder`
     * does a folder here.
     */
    readonly addRemote: (
      input: RemoteProjectInput
    ) => Effect.Effect<
      { readonly opened: boolean; readonly project: Project },
      StoreError | UnknownProject | ServerStartError
    >;
    /**
     * Closes a tab: its server stops, unless the app only attached to it. Asks first when agents
     * are at work there; false when the person would rather they went on, and nothing changes.
     * The tab seen before it shows when it was the one shown, else Home.
     */
    readonly close: (id: string) => Effect.Effect<boolean>;
    /** The project whose tab is shown; none while Home is. */
    readonly current: Effect.Effect<Option.Option<Project>>;
    /**
     * The notice `id` is over, its toast closed or timed out: the views are told none is, so
     * none shows it again. Nothing when another took its place.
     */
    readonly dismissNotice: (id: string) => Effect.Effect<void>;
    /**
     * What an open project's view says it is called and looks like, its server's info: its tab
     * and the list show it from then on (ADR 0107).
     */
    readonly describe: (id: string, look: ProjectLook) => Effect.Effect<void>;
    /** Whether an open project is on another machine: its view is shown none of this one's. */
    readonly isRemote: (id: string) => Effect.Effect<boolean>;
    /**
     * Opens a project in a new tab, after the others, and shows it; an open one's tab is shown.
     * Fails with why it could not be opened, which its splash says.
     */
    readonly open: (
      id: string
    ) => Effect.Effect<void, StoreError | UnknownProject | ServerStartError>;
    /**
     * Adds a folder (named on the command line, or a new design) when it is not in the list yet,
     * under `name` or the folder's own, and opens it as `open` does, with the start screen's
     * prompt for its editor to take (`takeFirstPrompt`). Whether its server runs: false when it
     * was stopped before it started.
     */
    readonly openFolder: (
      folder: string,
      name?: string,
      start?: FirstPrompt
    ) => Effect.Effect<
      { readonly opened: boolean; readonly project: Project },
      StoreError | UnknownProject | ServerStartError
    >;
    /**
     * A project view could not load the editor of its server (the server stopped answering since
     * it said it was ready): its splash says why, with Try again, which loads it again.
     */
    readonly loadFailed: (id: string, reason: string) => Effect.Effect<void>;
    /**
     * The editor's own steps of a project's open are done, with their times: kept with the
     * shell's for the next open's estimate, and its splash is over.
     */
    readonly openingDone: (
      id: string,
      times: OpeningTimes
    ) => Effect.Effect<void>;
    /**
     * The person's Notifications preference, as an editor has it: what the system tells of the
     * projects not on screen follows it from now on.
     */
    readonly prefer: (preference: Notifications) => Effect.Effect<void>;
    /**
     * Takes a project off the list, with the unsaved session the app kept for it; its folder,
     * here or on another machine, is left as it is. Nothing when it is not in the list. An open
     * project stays: `ProjectOpen`.
     */
    readonly remove: (
      id: string
    ) => Effect.Effect<void, StoreError | ProjectOpen>;
    /**
     * Starts every running project's server again, so that they take up a change to the agents;
     * each editor comes back where it was. Asks once first when agents are at work, naming where;
     * nothing changes when the person says no, nor for a server the app only attached to. A
     * server that does not start again says why on its splash.
     */
    readonly restart: Effect.Effect<void>;
    /**
     * Opens again a project whose open failed, or loads its editor again when that is what
     * failed; nothing when its open did not.
     */
    readonly retryOpening: (id: string) => Effect.Effect<void>;
    /**
     * Shows a tab, starting its server the first time it is shown since the app started; Home
     * with `null`. A server that does not start says why on its splash.
     */
    readonly show: (id: string | null) => Effect.Effect<void>;
    /** Shows the `n`th project's tab (⌘1–⌘8), or the last one's with 9; nothing past them. */
    readonly showAt: (n: number) => Effect.Effect<void>;
    /**
     * At start: the tabs open when the app last ran, each back and only the shown one started,
     * or Home; with `folder` (named on the command line), that folder opened in a tab of its own.
     */
    readonly start: (folder?: string) => Effect.Effect<void, StoreError>;
    /**
     * Stops a project opening, or gives up one that failed: its tab closes, asking first only
     * when an agent works there already.
     */
    readonly stopOpening: (id: string) => Effect.Effect<void>;
    /**
     * Stops every server the app started, as it quits; every launch under way is given up, and
     * none begins after. With `ask`, agents at work are the person's to stop, asked once naming
     * every project they work in: false when they would rather they went on, and nothing is
     * stopped; a second stop while the question is on screen asks nothing more and has its
     * answer. Without, a signal's: a question on screen is answered no, and any asked after it,
     * and the servers stop at once. The tabs stay as they are, for the next start.
     */
    readonly stop: (options: {
      readonly ask: boolean;
    }) => Effect.Effect<boolean>;
    /** The open projects' tabs as the strip shows them. */
    readonly tabs: Effect.Effect<readonly ShellTab[]>;
    /**
     * The start screen's prompt for an open project, once: its editor takes it as it loads. None
     * when the project was opened without one, or it was taken.
     */
    readonly takeFirstPrompt: (id: string) => Effect.Effect<FirstPrompt | null>;
    /**
     * Whether `remove` would delete work kept nowhere else: the app keeps a session for the
     * project that holds something, and its folder has no configuration, beside which a saved
     * project keeps everything. Never for a project on another machine, whose session is there
     * and stays.
     */
    readonly unsaved: (project: Project) => Effect.Effect<boolean>;
    /**
     * Runs `change` with the servers of the projects open on this machine stopped, then starts
     * them again, each editor coming back where it was: for a change no server must be running
     * through, as the person's folder moving (ADR 0091). Asks once first when agents are at work;
     * none, and `change` does not run, when the person says no. With none running, `change` just
     * runs; a server here only attached to (started outside the app, which cannot stop it)
     * refuses it with `ServerNotOurs`. The servers start again whether `change` failed or not,
     * which then fails with its error.
     */
    readonly whileStopped: <A, E>(
      change: Effect.Effect<A, E>
    ) => Effect.Effect<Option.Option<A>, E | ServerNotOurs>;
  }
>()("ultrapaint/desktop/OpenProjects") {
  /**
   * `dataDir` is the app's data directory, where unsaved sessions are kept. `appEditor` is the
   * app's own editor (ADR 0100): a server of its version is shown in it, any other in the editor
   * it serves itself. Without, every server serves its own.
   */
  static readonly layer = (dataDir: string, appEditor?: AppEditor) =>
    Layer.effect(
      OpenProjects,
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

        /** The open projects, in the order their tabs were opened. */
        let tabs: Tab[] = [];
        /**
         * Tabs closed whose server is not stopped yet: a folder move counts their servers until
         * they are, so none uses the folder while it moves.
         */
        let closing: Tab[] = [];
        /** The project whose tab is shown; null while Home is. */
        let shown: string | null = null;
        /** The projects whose view is loaded, the one shown most recently first. */
        let views: string[] = [];
        /** The projects shown since the app started, the one shown most recently first. */
        let seen: string[] = [];
        /** The person's Notifications preference, as an editor last told it; none before. */
        let preferred: Notifications | null = null;
        /** The notice of another project's news the views were told last; null when none is. */
        let notice: ProjectNotice | null = null;
        /** How many notices were made, each one's id. */
        let noticesMade = 0;
        /** Once the app quits: no launch begins, and one that ends lets its server go. */
        let quitting = false;
        // Done once a signal stops the app: no question is answered yes after it.
        const signalled = yield* Deferred.make<void>();
        // The quit being asked, whose answer a second close or Cmd-Q meanwhile waits for.
        let quitAsked: Deferred.Deferred<boolean> | null = null;
        // Each server's scope is forked from the app's: none outlives it.
        const appScope = yield* Effect.scope;
        const hold = yield* Semaphore.make(HOLD);

        /** Runs a change to one tab's server: one at a time for it, none while all change. */
        const ofTab =
          (tab: Tab) =>
          <A, E, R>(change: Effect.Effect<A, E, R>) =>
            hold.withPermits(1)(tab.lock.withPermits(1)(change));
        /** Runs a change to every server, once those under way are done. */
        const ofAll = hold.withPermits(HOLD);

        /**
         * One open, close or removal of a project at a time: a project reopened waits for its
         * close to let its server and view go, and one opened while it is taken off the list
         * finds it gone.
         */
        const idLocks = new Map<string, Semaphore.Semaphore>();
        const ofId = (id: string) => {
          let lock = idLocks.get(id);
          if (!lock) {
            lock = Semaphore.makeUnsafe(1);
            idLocks.set(id, lock);
          }
          return lock.withPermits(1);
        };

        /**
         * The open projects on another machine, as long as their view may call the bridge: a
         * closing tab's view counts as remote until it is let go.
         */
        const remoteIds = new Set<string>();

        /** While the tabs of the last run come back, an open waits for them (`start`). */
        let restoring: Deferred.Deferred<void> | null = null;

        const find = (id: string) => tabs.find((t) => t.id === id);
        const isOpen = (tab: Tab) => tabs.includes(tab);

        /** Asks the person, unless a signal came first or comes while the question is on screen. */
        const confirm = (question: {
          readonly action: string;
          readonly detail: string;
          readonly message: string;
        }) =>
          Effect.flatMap(Deferred.isDone(signalled), (cut) =>
            cut
              ? Effect.succeed(false)
              : Effect.raceFirst(
                  shell.confirm(question),
                  // Interrupted, the shell takes the question off the screen.
                  Effect.as(Deferred.await(signalled), false)
                )
          );

        /** The projects of `targets` with agents at work, in a server the app started. */
        const busyOf = (targets: readonly Tab[]) =>
          Effect.map(
            Effect.forEach(
              targets,
              (tab) =>
                tab.running && !tab.running.server.attached
                  ? Effect.map(
                      tab.running.server.agents,
                      (said): Busy => ({
                        id: tab.id,
                        name: tab.project.name,
                        working: countsOr(said).working,
                      })
                    )
                  : Effect.succeed<Busy>({
                      id: tab.id,
                      name: tab.project.name,
                      working: 0,
                    }),
              { concurrency: "unbounded" }
            ),
            (all) => all.filter((b) => b.working > 0)
          );

        /**
         * Whether the person lets the agents at work in the servers `targets` gives be stopped:
         * true when none are. Asked again, naming them all, when a project the answer did not
         * cover is busy once it is given (an agent started, a start ended, while they answered):
         * an answer covers only the projects it named.
         */
        const agreeToStop = Effect.fnUntraced(function* (
          action: StopAll,
          targets: () => readonly Tab[],
          /** The projects agreed to already, which this adds to. */
          agreed: Set<string> = new Set<string>()
        ) {
          for (;;) {
            const busy = yield* busyOf(targets());
            if (busy.every((b) => agreed.has(b.id))) {
              return true;
            }
            if (!(yield* confirm(stopQuestion(action, busy)))) {
              return false;
            }
            for (const b of busy) {
              agreed.add(b.id);
            }
          }
        });

        /** What a tab shows now. */
        const stateOf = (tab: Tab): TabState => {
          if (tab.opening && tab.opening.state.problem === undefined) {
            return "opening";
          }
          if (tab.agents.waiting > 0) {
            return "waiting";
          }
          return tab.agents.working > 0 ? "working" : "idle";
        };

        const tabsNow = (): ShellTab[] =>
          tabs.map((tab) => ({
            ...(tab.project.icon ? { icon: tab.project.icon } : {}),
            id: tab.id,
            name: tab.project.name,
            ...(tab.running
              ? { server: tab.movedTo ?? tab.running.server.url }
              : {}),
            shown: tab.id === shown,
            state: stateOf(tab),
          }));

        /** The strip is told only a change. */
        const tabsChanged = changes();
        const tellTabs = Effect.suspend(() => {
          const next = tabsNow();
          return tabsChanged(next) ? shell.tabs(next) : Effect.void;
        });

        /** Kept for the next start only when they changed. */
        const keptChanged = changes();
        const keepTabs = Effect.suspend(() => {
          const next = { open: tabs.map((t) => t.id), shown };
          // A list that cannot be written loses the tabs for the next start, never what is open.
          return keptChanged(next)
            ? Effect.ignore(store.setTabs(next))
            : Effect.void;
        });

        /** The tabs changed: the strip is told, and they are kept for the next start. */
        const changed = Effect.andThen(tellTabs, keepTabs);

        /**
         * The editor for the server at `url`: the app's own when the server runs the app's
         * version (cached, its storage kept, ADR 0100), the one the server serves otherwise.
         */
        const editorAt = Effect.fnUntraced(function* (
          url: string,
          version: Effect.Effect<string | undefined>,
          options: {
            /** Started outside the app, it was never told the app's origin. */
            readonly attached: boolean;
            readonly keepLocation?: boolean;
          }
        ) {
          const own =
            appEditor !== undefined &&
            !options.attached &&
            (yield* version) === appEditor.version;
          return {
            _tag: "Editor",
            ...(options.keepLocation ? { keepLocation: true } : {}),
            ...(own ? { server: url, url: appEditor.url } : { url }),
          } satisfies View;
        });

        /** Where a tab's editor is now: its server's address, or where it moved to over SSH. */
        const endpointOf = (tab: Tab) => tab.movedTo ?? tab.running?.server.url;

        /** The editor of a tab's running server, where it is now (moved, over SSH). */
        const editorOf = (
          tab: Tab,
          running: Running,
          options: { readonly keepLocation?: boolean } = {}
        ) =>
          tab.movedTo === null
            ? editorAt(running.server.url, running.server.version, {
                ...options,
                attached: running.server.attached,
              })
            : editorAt(tab.movedTo, serverVersion(tab.movedTo), {
                ...options,
                attached: running.server.attached,
              });

        /**
         * Loads a tab's editor in its view, when the view is still loaded and the tab still has
         * that server once the editor is known: a tab closed or a view let go meanwhile is not
         * brought back.
         */
        const loadEditor = Effect.fnUntraced(function* (
          tab: Tab,
          running: Running,
          options: { readonly keepLocation?: boolean } = {}
        ) {
          const own = () =>
            isOpen(tab) && tab.running === running && views.includes(tab.id);
          // A view not loaded loads its editor when shown (`loadView`): nothing to look for.
          // Reconnected elsewhere (SSH, the same server) while the version was asked: asked
          // again of where it is now.
          while (own()) {
            const at = endpointOf(tab);
            const view = yield* editorOf(tab, running, options);
            if (own() && endpointOf(tab) === at) {
              yield* shell.load(tab.id, view);
              return;
            }
          }
        });

        /** Lets go of the views past the ones kept, the ones seen least recently. */
        const trimViews = Effect.suspend(() => {
          const past = views.slice(MAX_VIEWS);
          views = views.slice(0, MAX_VIEWS);
          return Effect.forEach(past, (id) => shell.drop(id), {
            discard: true,
          });
        });

        /** Tells a tab's view its splash as it stands. */
        const tellOpening = (tab: Tab) =>
          Effect.suspend(() =>
            shell.opening(tab.id, tab.opening?.state ?? null)
          );

        /** Changes `underway`'s state and tells the view; nothing once another took its place. */
        const changeOpening = (
          tab: Tab,
          underway: ShownOpening,
          change: (state: Opening, now: number) => Opening
        ) =>
          Effect.flatMap(Clock.currentTimeMillis, (now) =>
            Effect.suspend(() => {
              if (tab.opening !== underway) {
                return Effect.void;
              }
              underway.state = change(underway.state, now);
              return tellOpening(tab);
            })
          );

        /** What a start tells `underway`: its lines, and the steps it reaches. */
        const reportTo = (tab: Tab, underway: ShownOpening): OpeningReport => ({
          line: (text) =>
            changeOpening(tab, underway, (o) => noteLine(o, text)),
          // A step reached again (a reconnection while the editor does its steps) changes nothing.
          reached: (step) =>
            changeOpening(tab, underway, (o, now) =>
              o.steps.some((s) => s.id === step && s.state !== "next")
                ? o
                : reachStep(o, step, now)
            ),
        });

        /** The splash of a tab's open, begun now and told its view. */
        const beginOpening = Effect.fnUntraced(function* (tab: Tab) {
          const { project } = tab;
          const now = yield* Clock.currentTimeMillis;
          const steps = openingSteps(
            project.kind,
            project.kind === "ssh" ? project.host : undefined
          );
          const estimate = estimateFrom(steps, project.lastOpening);
          const underway: ShownOpening = {
            state: reachStep(
              {
                ...(estimate === undefined ? {} : { estimate }),
                log: [],
                name: project.name,
                remote: project.kind === "ssh",
                since: now,
                steps,
                where: projectDetail(project),
              },
              steps[0]?.id ?? null,
              now
            ),
          };
          tab.opening = underway;
          yield* tellOpening(tab);
          return underway;
        });

        /** Stops a server, by closing its scope: the one way any does. */
        const stopServer = (scope: Scope.Closeable) =>
          Scope.close(scope, Exit.void);

        /** Starts a tab's server, in a scope of its own; nothing is shown. */
        const startServer = Effect.fn("OpenProjects.startServer")(function* (
          tab: Tab
        ) {
          const { project } = tab;
          const scope = yield* Scope.fork(appScope);
          const server = yield* (
            project.kind === "ssh"
              ? // There, the server runs the remote machine's own agents: the app's are not.
                remote.start(project, {
                  // The editor at another port, or another server's: its view loads it there
                  // again, when it is loaded.
                  moved: (movedTo) =>
                    Effect.gen(function* () {
                      const version = yield* serverVersion(movedTo);
                      const { running } = tab;
                      if (!(running && isOpen(tab))) {
                        return;
                      }
                      tab.movedTo = movedTo;
                      const view = yield* editorAt(
                        movedTo,
                        Effect.succeed(version),
                        {
                          attached: running.server.attached,
                          keepLocation: true,
                        }
                      );
                      if (
                        isOpen(tab) &&
                        tab.running === running &&
                        views.includes(tab.id)
                      ) {
                        yield* shell.load(tab.id, view);
                      }
                      yield* tellTabs;
                    }),
                  status: (status) => shell.status(tab.id, status),
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
            Effect.onError(() => stopServer(scope))
          );
          return { scope, server } satisfies Running;
        });

        /**
         * Runs a tab's launch so that it can be stopped: what it gave, or why it was stopped.
         * Stopped, the launch is interrupted: its scope closes, and the connection with it. Once
         * the app quits none begins.
         */
        const stoppable = Effect.fnUntraced(function* <A, E>(
          tab: Tab,
          launched: Effect.Effect<A, E>
        ) {
          if (quitting) {
            return { _tag: "stopped", reason: "quit" } as Launched<A>;
          }
          if (tab.launch) {
            return { _tag: "stopped", reason: "taken" } as Launched<A>;
          }
          // Closed while what led here waited (a stop, a lock, a probe): nothing starts for it.
          if (!isOpen(tab)) {
            return { _tag: "stopped", reason: "close" } as Launched<A>;
          }
          const stop = yield* Deferred.make<StopReason>();
          tab.launch = { stop };
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
                if (tab.launch?.stop === stop) {
                  tab.launch = null;
                }
              })
            )
          );
        });

        /** Stops a tab's launch under way, if one is. */
        const stopLaunch = (tab: Tab, reason: StopReason) =>
          Effect.suspend(() =>
            tab.launch
              ? Effect.asVoid(Deferred.succeed(tab.launch.stop, reason))
              : Effect.void
          );

        /** Lets go of a tab's server, if it has one: it stops, unless the app only attached. */
        const release = (tab: Tab) =>
          Effect.suspend(() => {
            const was = tab.running;
            tab.running = null;
            tab.agents = NO_AGENTS;
            tab.heard = null;
            return was ? stopServer(was.scope) : Effect.void;
          });

        /**
         * A server started for a tab no longer open, or one that has a server already, or as the
         * app quits, goes at once: a tab never holds two.
         */
        const keep = Effect.fnUntraced(function* (tab: Tab, next: Running) {
          if (quitting || !isOpen(tab) || tab.running) {
            yield* stopServer(next.scope);
            return false;
          }
          tab.running = next;
          tab.movedTo = null;
          return true;
        });

        /**
         * Starts a tab's server on its splash, begun already: once it is ready its editor loads in
         * the tab's view, when the view is loaded. False when it was stopped; fails with why it
         * could not be started, which the splash says.
         */
        const launch = Effect.fnUntraced(function* (
          tab: Tab,
          underway: ShownOpening
        ) {
          const launched = yield* stoppable(
            tab,
            startServer(tab).pipe(
              Effect.provideService(OpeningReport, reportTo(tab, underway))
            )
          ).pipe(
            Effect.tapError((error) =>
              Effect.andThen(
                changeOpening(tab, underway, (o, now) =>
                  failOpening(o, error.message, now)
                ),
                tellTabs
              )
            )
          );
          // Stopped, what stopped it saw to the tab: its close, or the quit. A quit the person
          // then declined leaves the start to try again.
          if (launched._tag === "stopped") {
            if (launched.reason === "quit" && !quitting) {
              yield* changeOpening(tab, underway, (o, now) =>
                failOpening(
                  o,
                  "Its start was stopped as the app began to quit",
                  now
                )
              );
              yield* tellTabs;
            }
            return false;
          }
          // The shell's steps are done; the editor's begin as its view loads.
          yield* changeOpening(tab, underway, (o, now) =>
            reachStep(
              o,
              o.steps.find((s) => isEditorStep(s.id))?.id ?? null,
              now
            )
          );
          // The times are for the next estimate only: a list that cannot be written loses
          // that, never the server just started.
          yield* Effect.ignore(store.timed(tab.id, stepTimes(underway.state)));
          if (!(yield* keep(tab, launched.value))) {
            return false;
          }
          // When it was opened, for the start that brings back the last: a list that cannot be
          // written loses that, never the editor it opens.
          yield* Effect.ignore(store.opened(tab.id));
          yield* loadEditor(tab, launched.value);
          yield* changed;
          return true;
        });

        /** Whether a tab has no server, none starting and no splash: one never started. */
        const unstarted = (tab: Tab) =>
          !(tab.running || tab.launch || tab.opening);

        /**
         * Starts a tab's server on its splash when it never did since the app started (or its
         * open was stopped); nothing when it did meanwhile, or a start is under way. Fails as the
         * start does.
         */
        const ensureStarted = (tab: Tab) =>
          ofTab(tab)(
            Effect.suspend(() =>
              isOpen(tab) && unstarted(tab) && !quitting
                ? Effect.flatMap(beginOpening(tab), (underway) =>
                    Effect.andThen(tellTabs, launch(tab, underway))
                  )
                : Effect.succeed(false)
            )
          );

        /**
         * What a tab's view shows: its editor, or its splash while it has no server or a failure
         * stays on it until Try again. Not `current` when the tab's server changed meanwhile.
         */
        const viewFor = Effect.fnUntraced(function* (tab: Tab) {
          const { running } = tab;
          const at = endpointOf(tab);
          const view: View =
            running && !tab.opening?.state.problem
              ? yield* editorOf(tab, running)
              : { _tag: "Opening" };
          return {
            current: tab.running === running && endpointOf(tab) === at,
            view,
          };
        });

        /**
         * Loads a tab's view when it is not loaded: its editor, or its splash. False when another
         * tab, or Home, was shown while the editor was looked for, or this one closed: the show
         * goes no further.
         */
        const loadView = Effect.fnUntraced(function* (tab: Tab) {
          if (views.includes(tab.id)) {
            return true;
          }
          // Its editor, at the server it has once the editor is known: started again or moved
          // while the version was asked, it is asked again of the one it has now.
          let view = yield* viewFor(tab);
          while (!(view.current || shown !== tab.id || !isOpen(tab))) {
            view = yield* viewFor(tab);
          }
          if (shown !== tab.id || !isOpen(tab)) {
            return false;
          }
          if (!views.includes(tab.id)) {
            yield* shell.load(tab.id, view.view);
          }
          return true;
        });

        /**
         * Shows a tab: its view loads when it is not loaded (its editor, or its splash), and its
         * server starts when it never did. Fails as that start does.
         */
        const showTab = Effect.fnUntraced(function* (id: string | null) {
          const tab = id === null ? undefined : find(id);
          if (!tab) {
            shown = null;
            yield* shell.show(null);
            yield* changed;
            return;
          }
          shown = tab.id;
          tab.shownSincePoll = true;
          seen = [tab.id, ...seen.filter((s) => s !== tab.id)];
          // Its news is in sight now.
          yield* clearNotice(tab.id);
          if (!(yield* loadView(tab))) {
            return;
          }
          views = [tab.id, ...views.filter((v) => v !== tab.id)];
          yield* trimViews;
          yield* shell.show(tab.id);
          yield* keepTabs;
          // The strip told last, then the start asked for at once: what the strip shows is what
          // was asked.
          yield* tellTabs;
          // Another shown while the tabs were written: this one starts when it is shown again.
          if (shown === tab.id && unstarted(tab)) {
            yield* ensureStarted(tab);
          }
        });

        /** A tab for `project`, not started. */
        const tabOf = (project: Project): Tab => ({
          agents: NO_AGENTS,
          firstPrompt: null,
          heard: null,
          id: project.id,
          launch: null,
          lock: Semaphore.makeUnsafe(1),
          movedTo: null,
          opening: null,
          project,
          running: null,
          shownSincePoll: false,
        });

        /**
         * Opens a project in a tab of its own, after the others, or shows its tab when it has one;
         * the prompt given goes to its editor, loaded again to take it when it is on screen.
         * Whether its server runs.
         */
        const openProject = Effect.fnUntraced(function* (
          project: Project,
          start?: FirstPrompt
        ) {
          // Opened as the app starts (a second launch naming a folder): after the tabs are back.
          if (restoring) {
            yield* Deferred.await(restoring);
          }
          const { known, tab } = yield* ofId(project.id)(
            Effect.gen(function* () {
              // Taken off the list meanwhile, it is not opened.
              const current = yield* store.get(project.id);
              const was = find(project.id);
              if (was) {
                // As the list now has it: a command changed since starts the next start with it.
                was.project = current;
              } else {
                tabs = [...tabs, tabOf(current)];
                if (current.kind === "ssh") {
                  remoteIds.add(current.id);
                }
              }
              const opened = find(project.id) ?? tabOf(current);
              if (start) {
                opened.firstPrompt = start;
              }
              return { known: was !== undefined, tab: opened };
            })
          );
          if (known && start && tab.running) {
            yield* loadEditor(tab, tab.running);
          }
          yield* showTab(tab.id);
          return tab.running !== null;
        });

        const openFolder = Effect.fn("OpenProjects.openFolder")(function* (
          folder: string,
          name?: string,
          start?: FirstPrompt
        ) {
          const project = yield* store.add(folder, name);
          return { opened: yield* openProject(project, start), project };
        });

        /**
         * Whether the person lets a tab's agents at work be stopped: asked when there are any, in
         * a server the app started; true when there is nothing to ask.
         */
        const agreeToClose = Effect.fnUntraced(function* (tab: Tab) {
          const { running } = tab;
          if (!running || running.server.attached) {
            return true;
          }
          const { working } = countsOr(yield* running.server.agents);
          return (
            working === 0 ||
            (yield* confirm(closeQuestion(tab.project.name, working)))
          );
        });

        const close = Effect.fn("OpenProjects.close")(function* (id: string) {
          const tab = find(id);
          if (!tab) {
            return true;
          }
          if (!(yield* agreeToClose(tab))) {
            return false;
          }
          // Its id taken until its server and view are let go: opened again, it waits for them.
          return yield* ofId(id)(teardown(tab));
        });

        /** A tab closes: it goes from the strip, its view is let go, then its server stops. */
        const teardown = Effect.fnUntraced(function* (tab: Tab) {
          const { id } = tab;
          // Closed meanwhile, by another close.
          if (!isOpen(tab)) {
            return true;
          }
          closing = [...closing, tab];
          tabs = tabs.filter((t) => t !== tab);
          seen = seen.filter((s) => s !== id);
          const hadView = views.includes(id);
          views = views.filter((v) => v !== id);
          // A start under way ends now, and lets its tab's lock go.
          yield* stopLaunch(tab, "close");
          tab.opening = null;
          if (shown === id) {
            // The one seen before it was started already: showing it starts nothing.
            yield* Effect.ignore(showTab(seen[0] ?? null));
          }
          if (hadView) {
            yield* shell.drop(id);
          }
          // Its view let go, nothing of it calls the bridge any more.
          remoteIds.delete(id);
          yield* clearNotice(id);
          yield* changed;
          yield* ofTab(tab)(release(tab)).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                closing = closing.filter((t) => t !== tab);
              })
            )
          );
          return true;
        });

        /**
         * Starts a tab's server again, with no splash, its editor coming back where it was. One
         * that does not start says why on its splash, with Try again.
         */
        const startAgain = Effect.fnUntraced(function* (tab: Tab) {
          const launched: StartedAgain<Running> = yield* stoppable(
            tab,
            startServer(tab)
          ).pipe(
            Effect.catch((error) =>
              Effect.gen(function* () {
                const underway = yield* beginOpening(tab);
                yield* changeOpening(tab, underway, (o, now) =>
                  failOpening(o, error.message, now)
                );
                if (views.includes(tab.id)) {
                  yield* shell.load(tab.id, { _tag: "Opening" });
                }
                return { _tag: "failed" } as const;
              })
            )
          );
          if (launched._tag === "done" && (yield* keep(tab, launched.value))) {
            yield* loadEditor(tab, launched.value, { keepLocation: true });
          }
          yield* changed;
        });

        /** Stops a tab's server, for it to start again. */
        const stopForAgain = Effect.fnUntraced(function* (tab: Tab) {
          yield* release(tab);
          // Whatever it was saying (reconnecting) is no longer so.
          yield* shell.status(tab.id, null);
        });

        /** Every launch under way is given up, every server the app started stops. */
        const stopAll = Effect.suspend(() => {
          quitting = true;
          const all = tabs;
          return Effect.forEach(
            all,
            (tab) =>
              // Not under the tab's lock: a quit waits for no start.
              Effect.andThen(stopLaunch(tab, "quit"), release(tab)),
            { concurrency: "unbounded", discard: true }
          );
        });

        /** A quit the person is asked about; a second one meanwhile has the first's answer. */
        const askToQuit = Effect.suspend(() => {
          if (quitAsked) {
            return Deferred.await(quitAsked);
          }
          const asked = Deferred.makeUnsafe<boolean>();
          quitAsked = asked;
          return Effect.onExit(
            Effect.gen(function* () {
              const agreed = new Set<string>();
              for (;;) {
                // Every project as it is once the answer is given: a start that ended
                // meanwhile, busy now, is asked about too.
                if (!(yield* agreeToStop("quit", () => tabs, agreed))) {
                  return false;
                }
                // The starts under way end now (a quit waits for none, a machine that does not
                // answer included); then, under the hold, no server starts between the last look
                // and the stop.
                yield* Effect.forEach(tabs, (tab) => stopLaunch(tab, "quit"), {
                  discard: true,
                });
                const stopped = yield* ofAll(
                  Effect.gen(function* () {
                    const busy = yield* busyOf(tabs);
                    if (!busy.every((b) => agreed.has(b.id))) {
                      return false;
                    }
                    yield* stopAll;
                    return true;
                  })
                );
                if (stopped) {
                  return true;
                }
              }
            }),
            (exit) => {
              quitAsked = null;
              return Deferred.done(asked, exit);
            }
          );
        });

        /** A signal's quit: a question on screen is answered no, then the servers stop. */
        const stopAtOnce = Effect.andThen(
          Deferred.succeed(signalled, undefined),
          Effect.as(stopAll, true)
        );

        /**
         * Tells the person a project's news: over the editor on screen while the window is in
         * front, else by the system as their Notifications preference says: the one an editor
         * last told (`prefer`), else the one in their profile here, read now.
         */
        const tellNews = Effect.fnUntraced(function* (tab: Tab, news: News) {
          const { name } = tab.project;
          const words = NEWS_WORDS[news];
          if (yield* shell.focused) {
            noticesMade += 1;
            notice = {
              id: String(noticesMade),
              news,
              project: tab.id,
              title: `${name}: ${words.notice}`,
            };
            yield* shell.notice(notice);
            return;
          }
          const preference =
            preferred ??
            (yield* folders.current.pipe(
              Effect.flatMap(({ user }) => notifyPreference(user)),
              Effect.provideService(FileSystem.FileSystem, fs),
              Effect.provideService(Path.Path, path),
              // A folder setting that cannot be read is no choice made: nothing is said.
              Effect.orElseSucceed((): Notifications => "off")
            ));
          if (preference === "off") {
            return;
          }
          yield* shell.alert({
            body: words.body,
            preference,
            project: tab.id,
            title: name,
          });
        });

        /** Takes the notice away when it is of `id`'s project. */
        const clearNotice = (id: string) =>
          Effect.suspend(() => {
            if (notice?.project !== id) {
              return Effect.void;
            }
            notice = null;
            return shell.notice(null);
          });

        /** Takes in what a tab's server says of its agents now, and tells its news. */
        const hear = (tab: Tab, running: Running, now: AgentCounts) =>
          Effect.suspend(() => {
            // Closed, stopped or started again while it was asked: the next poll's to ask.
            if (!isOpen(tab) || tab.running !== running) {
              return Effect.void;
            }
            const { token } = running.server;
            const news =
              tab.heard?.running === running && tab.heard.token === token
                ? newsOf(tab.agents, now)
                : null;
            tab.agents = now;
            tab.heard = { running, token };
            // A tab on screen at any moment since the last poll tells its own news, from its
            // view: its editor heard of it as it happened, when it may have been on screen.
            const ours = !tab.shownSincePoll;
            tab.shownSincePoll = tab.id === shown;
            return news && ours ? tellNews(tab, news) : Effect.void;
          });

        /** Asks each running server about its agents, for the tabs and the news. */
        const poll = Effect.andThen(
          Effect.suspend(() =>
            Effect.forEach(
              tabs,
              (tab) =>
                Effect.suspend(() => {
                  const { running } = tab;
                  return running
                    ? Effect.flatMap(running.server.agents, (said) =>
                        // One that does not answer is asked again next time.
                        Option.isSome(said)
                          ? hear(tab, running, said.value)
                          : Effect.void
                      )
                    : Effect.void;
                }),
              { concurrency: "unbounded", discard: true }
            )
          ),
          tellTabs
        );
        yield* poll.pipe(
          Effect.repeat(Schedule.spaced(POLL_EVERY)),
          Effect.forkScoped
        );

        /** What a directory holds: nothing when it is not there, or cannot be read. */
        const entries = (dir: string) =>
          fs.readDirectory(dir).pipe(Effect.orElseSucceed((): string[] => []));

        const unsaved = Effect.fn("OpenProjects.unsaved")(function* (
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

        const remove = Effect.fn("OpenProjects.remove")(function* (id: string) {
          // Taken off the list under its id: an open meanwhile waits, and finds it gone.
          return yield* ofId(id)(removeNow(id));
        });

        const removeNow = Effect.fnUntraced(function* (id: string) {
          const found = yield* Effect.catchTag(
            Effect.asSome(store.get(id)),
            "UnknownProject",
            () => Effect.succeedNone
          );
          if (Option.isNone(found)) {
            return;
          }
          if (find(id)) {
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

        return OpenProjects.of({
          add: Effect.gen(function* () {
            const folder = yield* shell.pickFolder({
              title: "Open a project folder",
            });
            return Option.isNone(folder)
              ? Option.none()
              : Option.some((yield* openFolder(folder.value)).project);
          }),
          addRemote: Effect.fn("OpenProjects.addRemote")(function* (
            input: RemoteProjectInput
          ) {
            const project = yield* store.addRemote(input);
            return { opened: yield* openProject(project), project };
          }),
          close,
          current: Effect.sync(() =>
            Option.fromNullishOr(
              shown === null ? undefined : find(shown)?.project
            )
          ),
          describe: Effect.fn("OpenProjects.describe")(function* (
            id: string,
            look: ProjectLook
          ) {
            const tab = find(id);
            if (!tab) {
              return;
            }
            tab.project = withLook(tab.project, look);
            // The list follows when it can be written; the tab shows it either way.
            yield* Effect.ignore(store.describe(id, look));
            yield* tellTabs;
          }),
          dismissNotice: (id) =>
            Effect.suspend(() => {
              if (notice?.id !== id) {
                return Effect.void;
              }
              notice = null;
              return shell.notice(null);
            }),
          isRemote: (id) => Effect.sync(() => remoteIds.has(id)),
          loadFailed: Effect.fn("OpenProjects.loadFailed")(function* (
            id: string,
            reason: string
          ) {
            const tab = find(id);
            if (!tab?.running) {
              return;
            }
            const underway = yield* beginOpening(tab);
            yield* changeOpening(tab, underway, (o, now) =>
              failOpening(
                reachStep(
                  o,
                  o.steps.find((step) => isEditorStep(step.id))?.id ?? null,
                  now
                ),
                reason,
                now
              )
            );
            if (views.includes(tab.id)) {
              yield* shell.load(tab.id, { _tag: "Opening" });
            }
            yield* tellTabs;
          }),
          open: (id) =>
            Effect.asVoid(
              Effect.flatMap(store.get(id), (project) => openProject(project))
            ),
          openFolder,
          openingDone: Effect.fn("OpenProjects.openingDone")(function* (
            id: string,
            times: OpeningTimes
          ) {
            const tab = find(id);
            const underway = tab?.opening;
            if (!(tab && underway) || underway.state.problem || !tab.running) {
              return;
            }
            tab.opening = null;
            yield* tellOpening(tab);
            yield* tellTabs;
            // The times are for the next estimate only: a list that cannot be written loses
            // that, and the open itself is done.
            yield* Effect.ignore(
              store.timed(id, { ...stepTimes(underway.state), ...times })
            );
          }),
          prefer: (preference) =>
            Effect.sync(() => {
              preferred = preference;
            }),
          remove,
          // Once the starts under way are done, so that one that read the old setup starts again
          // too, and the person is asked about the servers then running, which none joins while
          // they answer.
          restart: ofAll(
            Effect.gen(function* () {
              const targets = tabs.filter(
                (t) => t.running !== null && !t.running.server.attached
              );
              if (
                targets.length === 0 ||
                !(yield* agreeToStop("restart", () => targets.filter(isOpen)))
              ) {
                return;
              }
              yield* Effect.forEach(
                targets.filter(isOpen),
                (tab) => Effect.andThen(stopForAgain(tab), startAgain(tab)),
                { concurrency: "unbounded", discard: true }
              );
            })
          ),
          retryOpening: (id) =>
            Effect.suspend(() => {
              const tab = find(id);
              if (!tab?.opening?.state.problem) {
                return Effect.void;
              }
              // Failed again, the splash says why: the caller has nothing to add.
              return Effect.ignore(
                ofTab(tab)(
                  Effect.suspend(() => {
                    const { running } = tab;
                    // Closed, or started, while it waited for the tab's lock: nothing to do.
                    if (
                      !(isOpen(tab) && tab.opening?.state.problem) ||
                      tab.launch
                    ) {
                      return Effect.void;
                    }
                    // Its server runs, and its editor would not load: loaded again.
                    if (running) {
                      return Effect.gen(function* () {
                        // Its process gone (exited once ready), it is let go and started again; a
                        // slow or silent health check is no sign of that, and only reloads.
                        if (yield* running.server.exited) {
                          yield* release(tab);
                          // Closed while it was looked at: nothing starts for it.
                          if (!isOpen(tab)) {
                            return;
                          }
                          const again = yield* beginOpening(tab);
                          yield* tellTabs;
                          yield* launch(tab, again);
                          return;
                        }
                        const underway = yield* beginOpening(tab);
                        yield* changeOpening(tab, underway, (o, now) =>
                          reachStep(
                            o,
                            o.steps.find((step) => isEditorStep(step.id))?.id ??
                              null,
                            now
                          )
                        );
                        yield* tellTabs;
                        yield* loadEditor(tab, running);
                      });
                    }
                    return Effect.flatMap(beginOpening(tab), (underway) =>
                      Effect.andThen(tellTabs, launch(tab, underway))
                    );
                  })
                )
              );
            }),
          show: (id) =>
            // Failed, the splash says why: the strip has nothing to add.
            Effect.ignore(showTab(id)),
          showAt: (n) =>
            Effect.suspend(() => {
              const tab = n === 9 ? tabs.at(-1) : tabs[n - 1];
              return tab ? Effect.ignore(showTab(tab.id)) : Effect.void;
            }),
          start: Effect.fn("OpenProjects.start")(function* (folder?: string) {
            // An open meanwhile (a second launch naming a folder) waits for the tabs to be back.
            const restored = Deferred.makeUnsafe<void>();
            restoring = restored;
            // Unread, nothing is restored, and the opens waiting go on without it.
            const letOpensGo = Effect.suspend(() => {
              restoring = null;
              return Deferred.succeed(restored, undefined);
            });
            const kept = yield* store.tabs.pipe(
              Effect.tapError(() => letOpensGo)
            );
            const projects = yield* store.list.pipe(
              Effect.tapError(() => letOpensGo)
            );
            tabs = kept.open.flatMap((id) => {
              const project = projects.find((p) => p.id === id);
              return project ? [tabOf(project)] : [];
            });
            for (const tab of tabs) {
              if (tab.project.kind === "ssh") {
                remoteIds.add(tab.id);
              }
            }
            keptChanged({ open: kept.open, shown: kept.shown });
            yield* letOpensGo;
            if (folder !== undefined) {
              // A project that cannot start leaves its splash saying why, with Try again.
              yield* Effect.ignore(openFolder(folder));
              return;
            }
            // A project that cannot start leaves its splash saying why, with Try again.
            yield* Effect.ignore(showTab(kept.shown));
          }),
          stop: ({ ask }) => (ask ? askToQuit : stopAtOnce),
          stopOpening: (id) =>
            Effect.suspend(() => {
              const tab = find(id);
              return tab?.opening ? Effect.asVoid(close(id)) : Effect.void;
            }),
          tabs: Effect.sync(tabsNow),
          takeFirstPrompt: (id) =>
            Effect.sync(() => {
              const tab = find(id);
              const kept = tab?.firstPrompt ?? null;
              if (tab) {
                tab.firstPrompt = null;
              }
              return kept;
            }),
          unsaved,
          // Under the hold from the first look: no server starts, nor attaches, while the folder
          // moves, and what is checked is what is stopped.
          whileStopped: <A, E>(change: Effect.Effect<A, E>) =>
            ofAll(
              Effect.gen(function* () {
                // The tabs closing too: their servers run until they are stopped.
                const all = [...tabs, ...closing];
                const theirs = all.find(
                  (t) =>
                    t.running?.server.attached && t.project.kind === "local"
                );
                if (theirs) {
                  return yield* new ServerNotOurs({
                    message: `${theirs.project.name} runs on a server started outside the app, which uses your folder where it is. Stop it, close its tab, then try again.`,
                  });
                }
                const targets = all.filter(
                  (t) => t.project.kind === "local" && t.running !== null
                );
                if (
                  targets.length > 0 &&
                  !(yield* agreeToStop("move", () => targets))
                ) {
                  return Option.none<A>();
                }
                yield* Effect.forEach(targets, stopForAgain, {
                  concurrency: "unbounded",
                  discard: true,
                });
                const done = yield* Effect.exit(change);
                yield* Effect.forEach(targets.filter(isOpen), startAgain, {
                  concurrency: "unbounded",
                  discard: true,
                });
                return Option.some(yield* done);
              })
            ),
        });
      })
    );
}
