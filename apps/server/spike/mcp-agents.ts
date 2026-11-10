/**
 * Manual check of the editor's MCP server with real agents, through the real thread path: the
 * server starts on this repository, a thread opens with the built-in launch configuration, and
 * the agent is asked to use a tool. The server logs which protocol revision each thread speaks
 * ("MCP: thread … speaks 2026-07-28"); the tool calls the agent made are printed after the turn.
 *
 * node apps/server/spike/mcp-agents.ts <claude-code|codex> [prompt]
 *
 * A question the agent puts to the user is answered with the first option of each, so a prompt
 * that makes it ask runs to the end on its own.
 */
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { UltrapaintRpcs } from "@ultrapaint/contracts/rpc";
import type { ThreadItem } from "@ultrapaint/contracts/threads";
import { Effect, FileSystem, Layer, Schedule } from "effect";
import { RpcClient, RpcSerialization } from "effect/rpc";
import { Socket } from "effect/socket";
import { ServerConfig } from "../src/config.ts";
import { ServerLive } from "../src/server.ts";

const repo = path.resolve(import.meta.dirname, "../../..");
const agentId = process.argv[2] ?? "claude-code";
const prompt =
  process.argv[3] ??
  "Call the get_context tool of the ultrapaint MCP server once, then answer with the number of canvases and nothing else.";
const port = 4797;

const program = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const userDir = yield* fs.makeTempDirectoryScoped({ prefix: "mcp-agents-" });
  const server = ServerLive.pipe(
    Layer.provide(
      Layer.succeed(ServerConfig, {
        allowedHosts: [],
        briefing: true,
        cwd: repo,
        discovery: false,
        editorPort: undefined,
        host: "127.0.0.1",
        machine: {
          addresses: () => [],
          env: Object.fromEntries(
            Object.entries(process.env).flatMap(([name, value]) =>
              value === undefined ? [] : [[name, value]]
            )
          ),
          home: homedir(),
          path: process.env.PATH ?? "",
          tmpdir: tmpdir(),
          uid: process.getuid?.(),
        },
        mcp: true,
        port,
        readyJson: false,
        // The repository's own configuration, read and never written; the threads' state in a
        // directory that goes with the run.
        storage: {
          configPath: path.join(repo, "ultrapaint.json"),
          mode: "file",
          stateDir: userDir,
        },
        token: "spike",
        userDir,
        version: "spike",
        webDist: undefined,
      })
    )
  );
  const protocol = RpcClient.layerProtocolSocket().pipe(
    Layer.provide(Socket.layerWebSocket(`ws://127.0.0.1:${port}/ws`)),
    Layer.provide(Socket.layerWebSocketConstructorGlobal),
    Layer.provide(RpcSerialization.layerJson)
  );

  const work = Effect.gen(function* () {
    const client = yield* RpcClient.make(UltrapaintRpcs);
    // The project opens a moment after the server answers.
    const thread = yield* client["threads.create"]({ agentId }).pipe(
      Effect.retry({ schedule: Schedule.spaced("250 millis"), times: 120 })
    );
    yield* client["threads.prompt"]({
      attachments: [],
      text: prompt,
      threadId: thread.id,
    });
    const answered = new Set<string>();
    const items = yield* Effect.gen(function* () {
      const all = yield* client["threads.items"]({ threadId: thread.id });
      for (const item of all) {
        if (item.kind === "question" && !answered.has(item.id)) {
          answered.add(item.id);
          yield* Effect.log(`asked: ${JSON.stringify(item.questions)}`);
          yield* client["threads.answer"]({
            answers: Object.fromEntries(
              item.questions.map((q) => [q.id, q.options[0]?.id ?? "yes"])
            ),
            itemId: item.id,
            threadId: thread.id,
          });
        }
        if (item.kind === "permission" && item.decision === null) {
          const allow =
            item.options.find((o) => o.kind === "allow_once") ??
            item.options[0];
          yield* Effect.log(`permission: ${item.title} -> ${allow?.name}`);
          yield* client["threads.permission"]({
            optionId: allow?.optionId ?? "",
            requestId: item.requestId,
            threadId: thread.id,
          });
        }
      }
      const status: string | undefined = (yield* client["threads.list"]()).find(
        (t) => t.id === thread.id
      )?.status;
      return { all, status };
    }).pipe(
      Effect.tap(() => Effect.sleep("500 millis")),
      Effect.repeat({
        until: ({ all, status }) =>
          status === "error" ||
          (status === "idle" && all.at(-1)?.kind === "turn_end"),
      }),
      Effect.timeoutOption("5 minutes"),
      Effect.flatMap((done) =>
        done._tag === "Some"
          ? Effect.succeed(done.value)
          : Effect.map(
              client["threads.items"]({ threadId: thread.id }),
              (all) => ({ all, status: "timed out" as string | undefined })
            )
      )
    );
    const line = (item: ThreadItem) => {
      switch (item.kind) {
        case "tool":
          return `tool [${item.status}] ${item.title}`;
        case "agent":
          return `agent: ${item.text.slice(0, 200)}`;
        case "permission":
          return `permission: ${item.title} -> ${item.decision}`;
        case "question":
          return `question: answers ${JSON.stringify(item.answers)}`;
        default:
          return item.kind;
      }
    };
    yield* Effect.log(
      `status ${items.status}\n${items.all.map(line).join("\n")}`
    );
    yield* client["threads.delete"]({ threadId: thread.id });
  });

  yield* work.pipe(
    // The server first: the protocol connects to it.
    Effect.provide(protocol.pipe(Layer.provide(server)))
  );
});

program.pipe(
  Effect.scoped,
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain
);
