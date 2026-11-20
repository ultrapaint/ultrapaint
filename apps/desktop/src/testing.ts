/** Fakes of what the app's services ask of Electron and of the server, for tests. */
import type { Opening } from "@ultrapaint/contracts/opening";
import type { ShellStatus, ShellTab } from "@ultrapaint/contracts/shell-bridge";
import { Effect, Layer, Option } from "effect";
import { ServerStartError } from "./errors.ts";
import { OpeningReport } from "./opening-report.ts";
import { ProjectServer, type ServerOptions } from "./project-server.ts";
import { RemoteProjects } from "./remote-project.ts";
import { Shell, type View } from "./shell.ts";

/** What the fakes saw, in order. */
export interface Recorded {
  /**
   * Answers the next `confirm` questions get; true when there are none left. An effect is an
   * answer given later: `Effect.never` leaves the question on screen.
   */
  answers: (boolean | Effect.Effect<boolean>)[];
  /** What declining each question was called, in order. */
  declines: string[];
  /** What each question said at more length, in order. */
  details: string[];
  /** The projects whose page was let go, in order. */
  drops: string[];
  events: string[];
  /** What each project's page was told of its opening, in order: `null` once none is. */
  openings: (Opening | null)[];
  /** The titles of the pickers opened, in order. */
  pickers: string[];
  /** Paths the next pickers return; cancelled when there are none left. */
  picks: string[];
  questions: string[];
  /** What the window put on screen, in order: a project's page by its id, or Home (`null`). */
  shown: (string | null)[];
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
  /** What was loaded in the projects' pages, in order: the last is the latest. */
  views: View[];
  /** Which project's page each of `views` was loaded in. */
  viewsIn: string[];
  /** Told when an event or a question is recorded: what `until` waits on. */
  readonly watchers: Set<() => void>;
  /** How many agents each folder's server says are at work. */
  working: Record<string, number>;
}

export const makeRecorded = (): Recorded => ({
  answers: [],
  declines: [],
  details: [],
  drops: [],
  events: [],
  openings: [],
  pickers: [],
  picks: [],
  questions: [],
  shown: [],
  stalled: [],
  starts: [],
  statuses: [],
  tabs: [],
  views: [],
  viewsIn: [],
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
      confirm: ({ cancel, detail, message }) =>
        Effect.suspend(() => {
          recorded.questions.push(message);
          recorded.details.push(detail);
          recorded.declines.push(cancel ?? "Cancel");
          tellWatchers(recorded);
          const answer = recorded.answers.shift() ?? true;
          return typeof answer === "boolean" ? Effect.succeed(answer) : answer;
        }),
      drop: (project) => Effect.sync(() => recorded.drops.push(project)),
      load: (project, view) =>
        Effect.sync(() => {
          recorded.views.push(view);
          recorded.viewsIn.push(project);
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

/** The version every fake server runs, but one in a folder (or on a host) named `older`. */
export const FAKE_VERSION = "1.0.0";
const versionOf = (name: string) =>
  Effect.succeed(name.includes("older") ? "0.9.0" : FAKE_VERSION);

/**
 * A server per start, at `http://127.0.0.1/<folder name>`, whose stop is recorded; a folder
 * named `broken` does not start, one named `attached` has a server running already, one named
 * `chatty` prints a line as it starts, one named `slow` takes 1.2 s (of the test clock) to, and
 * one in `stalled` never says where it listens, once.
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
          if (name === "slow") {
            recordEvent(recorded, "wait slow");
            yield* Effect.sleep("1200 millis");
          }
          if (name === "chatty") {
            yield* (yield* OpeningReport).line("pnpm install · 214 packages");
          }
          const attached = name === "attached";
          recorded.starts.push(options);
          recordEvent(recorded, `${attached ? "attach" : "start"} ${name}`);
          if (!attached) {
            yield* Effect.addFinalizer(() =>
              Effect.sync(() => recordEvent(recorded, `stop ${name}`))
            );
          }
          return {
            attached,
            token: `token-${name}`,
            url: `http://127.0.0.1/${name}`,
            version: versionOf(name),
            working: Effect.sync(() => recorded.working[name] ?? 0),
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
          if (project.host === "down") {
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
            attached: false,
            token: `token-${name}`,
            url: `http://127.0.0.1/${project.host}/${project.path.split("/").at(-1) ?? ""}`,
            version: versionOf(project.host),
            working: Effect.sync(() => recorded.working[name] ?? 0),
          };
        }),
    })
  );
