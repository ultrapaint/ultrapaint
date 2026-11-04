/**
 * Ultrapaint as a user runs it: the `ultrapaint` command from the checkout, in a host project
 * (`hosts/<name>`, made with `ultrapaint new`), reached through its public surfaces only: the
 * editor's RPC for threads and pages, its MCP server for pictures. Nothing here imports the
 * server's code, so the evals keep working while its insides move, and they measure what ships.
 */
import path from "node:path";
import { UltrapaintRpcs } from "@ultrapaint/contracts/rpc";
import type { Thread, ThreadItem } from "@ultrapaint/contracts/threads";
import {
  Deferred,
  Duration,
  Effect,
  FileSystem,
  Layer,
  Option,
  Schema,
  type Scope,
  Stream,
} from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { RpcClient, RpcSerialization } from "effect/rpc";
import { Socket } from "effect/socket";
import { Browser } from "./browser.ts";
import { EvalsConfig } from "./config.ts";
import { EvalsError } from "./errors.ts";
import { readJson, writeJson } from "./layout.ts";

/** Where the preview keeps what it generates inside the designs directory. */
const PREVIEW_FILES = ".ultrapaint";
/**
 * The designs directory a round works in, beside the host's own: emptied before every run and
 * filled from the host's, so each run starts from the host as it was committed. At the same depth
 * as the host's own, so the stylesheet paths of its configuration still lead to the same files.
 */
const SCRATCH_DESIGNS = ".eval-designs";
const CONFIG_FILE = "ultrapaint.config.json";
/** What Ultrapaint rewrites at the host's root when a run changes the design system. */
const HOST_FILES = ["DESIGN.md"] as const;

/** The host's configuration, kept whole: only where its designs go is changed. */
const HostConfig = Schema.Record(Schema.String, Schema.Unknown);

const Ready = Schema.Struct({
  attached: Schema.optional(Schema.Boolean),
  port: Schema.Number,
  url: Schema.String,
});
const decodeReady = Schema.decodeUnknownOption(Schema.fromJsonString(Ready));

const makeClient = RpcClient.make(UltrapaintRpcs);
export type UltrapaintClient = Effect.Success<typeof makeClient>;

export interface ToolResult {
  readonly images: readonly Uint8Array[];
  readonly isError: boolean;
  readonly text: string;
}

export interface UltrapaintSession {
  readonly client: UltrapaintClient;
  /** Absolute path of the designs directory the server works in. */
  readonly designs: string;
  /**
   * Files outside the designs directory that Ultrapaint writes as the design system changes
   * (`DESIGN.md`), as they were when the server started, `null` for one that was absent: put
   * back before every run and when the session ends, so no round sees another's.
   */
  readonly hostFiles: Readonly<Record<string, string | null>>;
  /** Absolute path of the host project. */
  readonly root: string;
  /** Absolute path of the host's own designs directory: what a run starts from. */
  readonly seed: string;
  /** Calls a tool of the editor's MCP server, as an agent outside the editor would. */
  readonly tool: (
    name: string,
    args: Record<string, unknown>
  ) => Effect.Effect<ToolResult, EvalsError>;
  readonly url: string;
}

/** An RPC that failed, said with what was being done. */
export const rpc = <A, E, R>(what: string, effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.mapError(
      (cause) => new EvalsError({ message: `${what}: ${String(cause)}` })
    )
  );

/** A JSON-RPC message from the MCP server: a reply carries the id of the request it answers. */
const McpMessage = Schema.Struct({
  error: Schema.optional(Schema.Unknown),
  id: Schema.optional(Schema.Unknown),
  result: Schema.optional(Schema.Unknown),
});
const decodeMessage = Schema.decodeUnknownEffect(
  Schema.fromJsonString(McpMessage)
);
const RpcError = Schema.Struct({ message: Schema.String });
const Initialized = Schema.Struct({ protocolVersion: Schema.String });
const ToolCallResult = Schema.Struct({
  content: Schema.optional(
    Schema.Array(
      Schema.Struct({
        data: Schema.optional(Schema.String),
        text: Schema.optional(Schema.String),
        type: Schema.String,
      })
    )
  ),
  isError: Schema.optional(Schema.Unknown),
});

/** A minimal MCP client over Streamable HTTP: initialize once, then call tools. */
const connectMcp = Effect.fn("connectMcp")(function* (connection: {
  readonly header: string;
  readonly token: string;
  readonly url: string;
}) {
  let session: string | undefined;
  let version = "2025-06-18";
  let nextId = 1;

  /** The result of a request, none for a notification; the server's error as a failure. */
  const post = Effect.fnUntraced(function* (
    body: { readonly id?: number; readonly method: string } & Record<
      string,
      unknown
    >
  ) {
    const notAnswered = (cause: unknown) =>
      new EvalsError({
        message: `the editor's MCP server did not answer ${body.method}: ${String(cause)}`,
      });
    const response = yield* Effect.tryPromise({
      catch: notAnswered,
      try: () =>
        fetch(connection.url, {
          body: JSON.stringify({ jsonrpc: "2.0", ...body }),
          headers: {
            accept: "application/json, text/event-stream",
            "content-type": "application/json",
            "mcp-protocol-version": version,
            [connection.header]: connection.token,
            ...(session !== undefined && { "mcp-session-id": session }),
          },
          method: "POST",
        }),
    });
    session = response.headers.get("mcp-session-id") ?? session;
    const text = yield* Effect.tryPromise({
      catch: notAnswered,
      try: () => response.text(),
    });
    if (body.id === undefined || text.trim() === "") {
      return;
    }
    // A reply comes as JSON, or as the data of a server-sent event.
    const messages = yield* Effect.forEach(
      response.headers.get("content-type")?.includes("text/event-stream")
        ? text
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5))
        : [text],
      (message) => decodeMessage(message).pipe(Effect.mapError(notAnswered))
    );
    const reply = messages.find((m) => m.id === body.id);
    if (reply?.error !== undefined) {
      const said = Schema.decodeUnknownOption(RpcError)(reply.error);
      return yield* notAnswered(
        Option.isSome(said) ? said.value.message : JSON.stringify(reply.error)
      );
    }
    return reply?.result;
  });

  const initialized = yield* post({
    id: nextId,
    method: "initialize",
    params: {
      capabilities: {},
      clientInfo: { name: "ultrapaint-design-evals", version: "0" },
      protocolVersion: version,
    },
  });
  const agreed = Schema.decodeUnknownOption(Initialized)(initialized);
  if (Option.isSome(agreed)) {
    version = agreed.value.protocolVersion;
  }
  nextId += 1;
  yield* post({ method: "notifications/initialized" });

  return Effect.fn("UltrapaintSession.tool")(function* (
    name: string,
    args: Record<string, unknown>
  ) {
    nextId += 1;
    const answer = yield* post({
      id: nextId,
      method: "tools/call",
      params: { arguments: args, name },
    });
    const result = yield* Schema.decodeUnknownEffect(ToolCallResult)(
      answer ?? {}
    ).pipe(
      Effect.mapError(
        (cause) =>
          new EvalsError({
            message: `${name} answered something else than a tool's result: ${String(cause)}`,
          })
      )
    );
    const content = result.content ?? [];
    return {
      images: content
        .filter((c) => c.type === "image" && c.data)
        .map((c) => new Uint8Array(Buffer.from(c.data ?? "", "base64"))),
      isError: result.isError === true,
      text: content
        .filter((c) => c.type === "text")
        .map((c) => c.text ?? "")
        .join("\n"),
    } satisfies ToolResult;
  });
});

/**
 * Starts Ultrapaint in a host project and holds it, its editor in the browser and its
 * connections until the scope closes. A round works in a scratch designs directory; setting the
 * host up (its design system's import) works in the host's own.
 */
export const launch = Effect.fn("launch")(function* (
  /** A host under `hosts/` by name, or the absolute path of a copy of one. */
  host: string,
  designsIn: "scratch" | "own"
) {
  const { checkout, data, skillsBriefing: briefing } = yield* EvalsConfig;
  const fs = yield* FileSystem.FileSystem;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const browser = yield* Browser;

  const root = path.isAbsolute(host) ? host : data.hostDir(host);
  const own = yield* readJson(HostConfig, path.join(root, CONFIG_FILE));
  const ownDir =
    typeof own.designsDir === "string" ? own.designsDir : "designs";
  const designsDir =
    designsIn === "own"
      ? ownDir
      : path.join(path.dirname(ownDir), SCRATCH_DESIGNS);
  const designs = path.join(root, designsDir);
  yield* fs.makeDirectory(designs, { recursive: true });

  // A copy's configuration and log are kept by its path, so two copies never share them.
  const work = path.join(
    data.work,
    path.isAbsolute(host)
      ? path.relative(data.work, host).replaceAll("/", "_")
      : host
  );
  const config = path.join(work, CONFIG_FILE);
  // How the skills are told, when a round tries another way.
  const skills = {
    ...(typeof own.skills === "object" && own.skills),
    ...(briefing !== undefined && { briefing }),
  };
  yield* writeJson(config, {
    ...own,
    designsDir,
    repoPath: root,
    ...(Object.keys(skills).length > 0 && { skills }),
  });

  // The server's log is kept beside its configuration, for when a round goes wrong.
  const log = path.join(work, "server.log");
  yield* fs.writeFileString(log, "");
  const append = (line: string) =>
    fs.writeFileString(log, `${line}\n`, { flag: "a" }).pipe(Effect.ignore);

  const child = yield* spawner
    .spawn(
      ChildProcess.make(
        process.execPath,
        [
          path.join(checkout, "scripts/cli.ts"),
          "--config",
          config,
          "--port",
          "0",
          "--ready-json",
          "--no-open",
          "--ephemeral",
        ],
        { cwd: root, forceKillAfter: "5 seconds", stdin: "ignore" }
      )
    )
    .pipe(
      Effect.mapError(
        (cause) =>
          new EvalsError({ message: `Ultrapaint did not start: ${cause}` })
      )
    );

  const ready = yield* Deferred.make<typeof Ready.Type>();
  // Both streams are read to the end, or a full pipe would stall the server.
  yield* child.stdout.pipe(
    Stream.decodeText(),
    Stream.splitLines,
    Stream.runForEach((line) => {
      const parsed = decodeReady(line);
      return parsed._tag === "Some"
        ? Deferred.succeed(ready, parsed.value)
        : append(line);
    }),
    Effect.ignore,
    Effect.forkScoped
  );
  yield* child.stderr.pipe(
    Stream.decodeText(),
    Stream.splitLines,
    Stream.runForEach(append),
    Effect.ignore,
    Effect.forkScoped
  );
  const server = yield* Deferred.await(ready).pipe(
    Effect.timeout("5 minutes"),
    Effect.mapError(
      () =>
        new EvalsError({
          message: `Ultrapaint did not say it was ready; see ${log}`,
        })
    )
  );
  if (server.attached) {
    yield* Effect.logWarning(
      `a server was already running for ${config}; using it`
    );
  }

  const protocol = RpcClient.layerProtocolSocket().pipe(
    Layer.provide(Socket.layerWebSocket(`ws://127.0.0.1:${server.port}/ws`)),
    Layer.provide(Socket.layerWebSocketConstructorGlobal),
    Layer.provide(RpcSerialization.layerJson)
  );
  const client = yield* makeClient.pipe(
    Effect.provide(yield* Layer.build(protocol))
  );

  yield* browser.hold(server.url);

  const connection = yield* rpc(
    "asking for the MCP connection",
    client["mcp.connection"]()
  );
  const tool = yield* connectMcp(connection);
  yield* Effect.log(`Ultrapaint is running at ${server.url}`);
  const hostFiles: Record<string, string | null> = {};
  for (const file of HOST_FILES) {
    const at = path.join(root, file);
    hostFiles[at] = (yield* fs.exists(at))
      ? yield* fs.readFileString(at)
      : null;
  }
  // The next round starts its own session and takes the host files as it finds them. Working in
  // the host's own directory (its setup, an extraction's copy), what the agent wrote is the result.
  if (designsIn !== "own") {
    yield* Effect.addFinalizer(() =>
      restoreHostFiles(hostFiles).pipe(Effect.ignore)
    );
  }
  return {
    client,
    designs,
    hostFiles,
    root,
    seed: path.join(root, ownDir),
    tool,
    url: server.url,
  } satisfies UltrapaintSession;
});

/** Writes the host files back as the session found them, removing one that was not there. */
const restoreHostFiles = Effect.fnUntraced(function* (
  hostFiles: Readonly<Record<string, string | null>>
) {
  const fs = yield* FileSystem.FileSystem;
  for (const [file, text] of Object.entries(hostFiles)) {
    yield* text === null
      ? fs.remove(file, { force: true })
      : fs.writeFileString(file, text);
  }
});

/**
 * Puts the scratch designs directory back to the host's own: emptied but for the preview's own
 * files, which it needs to keep drawing, then filled with what the host's holds (its design
 * system, its specs, its assets).
 */
export const resetDesigns = Effect.fn("resetDesigns")(function* (
  session: UltrapaintSession
) {
  const fs = yield* FileSystem.FileSystem;
  // Working in the host's own directory (its setup), there is nothing to put back.
  if (session.seed === session.designs) {
    return;
  }
  // A run that adds a token rewrites DESIGN.md beside the designs: the next run must not see it.
  yield* restoreHostFiles(session.hostFiles);
  for (const entry of yield* fs.readDirectory(session.designs)) {
    if (entry !== PREVIEW_FILES) {
      yield* fs.remove(path.join(session.designs, entry), { recursive: true });
    }
  }
  for (const entry of yield* fs.readDirectory(session.seed)) {
    if (entry !== PREVIEW_FILES) {
      yield* fs.copy(
        path.join(session.seed, entry),
        path.join(session.designs, entry)
      );
    }
  }
});

type QuestionCard = Extract<ThreadItem, { kind: "question" }>;

const openCards = (items: readonly ThreadItem[]) =>
  items.filter(
    (i): i is QuestionCard =>
      i.kind === "question" && i.answers === null && i.outcome === undefined
  );

type PermissionCard = Extract<ThreadItem, { kind: "permission" }>;

const openPermissions = (items: readonly ThreadItem[]) =>
  items.filter(
    (i): i is PermissionCard => i.kind === "permission" && i.decision === null
  );

/** The option that allows the call, for good if the agent offers that. */
const allowing = (card: PermissionCard) =>
  card.options.find((o) => o.kind === "allow_always") ??
  card.options.find((o) => o.kind === "allow_once");

export interface Turn {
  readonly items: readonly ThreadItem[];
  /** Set when the turn did not end on its own. */
  readonly problem?: string;
  readonly seconds: number;
}

/** A picture sent with a prompt, as a user attaches a screenshot. */
export interface PromptImage {
  readonly dataUrl: string;
  readonly name: string;
}

/** A design thread held open: each prompt sent into it is a turn of the same conversation. */
export interface DesignThread {
  /**
   * Sends a prompt into the thread, as a user types the next message, and waits for the turn it
   * starts to end. The turn's items are its own: those the thread had before are left out.
   */
  readonly send: (
    text: string,
    images?: readonly PromptImage[]
  ) => Effect.Effect<Turn, EvalsError>;
}

/**
 * Starts a thread for the agent and holds it until the scope closes. Nobody is there to click, so
 * every tool call the agent asks permission for is allowed, as by a user who trusts it, and each
 * question gets its first option, which `ask_user` tells the agent to make its own choice.
 */
export const openThread = (
  session: UltrapaintSession,
  options: {
    readonly agent: string;
    readonly model: string | undefined;
    /** How long one turn may take. */
    readonly minutes: number;
    /** `design` writes the designs directory only; `implement` the project's code too. */
    readonly purpose?: "design" | "implement";
  }
): Effect.Effect<DesignThread, EvalsError, Scope.Scope> =>
  Effect.gen(function* () {
    const { client } = session;
    const thread = yield* Effect.acquireRelease(
      rpc(
        "starting a thread",
        client["threads.create"]({
          agentId: options.agent,
          purpose: options.purpose ?? "design",
        })
      ),
      (t) =>
        client["threads.delete"]({ threadId: t.id }).pipe(
          // A thread left behind is the scratch server's, and goes with it.
          Effect.ignore
        )
    );
    if (options.model !== undefined) {
      yield* pinModel(client, thread.id, options.model);
    }
    const itemsOf = rpc(
      "reading the thread",
      client["threads.items"]({ threadId: thread.id })
    );
    const send = Effect.fn("DesignThread.send")(function* (
      text: string,
      images: readonly PromptImage[] = []
    ) {
      const before = (yield* itemsOf).length;
      const started = Date.now();
      yield* rpc(
        "sending the prompt",
        client["threads.prompt"]({
          attachments: images.map((image) => ({
            dataUrl: image.dataUrl,
            kind: "image" as const,
            name: image.name,
          })),
          text,
          threadId: thread.id,
        })
      );
      const read = Effect.gen(function* () {
        const current = (yield* rpc(
          "listing threads",
          client["threads.list"]()
        )).find((t: Thread) => t.id === thread.id);
        const items = yield* itemsOf;
        const open = openCards(items);
        for (const card of open) {
          yield* rpc(
            "answering a question",
            client["threads.answer"]({
              answers: Object.fromEntries(
                card.questions.map((q) => [q.id, q.options[0]?.id ?? "yes"])
              ),
              itemId: card.id,
              threadId: thread.id,
            })
          );
        }
        const asking = openPermissions(items);
        for (const card of asking) {
          const option = allowing(card);
          if (option) {
            yield* rpc(
              "allowing a tool call",
              client["threads.permission"]({
                optionId: option.optionId,
                requestId: card.requestId,
                threadId: thread.id,
              })
            );
          }
        }
        return {
          answered: open.length > 0 || asking.length > 0,
          current,
          items,
        };
      });
      // The turn has ended when the thread is idle on a `turn_end` that came after the prompt.
      const done = yield* read.pipe(
        Effect.tap(() => Effect.sleep("1 second")),
        Effect.repeat({
          until: ({ answered, current, items }) =>
            !answered &&
            !!current &&
            (current.status === "error" ||
              (current.status === "idle" &&
                items.length > before &&
                items.at(-1)?.kind === "turn_end")),
        }),
        Effect.timeoutOption(Duration.minutes(options.minutes))
      );
      const seconds = (Date.now() - started) / 1000;
      if (done._tag === "None") {
        yield* client["threads.cancel"]({ threadId: thread.id }).pipe(
          Effect.ignore
        );
        return {
          items: (yield* itemsOf).slice(before),
          problem: `still working after ${options.minutes} minutes`,
          seconds,
        } satisfies Turn;
      }
      const finished = done.value;
      return {
        items: finished.items.slice(before),
        seconds,
        ...(finished.current?.status === "error" && {
          problem: "the agent's session failed",
        }),
      } satisfies Turn;
    });
    return { send };
  });

/** Sends a prompt to a fresh thread and waits for the turn to end (`openThread`). */
export const runPrompt = (
  session: UltrapaintSession,
  options: {
    readonly agent: string;
    /** Pictures sent with the prompt, as a user attaches screenshots. */
    readonly images?: readonly PromptImage[];
    readonly model: string | undefined;
    readonly minutes: number;
    /** `design` writes the designs directory only; `implement` the project's code too. */
    readonly purpose?: "design" | "implement";
    readonly text: string;
  }
): Effect.Effect<Turn, EvalsError, Scope.Scope> =>
  Effect.flatMap(openThread(session, options), (thread) =>
    thread.send(options.text, options.images)
  );

/** The model is a setting of the agent's session; "auto" would pick its own each time. */
const pinModel = Effect.fn("pinModel")(function* (
  client: UltrapaintClient,
  threadId: string,
  model: string
) {
  const ready = yield* rpc("listing threads", client["threads.list"]()).pipe(
    Effect.tap(() => Effect.sleep("200 millis")),
    Effect.repeat({
      until: (all) => all.some((t) => t.id === threadId && !!t.configOptions),
    }),
    Effect.timeout("2 minutes"),
    Effect.mapError(
      () =>
        new EvalsError({ message: "the agent never said which models it has" })
    )
  );
  const models =
    ready
      .find((t) => t.id === threadId)
      ?.configOptions?.find((option) => option.id === "model")?.options ?? [];
  const choice = models.find((m) => m.name === model || m.value === model);
  if (!choice) {
    return yield* new EvalsError({
      message: `no model "${model}"; the agent has ${models.map((m) => `"${m.name}"`).join(", ")}`,
    });
  }
  yield* rpc(
    "pinning the model",
    client["threads.setConfigOption"]({
      optionId: "model",
      threadId,
      value: choice.value,
    })
  );
});
