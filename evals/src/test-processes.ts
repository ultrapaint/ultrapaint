/**
 * Commands that run nothing, for the tests: each prints what a script says for it, and is kept so
 * a test can say what was run. Stands in for `claude`, `codex` and `cursor-agent`.
 */
import { Effect, Layer, Sink, Stream } from "effect";
import { ChildProcessSpawner } from "effect/process";

/** A command as it was run. */
export interface Ran {
  readonly args: readonly string[];
  readonly command: string;
}

/** A spawner whose every command prints what `print` returns for it, and the commands it ran. */
export const scriptedProcesses = (
  print: (ran: Ran, index: number) => string
) => {
  const ran: Ran[] = [];
  const spawner = ChildProcessSpawner.make((command) =>
    Effect.sync(() => {
      const seen =
        command._tag === "StandardCommand"
          ? { args: command.args, command: command.command }
          : { args: [], command: "a pipeline" };
      ran.push(seen);
      const stdout = Stream.make(
        new TextEncoder().encode(print(seen, ran.length - 1))
      );
      return ChildProcessSpawner.makeHandle({
        all: stdout,
        exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
        getInputFd: () => Sink.drain,
        getOutputFd: () => Stream.empty,
        isRunning: Effect.succeed(false),
        kill: () => Effect.void,
        pid: ChildProcessSpawner.ProcessId(1),
        stderr: Stream.empty,
        stdin: Sink.drain,
        stdout,
        unref: Effect.succeed(Effect.void),
      });
    })
  );
  return {
    layer: Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner),
    ran,
  };
};
