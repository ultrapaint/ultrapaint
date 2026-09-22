/**
 * Measures what an agent spends to do the tool's own work: tool calls, wall time, and whether the
 * work came out right. It drives the real server over RPC, the way the editor does, so what it
 * measures is the product rather than a model of it.
 *
 * Usage:
 *   node --experimental-strip-types apps/server/bench/run.ts [--arm baseline]
 *       [--agent claude-code] [--tasks new-page,router-link] [--runs 1]
 *
 * Each task runs in its own thread (a fresh agent session) against a designs directory of its
 * own, which is thrown away afterwards. Results land in `docs/feature/benchmarks/`.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { UltrapaintRpcs } from "@ultrapaint/contracts/rpc";
import type { Thread, ThreadItem } from "@ultrapaint/contracts/threads";
import { Effect, FileSystem, Layer } from "effect";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import { Socket } from "effect/unstable/socket";
import { ServerConfig } from "../src/config.ts";
import { ServerLive } from "../src/server.ts";
import { type BenchTask, tasks } from "./tasks.ts";

const repo = path.resolve(import.meta.dirname, "../../..");

const flag = (name: string, fallback: string) => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
};

const arm = flag("arm", "baseline");
const agentId = flag("agent", "claude-code");
/** Pinned, because a run left on "auto" is not the same measurement twice. */
const model = flag("model", "Opus 5");
const runs = Number(flag("runs", "1"));
const only = flag("tasks", "")
  .split(",")
  .filter((id) => id.length > 0);

interface Measurement {
  /** Which agent was measured: the arms of one agent say nothing about another's. */
  readonly agent: string;
  readonly arm: string;
  readonly failure: string | null;
  readonly items: Record<string, number>;
  readonly seconds: number;
  readonly task: string;
  /** What the run spent, as the agent accounts for it. */
  readonly tokens: {
    readonly byModel: Record<string, number>;
    readonly total: number;
  };
  readonly toolCalls: number;
  /** Tool calls by the kind the agent gave them: read, edit, execute, and so on. */
  readonly toolKinds: Record<string, number>;
  /** What each call was, in order, so a run can be read back rather than guessed at. */
  readonly trace: readonly string[];
}

const freePort = Effect.callback<number>((resume) => {
  import("node:net").then(({ createServer }) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resume(Effect.succeed(port)));
    });
  });
});

const measure = (
  task: BenchTask,
  items: readonly ThreadItem[],
  seconds: number,
  failure: string | null
): Measurement => {
  const byModel: Record<string, number> = {};
  const spent = { cached: 0, input: 0, output: 0, total: 0 };
  for (const item of items) {
    if (item.kind !== "turn_end" || !item.usage) {
      continue;
    }
    spent.total += item.usage.totalTokens;
    spent.input += item.usage.inputTokens;
    spent.cached += item.usage.cachedInputTokens;
    spent.output += item.usage.outputTokens;
    for (const entry of item.usage.byModel) {
      byModel[entry.model] = (byModel[entry.model] ?? 0) + entry.tokens;
    }
  }
  const byKind: Record<string, number> = {};
  for (const item of items) {
    byKind[item.kind] = (byKind[item.kind] ?? 0) + 1;
  }
  const toolItems = items.filter((i) => i.kind === "tool");
  const toolKinds: Record<string, number> = {};
  for (const item of toolItems) {
    const kind = item.kind === "tool" ? (item.toolKind ?? "unnamed") : "";
    toolKinds[kind] = (toolKinds[kind] ?? 0) + 1;
  }
  return {
    agent: agentId,
    arm,
    failure,
    items: byKind,
    seconds,
    task: task.id,
    tokens: { byModel, ...spent },
    toolCalls: toolItems.length,
    toolKinds,
    trace: toolItems.map((item) =>
      item.kind === "tool" ? item.title.slice(0, 80) : ""
    ),
  };
};

const program = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const port = yield* freePort;
  const userDir = yield* fs.makeTempDirectoryScoped({ prefix: "bench-home-" });
  const designsRel = "docs/bench-designs";
  const designs = path.join(repo, designsRel);

  const server = ServerLive.pipe(
    Layer.provide(
      Layer.succeed(ServerConfig, {
        briefing: arm !== "baseline",
        cwd: repo,
        mcp: arm === "mcp",
        port,
        storage: { mode: "ephemeral" },
        userDir,
        version: "bench",
        webDist: undefined,
      })
    )
  );
  const protocol = RpcClient.layerProtocolSocket().pipe(
    Layer.provide(Socket.layerWebSocket(`ws://127.0.0.1:${port}/ws`)),
    Layer.provide(Socket.layerWebSocketConstructorGlobal),
    Layer.provide(RpcSerialization.layerJson)
  );

  const measurements: Measurement[] = [];

  const work = Effect.gen(function* () {
    const client = yield* RpcClient.make(UltrapaintRpcs);

    // The designs directory has to be there before the settings can name it.
    mkdirSync(designs, { recursive: true });
    const validation = yield* client["settings.set"]({
      componentPackages: ["@ultrapaint/web"],
      designsDir: designsRel,
      hostCss: ["../../../apps/web/src/styles.css"],
      libraryDirs: ["apps/web/src/components"],
      repoPath: repo,
      resolveFrom: "apps/web",
      theme: "light",
    });
    yield* Effect.log(`settings: ${JSON.stringify(validation)}`);

    /** Polls until the thread is done with the turn it was given. */
    const waitForTurn = (threadId: string) =>
      Effect.gen(function* () {
        const read = Effect.gen(function* () {
          const thread = (yield* client["threads.list"]()).find(
            (t: Thread) => t.id === threadId
          );
          const items = yield* client["threads.items"]({ threadId });
          return { items, thread };
        });
        return yield* read.pipe(
          Effect.tap(() => Effect.sleep("500 millis")),
          Effect.repeat({
            until: ({ items, thread }) =>
              !!thread &&
              (thread.status === "error" ||
                (thread.status === "idle" &&
                  items.at(-1)?.kind === "turn_end")),
          }),
          Effect.timeout("10 minutes")
        );
      });

    for (const task of tasks.filter(
      (t) => only.length === 0 || only.includes(t.id)
    )) {
      for (let run = 0; run < runs; run += 1) {
        // Each run starts from the same designs directory, and leaves nothing behind.
        rmSync(designs, { force: true, recursive: true });
        mkdirSync(designs, { recursive: true });
        for (const [rel, content] of Object.entries(task.given ?? {})) {
          mkdirSync(path.dirname(path.join(designs, rel)), { recursive: true });
          writeFileSync(path.join(designs, rel), content);
        }

        const thread = yield* client["threads.create"]({ agentId });
        // The model the agent runs on is a setting of its session; "auto" would pick its own.
        const ready = yield* client["threads.list"]().pipe(
          Effect.tap(() => Effect.sleep("100 millis")),
          Effect.repeat({
            until: (all) =>
              all.some((t) => t.id === thread.id && !!t.sessionId),
          }),
          Effect.timeout("2 minutes")
        );
        const options = ready.find((t) => t.id === thread.id)?.configOptions;
        const choice = options
          ?.find((option) => option.id === "model")
          ?.options.find((value) => value.name === model);
        if (choice) {
          yield* client["threads.setConfigOption"]({
            optionId: "model",
            threadId: thread.id,
            value: choice.value,
          });
        } else {
          yield* Effect.log(`no model named ${model}; the agent picks`);
        }
        const started = Date.now();
        yield* client["threads.prompt"]({
          attachments: [],
          text: task.prompt,
          threadId: thread.id,
        });
        const { items } = yield* waitForTurn(thread.id);
        const seconds = (Date.now() - started) / 1000;
        const failure = task.check({ designs, repo });
        measurements.push(measure(task, items, seconds, failure));
        const last = measurements.at(-1);
        yield* Effect.log(
          `${task.id} run ${run + 1}: ${last?.toolCalls} tool calls, ${seconds.toFixed(0)}s, ${((last?.tokens.total ?? 0) / 1000).toFixed(0)}k tokens, ${failure ?? "ok"}`
        );
        yield* client["threads.delete"]({ threadId: thread.id });
      }
    }
  });

  yield* work.pipe(Effect.provide(protocol), Effect.provide(server));

  rmSync(designs, { force: true, recursive: true });
  const out = path.join(repo, "docs/feature/benchmarks");
  mkdirSync(out, { recursive: true });
  const file = path.join(out, `${arm}-${agentId}-${Date.now()}.json`);
  writeFileSync(file, `${JSON.stringify(measurements, null, 2)}\n`);
  yield* Effect.log(`wrote ${path.relative(repo, file)}`);
});

program.pipe(
  Effect.scoped,
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain
);
