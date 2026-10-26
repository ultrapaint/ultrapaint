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
 * Runs a command to completion: its output and exit code, a non-zero exit being a value for the
 * caller to read. It is killed when `timeout` passes.
 */
export const runCommand = Effect.fn("runCommand")(function* (
  command: string,
  args: readonly string[],
  options: {
    /** Over the app's own environment. */
    readonly env?: Readonly<Record<string, string>>;
    readonly timeout: Duration.Input;
  }
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const handle = yield* spawner.spawn(
    ChildProcess.make(command, args, {
      ...(options.env && { env: options.env, extendEnv: true }),
      forceKillAfter: "1 second",
      stdin: "ignore",
    })
  );
  const [stdout, stderr, exitCode] = yield* Effect.all(
    [collect(handle.stdout), collect(handle.stderr), handle.exitCode],
    { concurrency: "unbounded" }
  ).pipe(Effect.timeout(options.timeout));
  return { exitCode: Number(exitCode), stderr, stdout } satisfies CommandResult;
}, Effect.scoped);
