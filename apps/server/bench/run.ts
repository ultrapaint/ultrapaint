/**
 * Measures what an agent spends to do the tool's own work: tool calls, wall time, and whether the
 * work came out right. It drives the real server over RPC, the way the editor does, so what it
 * measures is the product rather than a model of it.
 *
 * Usage:
 *   node --experimental-strip-types apps/server/bench/run.ts [--arm baseline]
 *       [--agent claude-code] [--tasks new-page,router-link] [--runs 1]
 *       [--label name-in-the-report] --out docs/feature/benchmarks/<comparison>
 *
 * Each task runs in its own thread (a fresh agent session) against a designs directory of its
 * own, which is thrown away afterwards. Results land in the comparison's directory, `--out`.
 *
 * The editor is built and opened in headless Chrome for the length of the run: pictures are
 * drawn by an open editor's preview, and without one every `get_screenshot` fails. `--browser`
 * names a Chrome or Chromium where none is found in the usual places.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import type { ProjectInfo } from "@ultrapaint/contracts/project";
import { UltrapaintRpcs } from "@ultrapaint/contracts/rpc";
import {
  isEditorMcpCall,
  type Thread,
  type ThreadItem,
} from "@ultrapaint/contracts/threads";
import { Effect, FileSystem, Layer } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { RpcClient, RpcSerialization } from "effect/rpc";
import { Socket } from "effect/socket";
import { ServerConfig } from "../src/config.ts";
import { ServerLive } from "../src/server.ts";
import { type BenchTask, tasks } from "./tasks.ts";

const repo = path.resolve(import.meta.dirname, "../../..");
const webDist = path.join(repo, "apps/web/dist");
/** Where the preview keeps what it generates inside the designs directory. */
const PREVIEW_FILES = ".ultrapaint";
/** Where Chrome usually is, when `--browser` does not say. */
const BROWSERS = [
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

const flag = (name: string, fallback: string) => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
};

const arm = flag("arm", "baseline");
/** What the runs are called in the report; the arm, unless two builds of one arm are compared. */
const label = flag("label", arm);
/** Where the runs are written: a directory of their own keeps one comparison from another. */
const outFlag = flag("out", "");
if (outFlag === "") {
  console.error(
    "say where the runs go: --out docs/feature/benchmarks/<comparison>, one directory per comparison"
  );
  process.exit(2);
}
const outDir = path.resolve(repo, outFlag);
const agentId = flag("agent", "claude-code");
/** Pinned, because a run left on "auto" is not the same measurement twice. `auto` opts out. */
const model = flag("model", "Opus 5");
const runs = Number(flag("runs", "1"));
const only = flag("tasks", "")
  .split(",")
  .filter((id) => id.length > 0);

interface Measurement {
  /** Which agent was measured: the arms of one agent say nothing about another's. */
  readonly agent: string;
  readonly arm: string;
  /** The calls that failed, with what they said: a retry costs a call, and this says why. */
  readonly failed: readonly string[];
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

/** Asking the editor is its own kind: agents file it under `other` or `execute`. */
const kindOf = (item: Extract<ThreadItem, { kind: "tool" }>) =>
  isEditorMcpCall(item.title) ? "mcp" : (item.toolKind ?? "unnamed");

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
    const kind = item.kind === "tool" ? kindOf(item) : "";
    toolKinds[kind] = (toolKinds[kind] ?? 0) + 1;
  }
  return {
    agent: agentId,
    arm: label,
    failed: toolItems.flatMap((item) =>
      item.kind === "tool" && item.status === "failed"
        ? [
            `${item.title.slice(0, 60)}: ${item.content
              .map((c) => ("text" in c ? c.text : ""))
              .join(" ")
              .slice(0, 300)}`,
          ]
        : []
    ),
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

/** The editor as the server serves it, built from the checkout as it is now. */
const buildEditor = Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const child = yield* spawner.spawn(
    ChildProcess.make("pnpm", ["-F", "@ultrapaint/web", "build"], {
      cwd: repo,
      stdin: "ignore",
      stdout: "ignore",
    })
  );
  if (Number(yield* child.exitCode) !== 0) {
    return yield* Effect.die("the editor could not be built");
  }
}).pipe(Effect.scoped);

/** The editor open in headless Chrome until the run ends, so get_screenshot has one to ask. */
const openEditor = (url: string) =>
  Effect.gen(function* () {
    const browser = flag("browser", "") || BROWSERS.find((p) => existsSync(p));
    if (!browser) {
      yield* Effect.logWarning(
        "no Chrome found (--browser names one): every get_screenshot will fail"
      );
      return;
    }
    const fs = yield* FileSystem.FileSystem;
    const profile = yield* fs.makeTempDirectoryScoped({
      prefix: "bench-browser-",
    });
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    yield* spawner.spawn(
      ChildProcess.make(
        browser,
        [
          "--headless=new",
          "--disable-gpu",
          "--no-first-run",
          "--no-default-browser-check",
          `--user-data-dir=${profile}`,
          "--window-size=1440,900",
          url,
        ],
        {
          forceKillAfter: "3 seconds",
          stderr: "ignore",
          stdin: "ignore",
          stdout: "ignore",
        }
      )
    );
    yield* Effect.log(`the editor is open in ${path.basename(browser)}`);
  });

/**
 * Each run starts from the same designs directory, and leaves nothing behind but the preview's
 * own files (.ultrapaint), which it wrote when the project opened and needs to keep drawing.
 */
const resetDesigns = (designs: string, task: BenchTask) => {
  mkdirSync(designs, { recursive: true });
  for (const entry of readdirSync(designs)) {
    if (entry !== PREVIEW_FILES) {
      rmSync(path.join(designs, entry), { force: true, recursive: true });
    }
  }
  for (const [rel, content] of Object.entries(task.given ?? {})) {
    mkdirSync(path.dirname(path.join(designs, rel)), { recursive: true });
    writeFileSync(path.join(designs, rel), content);
  }
};

type QuestionCard = Extract<ThreadItem, { kind: "question" }>;

/** Question cards nobody has answered or let go of yet. */
const openCards = (items: readonly ThreadItem[]) =>
  items.filter(
    (i): i is QuestionCard =>
      i.kind === "question" && i.answers === null && i.outcome === undefined
  );

/** Each question's first option, which ask_user tells the agent to make its own choice. */
const firstOptions = (card: QuestionCard) =>
  Object.fromEntries(
    card.questions.map((q) => [q.id, q.options[0]?.id ?? "yes"])
  );

/** Pictures are drawn by the preview, which starts with the project and takes a moment. */
const waitForPreview = <E, R>(info: Effect.Effect<ProjectInfo, E, R>) =>
  Effect.gen(function* () {
    const host = yield* info.pipe(
      Effect.map((project) => project.host),
      Effect.tap(() => Effect.sleep("500 millis")),
      Effect.repeat({
        until: (status) =>
          status.state === "running" || status.state === "error",
      }),
      Effect.timeoutOption("2 minutes")
    );
    if (host._tag === "Some" && host.value.state === "running") {
      return;
    }
    const why =
      host._tag === "None"
        ? "still starting after two minutes"
        : (host.value.error ?? host.value.state);
    yield* Effect.logWarning(
      `the preview is not running (${why}): every get_screenshot will fail`
    );
  });

const program = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  yield* buildEditor;
  const port = yield* freePort;
  const userDir = yield* fs.makeTempDirectoryScoped({ prefix: "bench-home-" });
  const designsRel = "docs/bench-designs";
  const designs = path.join(repo, designsRel);

  const server = ServerLive.pipe(
    Layer.provide(
      Layer.succeed(ServerConfig, {
        allowedHosts: [],
        briefing: arm !== "baseline",
        cwd: repo,
        // Model options are known from discovery, before the first prompt starts a session.
        discovery: true,
        host: "127.0.0.1",
        machine: {
          addresses: () => [],
          home: homedir(),
          path: process.env.PATH ?? "",
          tmpdir: tmpdir(),
          uid: process.getuid?.(),
        },
        mcp: arm === "mcp",
        port,
        readyJson: false,
        storage: { mode: "ephemeral" },
        token: "bench",
        userDir,
        version: "bench",
        webDist,
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
    yield* waitForPreview(client["project.info"]());
    yield* openEditor(`http://127.0.0.1:${port}/`);

    /** Polls until the thread is done with the turn it was given. */
    const waitForTurn = (threadId: string) =>
      Effect.gen(function* () {
        const read = Effect.gen(function* () {
          const thread = (yield* client["threads.list"]()).find(
            (t: Thread) => t.id === threadId
          );
          const items = yield* client["threads.items"]({ threadId });
          // Nobody is there to answer a question card, so the bench picks each question's first
          // option, which ask_user tells the agent to make its own choice. The run goes on
          // either within the turn or with the answers as the next prompt.
          const open = openCards(items);
          for (const card of open) {
            yield* client["threads.answer"]({
              answers: firstOptions(card),
              itemId: card.id,
              threadId,
            });
          }
          return { answered: open.length > 0, items, thread };
        });
        return yield* read.pipe(
          Effect.tap(() => Effect.sleep("500 millis")),
          Effect.repeat({
            until: ({ answered, items, thread }) =>
              !answered &&
              !!thread &&
              (thread.status === "error" ||
                (thread.status === "idle" &&
                  items.at(-1)?.kind === "turn_end")),
          }),
          Effect.timeout("10 minutes")
        );
      });

    /**
     * The model the agent runs on is a setting of its session; "auto" would pick its own, and a
     * run on whatever the agent picks is not the same measurement twice. Stopped before the
     * prompt, so finding out the names costs nothing.
     */
    const pinModel = (threadId: string) =>
      Effect.gen(function* () {
        const ready = yield* client["threads.list"]().pipe(
          Effect.tap(() => Effect.sleep("100 millis")),
          Effect.repeat({
            until: (all) =>
              all.some((t) => t.id === threadId && !!t.configOptions),
          }),
          Effect.timeout("2 minutes")
        );
        const models =
          ready
            .find((t) => t.id === threadId)
            ?.configOptions?.find((option) => option.id === "model")?.options ??
          [];
        const choice = models.find((value) => value.name === model);
        if (choice) {
          yield* client["threads.setConfigOption"]({
            optionId: "model",
            threadId,
            value: choice.value,
          });
        } else if (model !== "auto") {
          return yield* Effect.die(
            `${agentId} has no model named "${model}"; it has: ${models.map((m) => `"${m.name}"`).join(", ")} (or pass --model auto)`
          );
        }
      });

    for (const task of tasks.filter(
      (t) => only.length === 0 || only.includes(t.id)
    )) {
      for (let run = 0; run < runs; run += 1) {
        resetDesigns(designs, task);

        const thread = yield* client["threads.create"]({ agentId });
        yield* pinModel(thread.id);
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

  /**
   * Whatever ends the run, a failure or ^C half way included, the scratch designs go and the
   * runs measured so far are written: an hour of agent turns is not lost to the last one.
   */
  const finish = Effect.gen(function* () {
    rmSync(designs, { force: true, recursive: true });
    if (measurements.length === 0) {
      return;
    }
    mkdirSync(outDir, { recursive: true });
    const file = path.join(outDir, `${label}-${agentId}-${Date.now()}.json`);
    writeFileSync(file, `${JSON.stringify(measurements, null, 2)}\n`);
    yield* Effect.log(`wrote ${path.relative(repo, file)}`);
  });

  yield* work.pipe(
    // The server first: the protocol connects to it.
    Effect.provide(protocol.pipe(Layer.provide(server))),
    Effect.ensuring(finish)
  );
});

program.pipe(
  Effect.scoped,
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain
);
