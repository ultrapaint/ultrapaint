/**
 * The run file: `run.json` in the state directory while a server runs there, with its pid, port,
 * URL and token (PLAN-desktop D5). A second start on the same project finds it and attaches to
 * the server already running instead of starting another; the desktop app does the same. A run
 * file whose process is gone, or whose port is answered by another server, is stale and is
 * written over.
 */
import {
  Console,
  Effect,
  FileSystem,
  Layer,
  Option,
  Path,
  Schema,
} from "effect";
import { HttpServer } from "effect/http";
import { makeWriteAtomic } from "./atomic-write.ts";
import { connectHost, ServerConfig } from "./config.ts";
import { Storage } from "./services/storage.ts";

export const RUN_FILE_NAME = "run.json";

/** What the run file and the ready line say: where the server is, and which run it is. */
const RunInfo = Schema.Struct({
  pid: Schema.Int,
  port: Schema.Int,
  token: Schema.String,
  url: Schema.String,
});
type RunInfo = typeof RunInfo.Type;

const RunJson = Schema.fromJsonString(RunInfo);
const decodeRun = Schema.decodeUnknownEffect(RunJson);
const Health = Schema.fromJsonString(
  Schema.Struct({ token: Schema.optional(Schema.String) })
);
const decodeHealth = Schema.decodeUnknownEffect(Health);

/** The run file in a state directory, if there is one that reads. */
export const readRunFile = Effect.fnUntraced(function* (stateDir: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  return yield* fs
    .readFileString(path.join(stateDir, RUN_FILE_NAME))
    .pipe(Effect.flatMap(decodeRun), Effect.option);
});

/**
 * Whether the process is there. Signal 0 checks without sending anything; a process of another
 * user answers that it may not be signalled, which still means it is there.
 */
const processAlive = (pid: number) =>
  Effect.try({
    catch: (error) => (error as { code?: string }).code === "EPERM",
    try: () => process.kill(pid, 0),
  }).pipe(Effect.catch((alive) => Effect.succeed(alive)));

/** Whether the server at `url` answers its health check with this run's token. */
const answersWith = (url: string, token: string) =>
  Effect.tryPromise({
    catch: () => "no answer" as const,
    try: (signal) =>
      fetch(`${url}/api/health`, { signal }).then((response) =>
        response.ok ? response.text() : ""
      ),
  }).pipe(
    Effect.timeout("2 seconds"),
    Effect.flatMap(decodeHealth),
    Effect.map((health) => health.token === token),
    // No answer, another server, or one that does not say its token: not this run.
    Effect.orElseSucceed(() => false)
  );

/**
 * The server running for this state directory, when there is one: its run file is there, its
 * process is alive, and the server on its port says it is that run. Anything else is a run file
 * left behind, and nothing runs.
 */
export const liveRun = Effect.fnUntraced(function* (stateDir: string) {
  const run = yield* readRunFile(stateDir);
  if (Option.isNone(run)) {
    return Option.none<RunInfo>();
  }
  const { pid, token, url } = run.value;
  if (!(yield* processAlive(pid))) {
    return Option.none<RunInfo>();
  }
  return (yield* answersWith(url, token)) ? run : Option.none<RunInfo>();
});

/**
 * Once the server listens: the run file written into the state directory, and taken away when
 * the server stops, if it is still this run's; and the ready line printed when asked for.
 */
export const Announce = Layer.effectDiscard(
  Effect.gen(function* () {
    const { host, readyJson, token } = yield* ServerConfig;
    const storage = yield* Storage;
    const server = yield* HttpServer.HttpServer;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const writeAtomic = makeWriteAtomic(fs, path);
    const { address } = server;
    const port = "port" in address ? address.port : 0;
    const run: RunInfo = {
      pid: process.pid,
      port,
      token,
      url: `http://${connectHost(host)}:${port}`,
    };
    // Asked at the moment of use: saving an unsaved session moves the state directory, and the
    // run file with it.
    const file = Effect.map(storage.stateDir, (dir) =>
      path.join(dir, RUN_FILE_NAME)
    );
    yield* Effect.acquireRelease(
      Effect.flatMap(file, (f) =>
        writeAtomic(f, `${JSON.stringify(run)}\n`).pipe(
          // A state directory that cannot be written costs the attaching, not the server.
          Effect.ignore({ log: true })
        )
      ),
      () =>
        Effect.gen(function* () {
          const dir = yield* storage.stateDir;
          const found = yield* readRunFile(dir);
          // Another run took the directory over since: its file is not ours to remove.
          if (Option.isSome(found) && found.value.token === token) {
            yield* Effect.ignore(fs.remove(path.join(dir, RUN_FILE_NAME)));
          }
        })
    );
    if (readyJson) {
      yield* Console.log(JSON.stringify(run));
    }
  })
);
