/**
 * ultrapaint as a user runs it: the `ultrapaint` command from this checkout, on a scratch
 * designs directory, reached through its public surfaces only: the editor's RPC for threads and
 * pages, its MCP server for pictures. Nothing here imports the server's code, so the evals keep
 * working while its insides move, and they measure what ships.
 */
import path from "node:path";
import {
  Deferred,
  Duration,
  Effect,
  FileSystem,
  Layer,
  Schema,
  type Scope,
  Stream,
} from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { RpcClient, RpcSerialization } from "effect/rpc";
import { Socket } from "effect/socket";
import { UltrapaintRpcs } from "../../../packages/contracts/src/rpc.ts";
import type {
  Thread,
  ThreadItem,
} from "../../../packages/contracts/src/threads.ts";
import { Browser } from "./browser.ts";
import { LabError } from "./errors.ts";
import { REPO, WORK, writeJson } from "./layout.ts";

/**
 * The project the prototypes are designed in: this repository's own web app, its components and
 * its stylesheet, as the agent benchmark uses it. A real product with a design system of its own
 * would test the skills against tokens; that is a later choice.
 */
const HOST = {
  componentPackages: ["@ultrapaint/web"],
  css: "apps/web/src/styles.css",
  libraryDirs: ["apps/web/src/components"],
  resolveFrom: "apps/web",
  theme: "light",
} as const;

/** Where the preview keeps what it generates inside the designs directory. */
const PREVIEW_FILES = ".ultrapaint";

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
  /** Absolute path of the scratch designs directory. */
  readonly designs: string;
  /** Calls a tool of the editor's MCP server, as an agent outside the editor would. */
  readonly tool: (
    name: string,
    args: Record<string, unknown>
  ) => Effect.Effect<ToolResult, LabError>;
  readonly url: string;
}

/** An RPC that failed, said with what was being done. */
export const rpc = <A, E, R>(what: string, effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.mapError(
      (cause) => new LabError({ message: `${what}: ${String(cause)}` })
    )
  );

/** A minimal MCP client over Streamable HTTP: initialize once, then call tools. */
const connectMcp = Effect.fn("connectMcp")(function* (connection: {
  readonly header: string;
  readonly token: string;
  readonly url: string;
}) {
  let session: string | undefined;
  let version = "2025-06-18";
  let nextId = 1;

  const post = (body: Record<string, unknown>) =>
    Effect.tryPromise({
      catch: (cause) =>
        new LabError({
          message: `the editor's MCP server did not answer ${String(body.method)}: ${String(cause)}`,
        }),
      try: async () => {
        const response = await fetch(connection.url, {
          body: JSON.stringify({ jsonrpc: "2.0", ...body }),
          headers: {
            accept: "application/json, text/event-stream",
            "content-type": "application/json",
            "mcp-protocol-version": version,
            [connection.header]: connection.token,
            ...(session !== undefined && { "mcp-session-id": session }),
          },
          method: "POST",
        });
        session = response.headers.get("mcp-session-id") ?? session;
        const text = await response.text();
        if (body.id === undefined || text.trim() === "") {
          return;
        }
        // A reply comes as JSON, or as the data of a server-sent event.
        const messages = response.headers
          .get("content-type")
          ?.includes("text/event-stream")
          ? text
              .split("\n")
              .filter((line) => line.startsWith("data:"))
              .map((line) => JSON.parse(line.slice(5)))
          : [JSON.parse(text)];
        const reply = messages.find((m) => m?.id === body.id);
        if (reply?.error) {
          throw new Error(reply.error.message ?? JSON.stringify(reply.error));
        }
        return reply?.result as Record<string, unknown> | undefined;
      },
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
  if (typeof initialized?.protocolVersion === "string") {
    version = initialized.protocolVersion;
  }
  nextId += 1;
  yield* post({ method: "notifications/initialized" });

  return Effect.fn("UltrapaintSession.tool")(function* (
    name: string,
    args: Record<string, unknown>
  ) {
    nextId += 1;
    const result = yield* post({
      id: nextId,
      method: "tools/call",
      params: { arguments: args, name },
    });
    const content = (result?.content ?? []) as readonly {
      readonly data?: string;
      readonly text?: string;
      readonly type: string;
    }[];
    return {
      images: content
        .filter((c) => c.type === "image" && c.data)
        .map((c) => new Uint8Array(Buffer.from(c.data ?? "", "base64"))),
      isError: result?.isError === true,
      text: content
        .filter((c) => c.type === "text")
        .map((c) => c.text ?? "")
        .join("\n"),
    } satisfies ToolResult;
  });
});

/**
 * Starts ultrapaint on a scratch designs directory of the slot's own, and holds it, its editor
 * in the browser and its connections until the scope closes.
 */
export const launch = Effect.fn("launch")(function* (slot: string) {
  const fs = yield* FileSystem.FileSystem;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const browser = yield* Browser;

  const work = path.join(WORK, slot);
  const designs = path.join(work, "designs");
  yield* fs.makeDirectory(designs, { recursive: true });
  const config = path.join(work, "ultrapaint.config.json");
  yield* writeJson(config, {
    componentPackages: HOST.componentPackages,
    designsDir: path.relative(REPO, designs),
    hostCss: [
      path.relative(
        path.join(designs, PREVIEW_FILES),
        path.join(REPO, HOST.css)
      ),
    ],
    libraryDirs: HOST.libraryDirs,
    repoPath: REPO,
    resolveFrom: HOST.resolveFrom,
    theme: HOST.theme,
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
          path.join(REPO, "scripts/cli.ts"),
          "--config",
          config,
          "--port",
          "0",
          "--ready-json",
          "--no-open",
          "--ephemeral",
        ],
        { cwd: REPO, forceKillAfter: "5 seconds", stdin: "ignore" }
      )
    )
    .pipe(
      Effect.mapError(
        (cause) =>
          new LabError({ message: `ultrapaint did not start: ${cause}` })
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
        new LabError({
          message: `ultrapaint did not say it was ready; see ${path.relative(REPO, log)}`,
        })
    )
  );
  if (server.attached) {
    yield* Effect.logWarning(
      `a server was already running for ${path.relative(REPO, config)}; using it`
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

  // Pictures are drawn by the preview, which starts with the project and takes a moment.
  const host = yield* rpc("reading the project", client["project.info"]()).pipe(
    Effect.map((info) => info.host),
    Effect.tap(() => Effect.sleep("500 millis")),
    Effect.repeat({
      until: (status) => status.state === "running" || status.state === "error",
    }),
    Effect.timeout("3 minutes"),
    Effect.mapError(
      () => new LabError({ message: "the preview did not start in 3 minutes" })
    )
  );
  if (host.state === "error") {
    return yield* new LabError({
      message: `the preview failed: ${host.error ?? "no reason given"}`,
    });
  }
  yield* browser.hold(server.url);

  const connection = yield* rpc(
    "asking for the MCP connection",
    client["mcp.connection"]()
  );
  const tool = yield* connectMcp(connection);
  yield* Effect.log(`ultrapaint is running at ${server.url}`);
  return { client, designs, tool, url: server.url } satisfies UltrapaintSession;
});

/** Empties the designs directory but for the preview's own files, which it needs to keep drawing. */
export const resetDesigns = Effect.fn("resetDesigns")(function* (
  designs: string
) {
  const fs = yield* FileSystem.FileSystem;
  for (const entry of yield* fs.readDirectory(designs)) {
    if (entry !== PREVIEW_FILES) {
      yield* fs.remove(path.join(designs, entry), { recursive: true });
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

/**
 * Sends a prompt to a fresh thread and waits for the turn to end. Nobody is there to click, so
 * every tool call the agent asks permission for is allowed, as by a user who trusts it, and each
 * question gets its first option, which `ask_user` tells the agent to make its own choice.
 */
export const runPrompt = (
  session: UltrapaintSession,
  options: {
    readonly agent: string;
    readonly model: string | undefined;
    readonly minutes: number;
    readonly text: string;
  }
): Effect.Effect<Turn, LabError, Scope.Scope> =>
  Effect.gen(function* () {
    const { client } = session;
    const thread = yield* Effect.acquireRelease(
      rpc(
        "starting a thread",
        client["threads.create"]({ agentId: options.agent, purpose: "design" })
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
    const started = Date.now();
    yield* rpc(
      "sending the prompt",
      client["threads.prompt"]({
        attachments: [],
        text: options.text,
        threadId: thread.id,
      })
    );
    const read = Effect.gen(function* () {
      const current = (yield* rpc(
        "listing threads",
        client["threads.list"]()
      )).find((t: Thread) => t.id === thread.id);
      const items = yield* rpc(
        "reading the thread",
        client["threads.items"]({ threadId: thread.id })
      );
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
              remember: option.kind === "allow_always",
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
    const done = yield* read.pipe(
      Effect.tap(() => Effect.sleep("1 second")),
      Effect.repeat({
        until: ({ answered, current, items }) =>
          !answered &&
          !!current &&
          (current.status === "error" ||
            (current.status === "idle" && items.at(-1)?.kind === "turn_end")),
      }),
      Effect.timeoutOption(Duration.minutes(options.minutes))
    );
    const seconds = (Date.now() - started) / 1000;
    if (done._tag === "None") {
      yield* client["threads.cancel"]({ threadId: thread.id }).pipe(
        Effect.ignore
      );
      const items = yield* rpc(
        "reading the thread",
        client["threads.items"]({ threadId: thread.id })
      );
      return {
        items,
        problem: `still working after ${options.minutes} minutes`,
        seconds,
      };
    }
    const finished = done.value;
    return {
      items: finished.items,
      seconds,
      ...(finished.current?.status === "error" && {
        problem: "the agent's session failed",
      }),
    };
  });

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
        new LabError({ message: "the agent never said which models it has" })
    )
  );
  const models =
    ready
      .find((t) => t.id === threadId)
      ?.configOptions?.find((option) => option.id === "model")?.options ?? [];
  const choice = models.find((m) => m.name === model || m.value === model);
  if (!choice) {
    return yield* new LabError({
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
