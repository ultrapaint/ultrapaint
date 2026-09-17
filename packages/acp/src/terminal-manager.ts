import { Effect, Exit, Scope, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { TerminalError } from "./errors.ts";

const DEFAULT_OUTPUT_LIMIT = 1024 * 1024;

export interface TerminalExit {
  readonly exitCode: number | null;
  readonly signal: string | null;
}

export interface TerminalOutput {
  readonly exitStatus: TerminalExit | null;
  readonly output: string;
  readonly truncated: boolean;
}

export interface TerminalManager {
  readonly create: (options: {
    readonly args: readonly string[];
    readonly command: string;
    readonly cwd: string;
    readonly env: Record<string, string>;
    readonly outputByteLimit?: number | null | undefined;
  }) => Effect.Effect<string, TerminalError>;
  readonly kill: (id: string) => Effect.Effect<void>;
  readonly output: (id: string) => Effect.Effect<TerminalOutput, TerminalError>;
  /** Kills the command if it is still running and forgets the terminal. */
  readonly release: (id: string) => Effect.Effect<void>;
  readonly waitForExit: (
    id: string
  ) => Effect.Effect<TerminalExit, TerminalError>;
}

interface Terminal {
  readonly exit: Effect.Effect<TerminalExit>;
  exited: TerminalExit | null;
  readonly kill: Effect.Effect<void>;
  output: string;
  readonly scope: Scope.Closeable;
  truncated: boolean;
}

/**
 * Terminals the agent asks the client to run. The caller validates `cwd`. Output is kept up to
 * a byte limit, oldest first out. Every terminal lives in a child of the calling scope, so the
 * commands end with the agent session that started them.
 */
export const makeTerminalManager = Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const parent = yield* Effect.scope;
  const terminals = new Map<string, Terminal>();
  let nextId = 1;

  const find = (id: string) =>
    Effect.suspend(() => {
      const terminal = terminals.get(id);
      return terminal
        ? Effect.succeed(terminal)
        : Effect.fail(new TerminalError({ message: `unknown terminal ${id}` }));
    });

  const create: TerminalManager["create"] = Effect.fn("TerminalManager.create")(
    function* (options) {
      const scope = yield* Scope.fork(parent);
      const handle = yield* spawner
        .spawn(
          ChildProcess.make(options.command, options.args, {
            cwd: options.cwd,
            env: options.env,
            extendEnv: true,
            forceKillAfter: "2 seconds",
            stdin: "ignore",
          })
        )
        .pipe(
          Scope.provide(scope),
          Effect.onError(() => Scope.close(scope, Exit.void)),
          Effect.mapError(
            (error) =>
              new TerminalError({
                message: `could not run ${options.command}: ${error.message}`,
              })
          )
        );
      const limit = options.outputByteLimit ?? DEFAULT_OUTPUT_LIMIT;
      const terminal: Terminal = {
        // A command killed by a signal has no exit code to report.
        exit: handle.exitCode.pipe(
          Effect.map(
            (code): TerminalExit => ({
              exitCode: Number(code),
              signal: null,
            })
          ),
          Effect.orElseSucceed(
            (): TerminalExit => ({
              exitCode: null,
              signal: "SIGTERM",
            })
          ),
          Effect.tap((status) =>
            Effect.sync(() => {
              terminal.exited = status;
            })
          )
        ),
        exited: null,
        kill: Effect.ignore(handle.kill()),
        output: "",
        scope,
        truncated: false,
      };
      yield* handle.all.pipe(
        Stream.decodeText(),
        Stream.runForEach((chunk) =>
          Effect.sync(() => {
            terminal.output += chunk;
            if (terminal.output.length > limit) {
              terminal.output = terminal.output.slice(-limit);
              terminal.truncated = true;
            }
          })
        ),
        Effect.ignore,
        Effect.forkIn(scope)
      );
      // Records the exit status even if the agent never waits for it.
      yield* Effect.forkIn(terminal.exit, scope);
      const id = `term_${nextId}`;
      nextId += 1;
      terminals.set(id, terminal);
      return id;
    }
  );

  const release = (id: string) =>
    Effect.suspend(() => {
      const terminal = terminals.get(id);
      terminals.delete(id);
      return terminal ? Scope.close(terminal.scope, Exit.void) : Effect.void;
    });

  return {
    create,
    kill: (id) => Effect.suspend(() => terminals.get(id)?.kill ?? Effect.void),
    output: (id) =>
      Effect.map(find(id), (t) => ({
        exitStatus: t.exited,
        output: t.output,
        truncated: t.truncated,
      })),
    release,
    waitForExit: (id) => Effect.flatMap(find(id), (t) => t.exit),
  } satisfies TerminalManager;
});
