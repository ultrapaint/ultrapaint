import { Effect, Exit, Fiber, Random, Scope, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { KILL_AFTER } from "./acp-agent.ts";
import { TerminalError } from "./errors.ts";
import { type AgentLaunch, agentEnv } from "./sandbox.ts";

const DEFAULT_OUTPUT_LIMIT = 1024 * 1024;

interface TerminalExit {
  readonly exitCode: number | null;
  readonly signal: string | null;
}

interface TerminalOutput {
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
  /**
   * Completes once the command's output has all been taken in. Exiting and being read are two
   * different fibers, and a process can exit with bytes still in the pipe.
   */
  drained: Effect.Effect<void>;
  readonly exit: Effect.Effect<TerminalExit>;
  exited: TerminalExit | null;
  readonly kill: Effect.Effect<void>;
  output: string;
  readonly scope: Scope.Closeable;
  truncated: boolean;
}

/**
 * Terminals the agent asks the client to run. The caller validates `cwd` and passes `confine`,
 * which puts the command in the same sandbox as the agent's own process: a command we run on
 * the agent's behalf must not reach further than one it runs itself. Output is kept up to a byte
 * limit, oldest first out. Every terminal lives in a child of the calling scope, so the commands
 * end with the agent session that started them.
 */
export const makeTerminalManager = (options: {
  /** Puts a command the agent asked us to run in the same sandbox as the agent itself. */
  readonly confine?: (launch: AgentLaunch) => AgentLaunch;
  /** What a command starts from, under the variables the agent asked for: the server's. */
  readonly env: Readonly<Record<string, string>>;
  /** Every chunk as it arrives, so the editor can follow a command while it runs. */
  readonly onOutput?: (id: string, chunk: string) => Effect.Effect<void>;
}) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const parent = yield* Effect.scope;
    const confine = options.confine ?? ((launch: AgentLaunch) => launch);
    const { onOutput } = options;
    const terminals = new Map<string, Terminal>();
    /*
     * Every session numbers its terminals from 1, and the editor keeps output by id for as long
     * as the page is open: across threads, and across a thread's restarted sessions. The salt
     * keeps one session's `term_1` from being mistaken for another's.
     */
    const salt = (yield* Random.nextIntBetween(0, 36 ** 5))
      .toString(36)
      .padStart(5, "0");
    let nextId = 1;

    const find = (id: string) =>
      Effect.suspend(() => {
        const terminal = terminals.get(id);
        return terminal
          ? Effect.succeed(terminal)
          : Effect.fail(
              new TerminalError({ message: `unknown terminal ${id}` })
            );
      });

    const create: TerminalManager["create"] = Effect.fn(
      "TerminalManager.create"
    )(function* (request) {
      const scope = yield* Scope.fork(parent);
      const id = `term_${salt}_${nextId}`;
      nextId += 1;
      const launch = confine({
        args: request.args,
        command: request.command,
        env: agentEnv(request.env),
      });
      const handle = yield* spawner
        .spawn(
          ChildProcess.make(launch.command, launch.args, {
            cwd: request.cwd,
            env: { ...options.env, ...launch.env },
            extendEnv: false,
            forceKillAfter: KILL_AFTER,
            stdin: "ignore",
          })
        )
        .pipe(
          Scope.provide(scope),
          Effect.onError(() => Scope.close(scope, Exit.void)),
          Effect.mapError(
            (error) =>
              new TerminalError({
                message: `could not run ${request.command}: ${error.message}`,
              })
          )
        );
      const limit = request.outputByteLimit ?? DEFAULT_OUTPUT_LIMIT;
      const terminal: Terminal = {
        drained: Effect.void,
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
      const pump = yield* handle.all.pipe(
        Stream.decodeText(),
        Stream.runForEach((chunk) =>
          Effect.andThen(
            Effect.sync(() => {
              terminal.output += chunk;
              if (terminal.output.length > limit) {
                terminal.output = terminal.output.slice(-limit);
                terminal.truncated = true;
              }
            }),
            // The editor follows the command while it runs; the agent reads the output later.
            onOutput ? onOutput(id, chunk) : Effect.void
          )
        ),
        Effect.ignore,
        Effect.forkIn(scope)
      );
      /*
       * Bounded, because the stream ends when the pipes close and a grandchild the command left
       * behind can hold them open for as long as it likes. The exit status is the answer that
       * must not be late; the output is as complete as it can honestly be made.
       */
      terminal.drained = Fiber.join(pump).pipe(
        Effect.timeoutOption("2 seconds"),
        Effect.ignore
      );
      // Records the exit status even if the agent never waits for it.
      yield* Effect.forkIn(terminal.exit, scope);
      terminals.set(id, terminal);
      return id;
    });

    const release = (id: string) =>
      Effect.suspend(() => {
        const terminal = terminals.get(id);
        terminals.delete(id);
        return terminal ? Scope.close(terminal.scope, Exit.void) : Effect.void;
      });

    return {
      create,
      kill: (id) =>
        Effect.suspend(() => terminals.get(id)?.kill ?? Effect.void),
      output: (id) =>
        Effect.map(find(id), (t) => ({
          exitStatus: t.exited,
          output: t.output,
          truncated: t.truncated,
        })),
      release,
      // The output is read straight after this, so the bytes have to be in before it returns.
      waitForExit: (id) =>
        Effect.flatMap(find(id), (t) => Effect.tap(t.exit, () => t.drained)),
    } satisfies TerminalManager;
  });
