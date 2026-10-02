import { type Duration, Effect, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

export interface CommandResult {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}

const collect = <E>(stream: Stream.Stream<Uint8Array, E>) =>
  Stream.mkString(Stream.decodeText(stream));

/**
 * Runs a command to completion and returns its output and exit code. A non-zero exit is a
 * value, not a failure; callers decide what it means. The process is killed if the calling
 * fiber is interrupted or `timeout` elapses.
 */
export const runCommand = Effect.fn("runCommand")(function* (
  command: string,
  args: readonly string[],
  options: {
    readonly cwd: string;
    readonly shell?: boolean;
    readonly timeout?: Duration.Input;
  }
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const handle = yield* spawner.spawn(
    ChildProcess.make(command, args, {
      cwd: options.cwd,
      forceKillAfter: "1 second",
      shell: options.shell ?? false,
      stdin: "ignore",
    })
  );
  const run = Effect.all(
    [collect(handle.stdout), collect(handle.stderr), handle.exitCode],
    { concurrency: "unbounded" }
  );
  const [stdout, stderr, exitCode] = yield* options.timeout
    ? Effect.timeout(run, options.timeout)
    : run;
  return { exitCode: Number(exitCode), stderr, stdout } satisfies CommandResult;
}, Effect.scoped);
