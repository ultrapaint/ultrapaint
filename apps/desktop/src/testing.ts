/** Fakes of what the app's services ask of Electron and of the server, for tests. */
import { Effect, Layer, Option } from "effect";
import { ServerStartError } from "./errors.ts";
import { ProjectServer, type ServerOptions } from "./project-server.ts";
import { Shell, type View } from "./shell.ts";

/** What the fakes saw, in order. */
export interface Recorded {
  /** Answers the next `confirm` questions get; true when there are none left. */
  answers: boolean[];
  events: string[];
  /** Folders the next pickers return; cancelled when there are none left. */
  picks: string[];
  questions: string[];
  views: View[];
  /** How many agents each folder's server says are at work. */
  working: Record<string, number>;
}

export const makeRecorded = (): Recorded => ({
  answers: [],
  events: [],
  picks: [],
  questions: [],
  views: [],
  working: {},
});

export const fakeShell = (recorded: Recorded) =>
  Layer.succeed(
    Shell,
    Shell.of({
      confirm: ({ message }) =>
        Effect.sync(() => {
          recorded.questions.push(message);
          return recorded.answers.shift() ?? true;
        }),
      pickFolder: () =>
        Effect.sync(() => Option.fromNullishOr(recorded.picks.shift())),
      show: (view) => Effect.sync(() => recorded.views.push(view)),
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
