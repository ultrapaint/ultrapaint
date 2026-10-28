/** Fakes of what the app's services ask of Electron and of the server, for tests. */
import type { ShellStatus } from "@ultrapaint/contracts/shell-bridge";
import { Effect, Layer, Option } from "effect";
import { ServerStartError } from "./errors.ts";
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
  events: string[];
  /** The titles of the pickers opened, in order. */
  pickers: string[];
  /** Paths the next pickers return; cancelled when there are none left. */
  picks: string[];
  questions: string[];
  /** What the window was told the app is doing, `null` once it is done. */
  statuses: (ShellStatus | null)[];
  views: View[];
  /** How many agents each folder's server says are at work. */
  working: Record<string, number>;
}

export const makeRecorded = (): Recorded => ({
  answers: [],
  events: [],
  pickers: [],
  picks: [],
  questions: [],
  statuses: [],
  views: [],
  working: {},
});

export const fakeShell = (recorded: Recorded) =>
  Layer.succeed(
    Shell,
    Shell.of({
      confirm: ({ message }) =>
        Effect.suspend(() => {
          recorded.questions.push(message);
          const answer = recorded.answers.shift() ?? true;
          return typeof answer === "boolean" ? Effect.succeed(answer) : answer;
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
      show: (view) => Effect.sync(() => recorded.views.push(view)),
      status: (status) => Effect.sync(() => recorded.statuses.push(status)),
    })
  );

/**
 * A server per start, at `http://127.0.0.1/<folder name>`, whose stop is recorded; a folder
 * named `broken` does not start, and one named `attached` has a server running already.
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
          const attached = name === "attached";
          recorded.events.push(`${attached ? "attach" : "start"} ${name}`);
          if (!attached) {
            yield* Effect.addFinalizer(() =>
              Effect.sync(() => recorded.events.push(`stop ${name}`))
            );
          }
          return {
            attached,
            token: `token-${name}`,
            url: `http://127.0.0.1/${name}`,
            working: Effect.sync(() => recorded.working[name] ?? 0),
          };
        }),
    })
  );

/**
 * A remote project's server per start, at `http://127.0.0.1/<host>/<folder name>`, recorded as
 * the local fake's are; a host named `down` cannot be reached.
 */
export const fakeRemoteProjects = (recorded: Recorded) =>
  Layer.succeed(
    RemoteProjects,
    RemoteProjects.of({
      start: (project) =>
        Effect.gen(function* () {
          if (project.host === "down") {
            return yield* new ServerStartError({
              message: "down could not be reached",
            });
          }
          const name = `${project.host}:${project.path.split("/").at(-1) ?? ""}`;
          recorded.events.push(`start ${name}`);
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => recorded.events.push(`stop ${name}`))
          );
          return {
            attached: false,
            token: `token-${name}`,
            url: `http://127.0.0.1/${project.host}/${project.path.split("/").at(-1) ?? ""}`,
            working: Effect.sync(() => recorded.working[name] ?? 0),
          };
        }),
    })
  );
