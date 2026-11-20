/** Fakes of what the app's services ask of Electron and of the server, for tests. */
import type { Opening } from "@ultrapaint/contracts/opening";
import type {
  ProjectNotice,
  ShellStatus,
  ShellTab,
} from "@ultrapaint/contracts/shell-bridge";
import { Effect, Layer, Option } from "effect";
import { ServerStartError } from "./errors.ts";
import { OpeningReport } from "./opening-report.ts";
import { ProjectServer, type ServerOptions } from "./project-server.ts";
import { RemoteProjects } from "./remote-project.ts";
import { type Alert, Shell, type View } from "./shell.ts";

/** What the fakes saw, in order. */
export interface Recorded {
  /** What the system was asked to tell the person, in order. */
  alerts: Alert[];
  /**
   * Answers the next `confirm` questions get; true when there are none left. An effect is an
   * answer given later: `Effect.never` leaves the question on screen.
   */
  answers: (boolean | Effect.Effect<boolean>)[];
  /** What runs as a project view is let go, before it is (to look at the app then). */
  beforeDrop: Effect.Effect<void> | null;
  /** What declining each question was called, in order. */
  declines: string[];
  /** What each question said at more length, in order. */
  details: string[];
  /** The projects whose view was let go, in order. */
  drops: string[];
  events: string[];
  /** How many agents each folder's server says stopped on an error. */
  failed: Record<string, number>;
  /** Whether the window is in front; it is unless a test says otherwise. */
  focused: boolean;
  /** What the views were told of other projects' agents, in order: `null` once none is. */
  notices: (ProjectNotice | null)[];
  /** What each project view was told of its opening, in order: `null` once none is. */
  openings: (Opening | null)[];
  /** The titles of the pickers opened, in order. */
  pickers: string[];
  /** Paths the next pickers return; cancelled when there are none left. */
  picks: string[];
  /**
   * Each folder's latest server process, which a test makes exit (`exit`): the one it was then,
   * not the one a later start makes.
   */
  processes: Partial<Record<string, { exited: boolean }>>;
  questions: string[];
  /** Folders (or hosts) whose health check says nothing, too slow or with no version. */
  quiet: string[];
  /** What the window put on screen, in order: a project view by its id, or Home (`null`). */
  shown: (string | null)[];
  /** Servers by name whose health check does not answer, from now on. */
  silent: string[];
  /**
   * Folders whose server, at its next start, never says where it listens: the start is
   * recorded as a connection, and given up when what waits for it is stopped.
   */
  stalled: string[];
  /** What each local server was started with, in order. */
  starts: ServerOptions[];
  /** What the window was told the app is doing, `null` once it is done. */
  statuses: (ShellStatus | null)[];
  /** What the tab strip was told, in order. */
  tabs: (readonly ShellTab[])[];
  /** A token a server is reached with in place of its own: a remote one reconnected, say. */
  tokens: Record<string, string>;
  /** What was loaded in the projects' pages, in order: the last is the latest. */
  views: View[];
  /** Which project view each of `views` was loaded in. */
  viewsIn: string[];
  /** How many agents each folder's server says wait on the person. */
  waiting: Record<string, number>;
  /** Told when an event or a question is recorded: what `until` waits on. */
  readonly watchers: Set<() => void>;
  /** How many agents each folder's server says are at work. */
  working: Record<string, number>;
}

export const makeRecorded = (): Recorded => ({
  alerts: [],
  answers: [],
  beforeDrop: null,
  declines: [],
  details: [],
  drops: [],
  events: [],
  failed: {},
  focused: true,
  notices: [],
  openings: [],
  pickers: [],
  picks: [],
  processes: {},
  questions: [],
  quiet: [],
  shown: [],
  silent: [],
  stalled: [],
  starts: [],
  statuses: [],
  tabs: [],
  tokens: {},
  views: [],
  viewsIn: [],
  waiting: {},
  watchers: new Set(),
  working: {},
});

const tellWatchers = (recorded: Recorded) => {
  for (const watcher of [...recorded.watchers]) {
    watcher();
  }
};

const recordEvent = (recorded: Recorded, event: string) => {
  recorded.events.push(event);
  tellWatchers(recorded);
};

/** The latest server process of a folder exits: the one running now, not one started later. */
export const exitProcess = (recorded: Recorded, name: string) => {
  const process = recorded.processes[name];
  if (process) {
    process.exited = true;
  }
};

/**
 * Waits until the events and questions recorded are as `seen` says: now, or once a fake records
 * the one that makes them so.
 */
export const until = (
  recorded: Recorded,
  seen: (recorded: Recorded) => boolean
) =>
  Effect.callback<void>((resume) => {
    if (seen(recorded)) {
      resume(Effect.void);
      return;
    }
    const watcher = () => {
      if (seen(recorded)) {
        recorded.watchers.delete(watcher);
        resume(Effect.void);
      }
    };
    recorded.watchers.add(watcher);
    return Effect.sync(() => recorded.watchers.delete(watcher));
  });

export const fakeShell = (recorded: Recorded) =>
  Layer.succeed(
    Shell,
    Shell.of({
      alert: (alert) =>
        Effect.sync(() => {
          recorded.alerts.push(alert);
          tellWatchers(recorded);
        }),
      confirm: ({ cancel, detail, message }) =>
        Effect.suspend(() => {
          recorded.questions.push(message);
          recorded.details.push(detail);
          recorded.declines.push(cancel ?? "Cancel");
          tellWatchers(recorded);
          const answer = recorded.answers.shift() ?? true;
          return typeof answer === "boolean" ? Effect.succeed(answer) : answer;
        }),
      drop: (project) =>
        Effect.andThen(
          recorded.beforeDrop ?? Effect.void,
          Effect.sync(() => recorded.drops.push(project))
        ),
      focused: Effect.sync(() => recorded.focused),
      load: (project, view) =>
        Effect.sync(() => {
          recorded.views.push(view);
          recorded.viewsIn.push(project);
        }),
      notice: (notice) =>
        Effect.sync(() => {
          recorded.notices.push(notice);
          tellWatchers(recorded);
        }),
      opening: (_project, opening) =>
        Effect.sync(() => {
          recorded.openings.push(opening);
          tellWatchers(recorded);
        }),
      openPath: (path) =>
        Effect.sync(() => {
          recordEvent(recorded, `show ${path}`);
          return Option.none();
        }),
      pickFile: (title) =>
        Effect.sync(() => {
          recorded.pickers.push(title);
          return Option.fromNullishOr(recorded.picks.shift());
        }),
      pickFolder: ({ title }) =>
        Effect.sync(() => {
          recorded.pickers.push(title);
          return Option.fromNullishOr(recorded.picks.shift());
        }),
      show: (project) => Effect.sync(() => recorded.shown.push(project)),
      status: (_project, status) =>
        Effect.sync(() => recorded.statuses.push(status)),
      tabs: (tabs) =>
        Effect.sync(() => {
          recorded.tabs.push(tabs);
          tellWatchers(recorded);
        }),
    })
  );

/**
 * The version every fake server runs, but one in a folder (or on a host) named `older`; one named
 * `lagging` takes 1 s (of the test clock) to say it.
 */
export const FAKE_VERSION = "1.0.0";
const versionOf = (recorded: Recorded, name: string) =>
  Effect.suspend((): Effect.Effect<string | undefined> => {
    if (
      recorded.processes[name]?.exited === true ||
      recorded.quiet.includes(name)
    ) {
      return Effect.succeed(undefined);
    }
    if (name.includes("lagging")) {
      return Effect.andThen(
        Effect.sync(() => recordEvent(recorded, `version ${name}`)),
        Effect.as(Effect.sleep("1 second"), FAKE_VERSION)
      );
    }
    return Effect.succeed(name.includes("older") ? "0.9.0" : FAKE_VERSION);
  });

/**
 * The agents the fake server of `name` says it has, as the test set them; one named
 * `…lazyhealth…` takes 2 s to say.
 */
const agentsIn = (recorded: Recorded, name: string) =>
  Effect.andThen(
    name.includes("lazyhealth")
      ? Effect.andThen(
          Effect.sync(() => recordEvent(recorded, `health ${name}`)),
          Effect.sleep("2 seconds")
        )
      : Effect.void,
    Effect.sync(() =>
      recorded.silent.includes(name)
        ? Option.none()
        : Option.some({
            failed: recorded.failed[name] ?? 0,
            waiting: recorded.waiting[name] ?? 0,
            working: recorded.working[name] ?? 0,
          })
    )
  );

/** What a folder's server does as it stops: one named `lingering` takes 1 s. */
const stopOf = (recorded: Recorded, name: string) =>
  Effect.andThen(
    name === "lingering"
      ? Effect.andThen(
          Effect.sync(() => recordEvent(recorded, "stopping lingering")),
          Effect.sleep("1 second")
        )
      : Effect.void,
    Effect.sync(() => recordEvent(recorded, `stop ${name}`))
  );

/**
 * A server per start, at `http://127.0.0.1/<folder name>`, whose stop is recorded; a folder
 * named `broken` does not start, one named `attached` has a server running already, one named
 * `chatty` prints a line as it starts, one named `…slow…` takes 1.2 s (of the test clock) to, one
 * named `…attached…` was running already, one named `lingering` takes 1 s to stop, and one in
 * `stalled` never says where it listens, once.
 */
export const fakeServers = (recorded: Recorded) =>
  Layer.succeed(
    ProjectServer,
    ProjectServer.of({
      start: (options: ServerOptions) =>
        Effect.gen(function* () {
          const name = options.cwd.split("/").at(-1) ?? "";
          if (name === "broken") {
            return yield* new ServerStartError({ message: "it broke" });
          }
          const stalled = recorded.stalled.indexOf(name);
          if (stalled !== -1) {
            recorded.stalled.splice(stalled, 1);
            // Given up from the moment it is told of: a test waits for the connection, then stops it.
            yield* Effect.addFinalizer(() =>
              Effect.sync(() => recordEvent(recorded, `give up ${name}`))
            );
            recordEvent(recorded, `connect ${name}`);
            return yield* Effect.never;
          }
          if (name.includes("slow")) {
            recordEvent(recorded, "wait slow");
            yield* Effect.sleep("1200 millis");
          }
          if (name === "chatty") {
            yield* (yield* OpeningReport).line("pnpm install · 214 packages");
          }
          const attached = name.includes("attached");
          recorded.starts.push(options);
          recordEvent(recorded, `${attached ? "attach" : "start"} ${name}`);
          if (!attached) {
            yield* Effect.addFinalizer(() => stopOf(recorded, name));
          }
          const process = { exited: false };
          recorded.processes[name] = process;
          return {
            agents: agentsIn(recorded, name),
            attached,
            exited: Effect.sync(() => !attached && process.exited),
            get token() {
              return recorded.tokens[name] ?? `token-${name}`;
            },
            url: `http://127.0.0.1/${name}`,
            version: versionOf(recorded, name),
          };
        }),
    })
  );

/**
 * A remote project's server per start, at `http://127.0.0.1/<host>/<folder name>`, recorded as
 * the local fake's are; a host named `down` cannot be reached, and one named `silent` never
 * answers: its connection is recorded, and given up when what waits for it is stopped.
 */
export const fakeRemoteProjects = (recorded: Recorded) =>
  Layer.succeed(
    RemoteProjects,
    RemoteProjects.of({
      start: (project) =>
        Effect.gen(function* () {
          if (project.host === "silent") {
            const name = `${project.host}:${project.path.split("/").at(-1) ?? ""}`;
            yield* Effect.addFinalizer(() =>
              Effect.sync(() => recordEvent(recorded, `give up ${name}`))
            );
            recordEvent(recorded, `connect ${name}`);
            return yield* Effect.never;
          }
          if (project.host === "down" || project.command === "broken") {
            return yield* new ServerStartError({
              message: "down could not be reached",
            });
          }
          const name = `${project.host}:${project.path.split("/").at(-1) ?? ""}`;
          // Connected, as the real one says: the server starts there.
          yield* (yield* OpeningReport).reached("remote");
          recordEvent(recorded, `start ${name}`);
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => recordEvent(recorded, `stop ${name}`))
          );
          return {
            agents: agentsIn(recorded, name),
            attached: false,
            exited: Effect.succeed(false),
            get token() {
              return recorded.tokens[name] ?? `token-${name}`;
            },
            url: `http://127.0.0.1/${project.host}/${project.path.split("/").at(-1) ?? ""}`,
            version: versionOf(recorded, project.host),
          };
        }),
    })
  );
