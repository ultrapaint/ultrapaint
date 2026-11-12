/**
 * `ultrapaint mcp` (ADR 0083): the editor's MCP server for an agent outside the editor, over
 * stdio. An agent registers it once and starts it in the folder it works in; the folder says
 * which project, by the configuration found from there upwards, and the relay passes every
 * message to that project's server: the one running, found by its run file, or one this command
 * starts without a window.
 */
import { homedir } from "node:os";
import {
  type Cause,
  Config,
  Effect,
  Fiber,
  FileSystem,
  Logger,
  Option,
  Path,
  Queue,
  Ref,
  Schema,
  Scope,
  Semaphore,
  Stdio,
  Stream,
} from "effect";
import { Command, Flag } from "effect/cli";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import product from "../../../package.json" with { type: "json" };
import {
  errorAnswer,
  type McpTarget,
  makeRelay,
  RelayUnreachable,
} from "./mcp-relay.ts";
import { liveRun } from "./run-file.ts";
import { MCP_PATH } from "./services/mcp/access.ts";
import { resolveStorage } from "./storage-resolve.ts";

/**
 * Where the `ultrapaint` command says how to start the project's server, as it runs it: a JSON
 * array, the program and its arguments. Absent when the server's entry was run directly.
 */
export const SERVE_ENV = "ULTRAPAINT_SERVE";

const Argv = Schema.fromJsonString(Schema.NonEmptyArray(Schema.String));
const Ready = Schema.fromJsonString(Schema.Struct({ url: Schema.String }));
const decodeReady = Schema.decodeUnknownOption(Ready);

const Request = Schema.fromJsonString(
  Schema.Struct({
    id: Schema.optional(
      Schema.Union([Schema.String, Schema.Finite, Schema.Null])
    ),
    method: Schema.optional(Schema.String),
    params: Schema.optional(
      Schema.Struct({ protocolVersion: Schema.optional(Schema.String) })
    ),
  })
);
const decodeRequest = Schema.decodeUnknownOption(Request);

/**
 * In a folder with no project, the command still connects, offering nothing, and says why: an
 * agent registered once starts it in every folder, and a server that failed to start would be
 * reported in each of them.
 */
export const answerWithoutProject = (line: string, cwd: string) => {
  const why = `No Ultrapaint project in ${cwd}: no ultrapaint.config.json there or above. Run \`ultrapaint\` in the repository to set one up, or work in a folder that has one.`;
  const request = decodeRequest(line);
  if (Option.isNone(request)) {
    return errorAnswer(null, "Not a JSON-RPC message", -32_700);
  }
  const { id, method, params } = request.value;
  if (id === undefined) {
    return;
  }
  const result = (value: unknown) =>
    JSON.stringify({ id, jsonrpc: "2.0", result: value });
  switch (method) {
    case "initialize":
      return result({
        capabilities: {},
        instructions: why,
        protocolVersion: params?.protocolVersion ?? "2025-06-18",
        serverInfo: { name: "ultrapaint", version: product.version },
      });
    case "ping":
      return result({});
    case "tools/list":
      return result({ tools: [] });
    case "resources/list":
      return result({ resources: [] });
    case "prompts/list":
      return result({ prompts: [] });
    default:
      return errorAnswer(id, why, -32_601);
  }
};

/**
 * Where the project's server answers MCP: the running one's, by its run file and the token
 * beside it, or, with none running, one started for it. The server is started out of this
 * command's scope, on purpose: it stops when the pipe on its stdin closes, which is when this
 * command goes, unless an editor is still connected to it (`--linger`), as when the desktop app
 * attached to it meanwhile.
 */
const makeLocator = Effect.fnUntraced(function* (
  project: { readonly dir: string; readonly stateDir: string },
  /** How to start the project's server: the program and its arguments, as JSON. */
  serve: Option.Option<string>
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  // The run file is read with these, each time the server is looked for.
  const services = yield* Effect.context<FileSystem.FileSystem | Path.Path>();
  const known = yield* Ref.make(Option.none<McpTarget>());
  const finding = yield* Semaphore.make(1);
  // Never closed: what is started in it outlives this command (see above).
  const outliving = yield* Scope.make();

  const tokenOf = fs
    .readFileString(path.join(project.stateDir, "mcp-token"))
    .pipe(
      Effect.map((text) => text.trim()),
      Effect.filterOrFail((token) => token !== ""),
      Effect.mapError(
        () =>
          new RelayUnreachable({
            message: `The Ultrapaint server for ${project.dir} offers no MCP: it was started with --no-mcp, or is older than ultrapaint mcp.`,
          })
      )
    );

  const start = Effect.gen(function* () {
    const argv = Option.flatMap(serve, Schema.decodeUnknownOption(Argv));
    if (Option.isNone(argv)) {
      return yield* new RelayUnreachable({
        message: `Ultrapaint isn't running for ${project.dir}: open it in Ultrapaint, or run \`ultrapaint\` there.`,
      });
    }
    const [command, ...args] = argv.value;
    yield* Effect.logInfo(`starting Ultrapaint for ${project.dir}`);
    const child = yield* spawner
      .spawn(
        ChildProcess.make(
          command,
          [
            ...args,
            "--port",
            "0",
            "--ready-json",
            "--stop-with-stdin",
            "--linger",
          ],
          { cwd: project.dir, stderr: "inherit" }
        )
      )
      .pipe(Scope.provide(outliving));
    const lines = child.stdout.pipe(Stream.decodeText(), Stream.splitLines);
    const ready = yield* lines.pipe(
      Stream.map((line) => decodeReady(line)),
      Stream.filter(Option.isSome),
      Stream.runHead,
      Effect.timeout("2 minutes"),
      Effect.flatMap(Effect.fromOption)
    );
    return ready.value.url;
  }).pipe(
    Effect.catchTags({
      NoSuchElementError: () =>
        Effect.fail(
          new RelayUnreachable({
            message: `Ultrapaint did not start for ${project.dir}.`,
          })
        ),
      PlatformError: (error) =>
        Effect.fail(
          new RelayUnreachable({
            message: `Ultrapaint could not be started for ${project.dir}: ${error.message}`,
          })
        ),
      TimeoutError: () =>
        Effect.fail(
          new RelayUnreachable({
            message: `Ultrapaint took too long to start for ${project.dir}.`,
          })
        ),
    })
  );

  const find = Effect.gen(function* () {
    const running = yield* liveRun(project.stateDir);
    const url = Option.isSome(running) ? running.value.url : yield* start;
    const target = { token: yield* tokenOf, url: `${url}${MCP_PATH}` };
    yield* Ref.set(known, Option.some(target));
    return target;
  });

  return (again: boolean) =>
    finding
      .withPermits(1)(
        Effect.gen(function* () {
          if (again) {
            yield* Ref.set(known, Option.none());
          }
          const cached = yield* Ref.get(known);
          return Option.isSome(cached) ? cached.value : yield* find;
        })
      )
      .pipe(Effect.provideContext(services));
});

const relayStdio = Effect.fnUntraced(function* (serve: Option.Option<string>) {
  const stdio = yield* Stdio.Stdio;
  const path = yield* Path.Path;
  const cwd = process.cwd();
  const { storage } = yield* resolveStorage({
    config: undefined,
    cwd,
    ephemeral: false,
    home: undefined,
    userHome: process.env.HOME || homedir(),
  });
  const out = yield* Queue.unbounded<string, Cause.Done>();
  const say = (line: string) => Effect.asVoid(Queue.offer(out, line));
  const writing = yield* Stream.fromQueue(out).pipe(
    Stream.map((line) => `${line}\n`),
    Stream.run(stdio.stdout()),
    Effect.forkScoped
  );

  let handle: (line: string) => Effect.Effect<void>;
  if (storage.mode === "file") {
    const locate = yield* makeLocator(
      { dir: path.dirname(storage.configPath), stateDir: storage.stateDir },
      serve
    );
    ({ handle } = yield* makeRelay({ locate, say }));
  } else {
    handle = (line) =>
      Option.match(Option.fromNullishOr(answerWithoutProject(line, cwd)), {
        onNone: () => Effect.void,
        onSome: say,
      });
  }

  yield* stdio.stdin.pipe(
    Stream.decodeText(),
    Stream.splitLines,
    Stream.mapEffect(handle, { concurrency: "unbounded" }),
    Stream.runDrain
  );
  // Every answer written before the command ends.
  yield* Queue.end(out);
  yield* Fiber.join(writing);
});

export const mcpCommand = Command.make(
  "mcp",
  {
    serve: Flag.String("serve").pipe(
      Flag.withDescription(
        "How to start the project's server when none runs, as a JSON array of the program and its arguments; the ultrapaint command gives it"
      ),
      Flag.withFallbackConfig(Config.String(SERVE_ENV)),
      Flag.optional
    ),
  },
  ({ serve }) =>
    relayStdio(serve).pipe(
      Effect.scoped,
      // Stdout is the agent's channel: the logs go to stderr.
      Effect.provideService(Logger.LogToStderr, true),
      // The agent is gone. A server started for it holds this process open through its pipes;
      // ending the process closes them, and that server stops unless an editor is connected.
      Effect.ensuring(Effect.sync(() => process.exit()))
    )
).pipe(
  Command.withDescription(
    "The editor's MCP server over stdio, for an agent outside the editor: register it once, and it serves the project of the folder the agent works in (ADR 0083)"
  )
);
