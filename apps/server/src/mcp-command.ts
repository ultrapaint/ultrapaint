/**
 * `ultrapaint mcp` (ADR 0083): the editor's MCP server for an agent outside the editor, over
 * stdio. An agent registers it once, directly or through a hub that shares one for all its
 * agents. Each call names the folder its agent works in (`cwd`, an argument the relay adds to
 * every tool), and the folder says which project, by the configuration found from there upwards;
 * a call without one is for the folder the command was started in. A link among a call's
 * arguments names another project (the editor's links name their project's folder), and the
 * calls from the same folder after it go there too. The relay passes every message to that
 * project's server: the one running, found by its run file, or one this command starts without a
 * window.
 */
import { homedir } from "node:os";
import { userFolderLocationFile } from "@ultrapaint/contracts/user-folder";
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
import { McpProtocol } from "effect/ai";
import { Command, Flag } from "effect/cli";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import product from "../../../package.json" with { type: "json" };
import {
  errorAnswer,
  FOLDER_ARG,
  folderOf,
  type KeptTools,
  linkedProject,
  type McpTarget,
  makeRelay,
  type RelayMessage,
  RelayNoProject,
  RelayUnreachable,
  type Way,
  withFolder,
} from "./mcp-relay.ts";
import { liveRun } from "./run-file.ts";
import { MCP_PATH } from "./services/mcp/access.ts";
import { decodeKeptTools, KEPT_TOOLS_FILE } from "./services/mcp/kept-tools.ts";
import {
  MCP_INSTRUCTIONS,
  MCP_PROTOCOLS,
  MCP_SERVER_INFO,
} from "./services/mcp/route.ts";
import { resolveStorage, userDirFlag } from "./storage-resolve.ts";

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

/** The revisions a server agrees at `initialize`: the stateless one has none. */
const SESSION_REVISIONS = MCP_PROTOCOLS.filter(
  (protocol) => protocol.runtime._tag === "Stateful"
).map((protocol) => protocol.protocolVersion);

/**
 * What the project's server says it can do at `initialize`, as it says it: the relay's own answer
 * is held to the server's by a test (`mcp-relay.test.ts`).
 */
const SERVER_CAPABILITIES = {
  completions: {},
  logging: {},
  prompts: { listChanged: true },
  resources: { listChanged: true, subscribe: false },
  tools: { listChanged: true },
};

/**
 * The relay's own answer to `initialize` in a project's folder (ADR 0164), as that project's
 * server gives it: the revision it would agree, what it can do, and its instructions, the kept
 * ones when a server left them.
 */
export const answerInitialize = (
  line: string,
  /** What a server said at `initialize` last, kept beside its tools; the build's own before. */
  instructions: string | undefined
) => {
  const request = Option.getOrUndefined(decodeRequest(line));
  const offered = request?.params?.protocolVersion;
  const agreed =
    SESSION_REVISIONS.find((revision) => revision === offered) ??
    SESSION_REVISIONS[0];
  const { description, ...named } = MCP_SERVER_INFO;
  return JSON.stringify({
    id: request?.id ?? null,
    jsonrpc: "2.0",
    result: {
      capabilities: SERVER_CAPABILITIES,
      instructions: instructions ?? MCP_INSTRUCTIONS,
      protocolVersion: agreed,
      // 2025-06-18 has no description for a server.
      serverInfo:
        agreed === McpProtocol.v2025_06_18.protocolVersion
          ? named
          : MCP_SERVER_INFO,
    },
  });
};

/**
 * With no project to send it to (a folder with none, and no link naming one yet), a message is
 * answered here: the command connects all the same, and says why, since an agent registered once
 * starts it in every folder. It offers the tools a project's server last listed, so that a link
 * pasted in the chat (which names its project) can be used from here too.
 */
export const answerWithoutProject = (
  line: string,
  why: string,
  /** The tools a server listed last, kept in the user's directory; nothing before any did. */
  tools: KeptTools | undefined
) => {
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
        capabilities: tools === undefined ? {} : { tools: {} },
        instructions: why,
        protocolVersion: params?.protocolVersion ?? "2025-06-18",
        serverInfo: { name: "ultrapaint", version: product.version },
      });
    case "ping":
      return result({});
    case "tools/list":
      return result(withFolder({ tools: tools?.tools ?? [] }));
    case "resources/list":
      return result({ resources: [] });
    case "prompts/list":
      return result({ prompts: [] });
    default:
      return errorAnswer(id, why, -32_601);
  }
};

/**
 * Where a server this command starts writes its log, in the project's state directory: not this
 * command's stderr, which over SSH is the session's, and which a server outliving the command (an
 * editor connected to it) would hold open, and the agent's session with it.
 */
const SERVER_LOG = "mcp-server.log";

/**
 * Where the project's server answers MCP: the running one's, by its run file and the token
 * beside it, or, with none running, one started for it. The server is started out of this
 * command's scope, on purpose: it stops when the pipe on its stdin closes, which is when this
 * command goes, unless an editor is still connected to it (`--linger`), as when the desktop app
 * attached to it meanwhile.
 */
export const makeLocator = Effect.fnUntraced(function* (
  project: { readonly dir: string; readonly stateDir: string },
  /** How to start the project's server: the program and its arguments, as JSON. */
  serve: Option.Option<string>,
  /** `--user-dir` as this command was given it, absolute: the server started is given it too. */
  userDir?: string
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

  const serverLog = path.join(project.stateDir, SERVER_LOG);
  /** The last lines a server that did not start wrote, to say why. */
  const logTail = fs.readFileString(serverLog).pipe(
    Effect.map((text) => {
      const last = text.trim().split("\n").slice(-5).join("\n");
      return last === "" ? "" : ` Its log (${serverLog}) ends:\n${last}`;
    }),
    Effect.orElseSucceed(() => "")
  );

  const start = Effect.gen(function* () {
    const argv = Option.flatMap(serve, Schema.decodeUnknownOption(Argv));
    if (Option.isNone(argv)) {
      return yield* new RelayUnreachable({
        message: `Ultrapaint isn't running for ${project.dir}: open it in Ultrapaint, or run \`ultrapaint\` there.`,
      });
    }
    const [command, ...args] = argv.value;
    const server = [
      command,
      ...args,
      "--port",
      "0",
      "--ready-json",
      "--stop-with-stdin",
      "--linger",
      ...(userDir === undefined ? [] : ["--user-dir", userDir]),
    ];
    yield* Effect.logInfo(`starting Ultrapaint for ${project.dir}`);
    yield* fs.makeDirectory(project.stateDir, { recursive: true });
    // The shell sends the server's log to its file and becomes the server (`exec`): the
    // process this command holds is the server's.
    const child = yield* spawner
      .spawn(
        process.platform === "win32"
          ? ChildProcess.make(command, server.slice(1), {
              cwd: project.dir,
              stderr: "inherit",
            })
          : ChildProcess.make(
              "/bin/sh",
              ["-c", 'exec "$@" 2>"$0"', serverLog, ...server],
              { cwd: project.dir, stderr: "ignore" }
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
        Effect.flatMap(logTail, (tail) =>
          Effect.fail(
            new RelayUnreachable({
              message: `Ultrapaint did not start for ${project.dir}.${tail}`,
            })
          )
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

  const way: Way = {
    reach: (again) =>
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
        .pipe(Effect.provideContext(services)),
    // Read anew, and not behind a start in progress, which takes as long as the start does.
    running: Effect.gen(function* () {
      const run = yield* liveRun(project.stateDir);
      if (Option.isNone(run)) {
        return Option.none<McpTarget>();
      }
      return Option.some({
        token: yield* tokenOf,
        url: `${run.value.url}${MCP_PATH}`,
      });
    }).pipe(Effect.provideContext(services)),
  };
  return way;
});

/**
 * Which project a message is for, by its project's folder (ADR 0083): the one a link among its
 * arguments names, else the one a link from the same folder named last, else the one found from
 * the folder its agent works in upwards. The folder is the one the call names (`cwd`), or the
 * one the command was started in. A link is remembered for its folder alone: two agents sharing
 * the command through a hub, in two folders, do not turn each other's calls.
 */
export const makeRouting = <R>(options: {
  /** The folder the command was started in: an agent's, or a hub's. */
  readonly started: string;
  readonly isAbsolute: (folder: string) => boolean;
  /** The folder of the project whose configuration is found from `folder` upwards. */
  readonly projectAt: (
    folder: string
  ) => Effect.Effect<Option.Option<string>, never, R>;
}) => {
  const linked = new Map<string, string>();
  return Effect.fnUntraced(function* (message: RelayMessage) {
    const named = folderOf(message);
    if (named !== undefined && !options.isAbsolute(named)) {
      return yield* new RelayNoProject({
        message: `${FOLDER_ARG} is "${named}": give the absolute path of your working directory.`,
      });
    }
    const from = named ?? options.started;
    const link = linkedProject(message);
    if (link) {
      linked.set(from, link);
    }
    const dir =
      linked.get(from) ?? Option.getOrUndefined(yield* options.projectAt(from));
    if (dir === undefined) {
      return yield* new RelayNoProject({
        message: `No Ultrapaint project in ${from}: no ultrapaint.config.json there or above. Give each tool your working directory as ${FOLDER_ARG}, a project's folder or one inside it, or paste the link of an Ultrapaint page or node (Copy link in the editor) to work on its project.`,
      });
    }
    return dir;
  });
};

const relayStdio = Effect.fnUntraced(function* (
  serve: Option.Option<string>,
  /** `--user-dir`: where the person's folder is, which keeps the tools a server listed last. */
  userDirIn: Option.Option<string>
) {
  const stdio = yield* Stdio.Stdio;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const cwd = process.cwd();
  const userHome = process.env.HOME || homedir();
  // From where the command was started, not from each project's folder.
  const userDirGiven = Option.getOrUndefined(
    Option.map(userDirIn, (given) => path.resolve(cwd, given))
  );
  /** The project whose configuration is found from `dir` upwards: its folder and state. */
  const projectAt = (dir: string) =>
    Effect.map(
      resolveStorage({
        config: undefined,
        cwd: dir,
        ephemeral: false,
        home: undefined,
        userDir: userDirGiven,
        // Moved by the desktop app, the folder is found where the app recorded it (ADR 0091).
        userFolderLocation: userFolderLocationFile({
          env: process.env,
          home: userHome,
          platform: process.platform,
        }),
        userHome,
      }),
      ({ storage, userDir }) => ({
        project:
          storage.mode === "file"
            ? Option.some({
                dir: path.dirname(storage.configPath),
                stateDir: storage.stateDir,
              })
            : Option.none(),
        userDir,
      })
    );
  const here = yield* projectAt(cwd);
  const toolsFile = path.join(here.userDir, KEPT_TOOLS_FILE);

  const out = yield* Queue.unbounded<string, Cause.Done>();
  const say = (line: string) => Effect.asVoid(Queue.offer(out, line));
  const writing = yield* Stream.fromQueue(out).pipe(
    Stream.map((line) => `${line}\n`),
    Stream.run(stdio.stdout()),
    Effect.forkScoped
  );

  const routing = makeRouting({
    isAbsolute: path.isAbsolute,
    projectAt: (folder) =>
      projectAt(folder).pipe(
        Effect.map(({ project }) => Option.map(project, (p) => p.dir)),
        // A folder that cannot be read has no project to offer.
        Effect.orElseSucceed(() => Option.none<string>())
      ),
    started: cwd,
  });
  /** Each project's way to its server, made once. */
  const locators = new Map<string, Way>();
  const making = yield* Semaphore.make(1);
  const locatorFor = (dir: string) =>
    making.withPermits(1)(
      Effect.gen(function* () {
        const known = locators.get(dir);
        if (known) {
          return known;
        }
        const found = yield* projectAt(dir);
        if (Option.isNone(found.project)) {
          return yield* new RelayNoProject({
            message: `No Ultrapaint configuration in ${dir}: in Ultrapaint, Settings › Repository › Save to file… writes it there.`,
          });
        }
        const locate = yield* makeLocator(
          found.project.value,
          serve,
          userDirGiven
        );
        locators.set(dir, locate);
        return locate;
      })
    );

  // What the servers are found and started with, each time a message is located.
  const services = yield* Effect.context<
    ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | Path.Path
  >();
  const locate = (message: RelayMessage) =>
    Effect.flatMap(routing(message), locatorFor).pipe(
      Effect.provideContext(services)
    );

  const keptTools = fs.readFileString(toolsFile).pipe(
    Effect.map((text) => Option.getOrUndefined(decodeKeptTools(text))),
    Effect.orElseSucceed(() => undefined)
  );
  const { handle } = yield* makeRelay({
    answerInitialize: (text) =>
      Effect.map(keptTools, (kept) =>
        answerInitialize(text, kept?.instructions)
      ),
    keptTools,
    locate,
    say,
    toolsListed: (listed) =>
      Effect.gen(function* () {
        // A server the relay did not say `initialize` to (a stateless agent's) said no
        // instructions: the kept ones stay.
        const instructions =
          listed.instructions ?? (yield* keptTools)?.instructions;
        const kept: KeptTools = { ...listed, instructions };
        yield* fs.makeDirectory(here.userDir, { recursive: true });
        yield* fs.writeFileString(toolsFile, `${JSON.stringify(kept)}\n`);
      }).pipe(
        // A list not kept is only a list the next folder without a project goes without.
        Effect.ignore
      ),
    withoutProject: (text, why) =>
      Effect.map(keptTools, (tools) => answerWithoutProject(text, why, tools)),
  });

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
    userDir: userDirFlag,
  },
  ({ serve, userDir }) =>
    relayStdio(serve, userDir).pipe(
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
