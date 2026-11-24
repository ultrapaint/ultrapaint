/// <reference lib="dom" />
/**
 * `pnpm bench:chats`: how the editor holds up while several chats work at once, measured in a
 * headless Chrome against a running `pnpm dev`. The chats run the load agent
 * (`packages/acp/testing/load-agent.mjs`), which streams thoughts, answers and tool calls at a real
 * agent's rate. It opens the canvas fitted, starts `--agents` chats, opens the first in the chat
 * panel, types into its composer, and reports a quiet window (typing alone) and a busy one (typing
 * while the chats stream):
 *
 * - `mainCpuMsPerSecond`: the CPU the editor's main thread used, as Linux counts it, which a
 *   machine busy with other work does not stretch the way it stretches wall time;
 * - wall time: tasks and script (Chrome's metrics), frames per second and those over 50 ms, long
 *   tasks, how long a key typed took to be drawn (Event Timing), React commits;
 * - with `--renders`, the components drawn again, by name, and per agent event: a count no other
 *   load on the machine changes, so before and after compare on any machine;
 * - with `--probe-dir`, the server's CPU and event loop delay.
 *
 * Setup, once: a person's folder for the bench whose `agents/load.json` is
 * `{"id":"load","name":"Load","command":"<node>","args":["<checkout>/packages/acp/testing/load-agent.mjs"]}`
 * (and, where `node` lives outside what the sandbox lets an agent read, a `profile.json` of
 * `{"sandbox":false}`), then the editor on it:
 *
 *   BENCH_PROBE_DIR=<dir> NODE_OPTIONS="--import <checkout>/scripts/bench-chats/server-probe.mjs" \
 *     pnpm dev -- --config ultrapaint.config.json --no-open --user-dir <bench folder>
 *   pnpm bench:chats [--url http://127.0.0.1:4601] [--agents 4] [--seconds 12] [--history 200]
 *     [--canvas redesign] [--mcp canvas:route#node,…] [--view fit|away] [--cpu 1] [--renders]
 *     [--probe-dir dir] [--profile out.cpuprofile] [--trace out.json] [--out result.json]
 *
 * `--history` has each agent first say that many finished tool calls, as a chat that has been
 * working a while. `--mcp` has each agent change one of those nodes' text through the editor's MCP
 * server once a cycle (the pages are written: `git checkout` them after). `--view away` moves the
 * camera off every frame, to tell the canvas's cost from the chat's. `--cpu 4` slows Chrome down
 * as a laptop on battery. Without `--url` it finds the editor where `pnpm dev` puts it.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { chromium, type Page } from "playwright-core";

const { values: args } = parseArgs({
  options: {
    agents: { default: "4", type: "string" },
    canvas: { default: "redesign", type: "string" },
    chrome: { type: "string" },
    cpu: { default: "1", type: "string" },
    history: { default: "0", type: "string" },
    mcp: { type: "string" },
    out: { type: "string" },
    "probe-dir": { type: "string" },
    profile: { type: "string" },
    renders: { default: false, type: "boolean" },
    seconds: { default: "12", type: "string" },
    trace: { type: "string" },
    url: { type: "string" },
    view: { default: "fit", type: "string" },
  },
});

/** Where `pnpm dev` serves the editor for this checkout (see `dev-runner.ts`). */
const devUrl = () => {
  const root = path.resolve(import.meta.dirname, "..");
  const hash = createHash("sha1").update(root).digest();
  const web =
    process.env.ULTRAPAINT_WEB_PORT ??
    String(4600 + ((hash[0] as number) % 40) * 2 + 1);
  return `http://127.0.0.1:${web}`;
};

const EDITOR = (args.url ?? devUrl()).replace(/\/$/, "");
const AGENTS = Number(args.agents);
const SECONDS = Number(args.seconds);
const HISTORY = Number(args.history);
const QUIET_SECONDS = 5;

const chromePath = () => {
  const found = [
    args.chrome,
    process.env.CHROME_PATH,
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].find((c) => c && existsSync(c));
  if (!found) {
    throw new Error("No Chrome found: pass --chrome or set CHROME_PATH.");
  }
  return found;
};

/** What the page under test records for the bench. */
interface Recorded {
  commits: number[];
  /** Whether each commit's components are counted: it walks the whole tree, at a cost. */
  counting: boolean;
  events: { d: number; name: string; t: number }[];
  frames: number[];
  longTasks: { d: number; t: number }[];
  /** Components drawn again, by name. */
  renders: Record<string, number>;
  /** The same, by name and what changed: `props`, or the first hook whose state did. */
  why: Record<string, number>;
}

interface Hook {
  memoizedState: unknown;
  next: Hook | null;
  queue: unknown;
}
interface Named {
  displayName?: string;
  name?: string;
  render?: Named;
  type?: Named;
}
interface Fiber {
  alternate: Fiber | null;
  child: Fiber | null;
  elementType: Named | string | null;
  memoizedProps: unknown;
  memoizedState: Hook | null;
  sibling: Fiber | null;
}

/**
 * Runs in the editor before the app does: long tasks, frames, input, React commits. It is sent to
 * the page as one function, so everything it uses is inside it.
 */
const instrument = () => {
  if (window.top !== window) {
    return;
  }
  const now = () => performance.timeOrigin + performance.now();
  const rec: Recorded = {
    commits: [],
    counting: false,
    events: [],
    frames: [],
    longTasks: [],
    renders: {},
    why: {},
  };
  (window as unknown as { __bench: Recorded }).__bench = rec;
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      rec.longTasks.push({
        d: e.duration,
        t: performance.timeOrigin + e.startTime,
      });
    }
  }).observe({ buffered: true, type: "longtask" });
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      rec.events.push({
        d: e.duration,
        name: e.name,
        t: performance.timeOrigin + e.startTime,
      });
    }
  }).observe({
    durationThreshold: 16,
    type: "event",
  } as PerformanceObserverInit);
  const tick = () => {
    rec.frames.push(now());
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  // What each component was drawn with last: its hooks, or its props when it has none. Drawn
  // again, it has new ones; skipped, React keeps the very same.
  const drawnWith = new WeakMap<Fiber, unknown>();
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: inside `instrument`, as the page gets it.
  const count = (f: Fiber) => {
    const type = f.elementType;
    if (typeof type === "string" || type === null) {
      return;
    }
    const inner = type.type ?? type.render;
    const name =
      type.displayName ?? type.name ?? inner?.displayName ?? inner?.name;
    const sig = f.memoizedState ?? f.memoizedProps;
    const before =
      drawnWith.get(f) ??
      (f.alternate ? drawnWith.get(f.alternate) : undefined);
    if (name && before !== undefined && before !== sig) {
      rec.renders[name] = (rec.renders[name] ?? 0) + 1;
      let why = "props";
      let hook: Hook | null = f.memoizedState;
      let was = (
        typeof before === "object" && before && "next" in before ? before : null
      ) as Hook | null;
      for (let i = 0; hook && was; i += 1) {
        if (hook.queue !== null && hook.memoizedState !== was.memoizedState) {
          why = `hook${i}`;
          break;
        }
        hook = hook.next;
        was = was.next;
      }
      rec.why[`${name} ${why}`] = (rec.why[`${name} ${why}`] ?? 0) + 1;
    }
    if (sig !== null && typeof sig === "object") {
      drawnWith.set(f, sig);
      if (f.alternate) {
        drawnWith.set(f.alternate, sig);
      }
    }
  };
  (
    window as unknown as { __REACT_DEVTOOLS_GLOBAL_HOOK__: unknown }
  ).__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    checkDCE: () => undefined,
    inject: () => 1,
    isDisabled: false,
    onCommitFiberRoot: (_: number, root: { current: Fiber }) => {
      rec.commits.push(now());
      if (!rec.counting) {
        return;
      }
      const stack: Fiber[] = [root.current];
      while (stack.length > 0) {
        const f = stack.pop() as Fiber;
        count(f);
        if (f.sibling) {
          stack.push(f.sibling);
        }
        if (f.child) {
          stack.push(f.child);
        }
      }
    },
    onCommitFiberUnmount: () => undefined,
    onPostCommitFiberRoot: () => undefined,
    onScheduleFiberRoot: () => undefined,
    renderers: new Map(),
    supportsFiber: true,
  };
};

const pct = (values: number[], p: number) => {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[
    Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  ] as number;
};
const round = (n: number) => Math.round(n * 10) / 10;

/** A line `server-probe.mjs` writes each second. */
interface ServerLine {
  cpuMs: number;
  delayMaxMs: number;
  delayMeanMs: number;
  delayP99Ms: number;
  /** What the sample covered; absent from a probe older than this field. */
  elapsedMs?: number;
  t: number;
}

const serverLines = (from: number, to: number): ServerLine[] => {
  const dir = args["probe-dir"];
  if (!(dir && existsSync(dir))) {
    return [];
  }
  return readdirSync(dir)
    .filter((n) => n.startsWith("server-"))
    .flatMap((n) =>
      readFileSync(path.join(dir, n), "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as ServerLine)
    )
    .filter((l) => l.t > from + 1000 && l.t <= to);
};

const DIGITS_RE = /^\d+$/;

/** Clock ticks per second in `/proc/<pid>/stat`, as `getconf CLK_TCK` says on Linux. */
const TICKS = 100;

/** The CPU a thread has used, in ms, as the kernel counts it: none off Linux. */
const threadCpuMs = (pid: number, tid: number): number => {
  try {
    const stat = readFileSync(`/proc/${pid}/task/${tid}/stat`, "utf8");
    // Past the command's closing parenthesis, utime and stime are the 12th and 13th fields.
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    return ((Number(fields[11]) + Number(fields[12])) * 1000) / TICKS;
  } catch {
    // No `/proc`: the measure is left out.
    return 0;
  }
};

/** Chrome's renderers started with this run's own profile; the editor's is one of them. */
const rendererPids = (profileDir: string) => {
  if (!existsSync("/proc")) {
    return [];
  }
  return readdirSync("/proc")
    .filter((d) => DIGITS_RE.test(d))
    .flatMap((d) => {
      try {
        const cmd = readFileSync(`/proc/${d}/cmdline`, "utf8");
        return cmd.includes("--type=renderer") && cmd.includes(profileDir)
          ? [Number(d)]
          : [];
      } catch {
        // Gone since it was listed.
        return [];
      }
    });
};

/** Types into the composer, a key every 120 ms, as a person writing the next prompt. */
const typeUntil = async (page: Page, until: number) => {
  await page.getByLabel("Prompt").click();
  let i = 0;
  while (Date.now() < until) {
    // biome-ignore lint/performance/noAwaitInLoops: typing, one key after the other.
    await page.keyboard.type("abcdefghij"[i % 10] as string);
    i += 1;
    if (i % 30 === 0) {
      await page.keyboard.press("Control+A");
      await page.keyboard.press("Backspace");
    }
    await page.waitForTimeout(120);
  }
};

interface EdWindow {
  __bench: Recorded;
  __ed: {
    api: () => {
      request: (method: string, payload: unknown) => Promise<unknown>;
    };
    openCanvas: (id: string) => void;
    setView: (view: { x?: number; y?: number; zoom?: number }) => void;
    showLeftPanel: (shown: unknown) => Promise<void>;
    useProject: { getState: () => { pages: unknown[] } };
    zoomToFit: () => void;
  };
}

const main = async () => {
  const profileDir = await mkdtemp(path.join(tmpdir(), "bench-chats-"));
  const browser = await chromium.launchPersistentContext(profileDir, {
    executablePath: chromePath(),
    headless: true,
    viewport: { height: 900, width: 1600 },
  });
  const page = browser.pages()[0] ?? (await browser.newPage());
  // The chats started, stopped and deleted however the run ends: left running, they would stream
  // into the next run.
  const ids: string[] = [];
  try {
    await page.addInitScript(instrument);
    const cdp = await browser.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Emulation.setCPUThrottlingRate", {
      rate: Number(args.cpu),
    });
    // Each agent event the editor is sent names its thread; a frame may carry several.
    const agentEvents: number[] = [];
    cdp.on("Network.webSocketFrameReceived", (ev) => {
      const told = ev.response.payloadData.split('"threadId"').length - 1;
      for (let i = 0; i < told; i += 1) {
        agentEvents.push(Date.now());
      }
    });
    // A cold `pnpm dev` bundles its dependencies on the first load.
    await page.goto(`${EDITOR}/`, { timeout: 120_000 });
    await page.waitForFunction(
      () =>
        ((window as unknown as Partial<EdWindow>).__ed?.useProject.getState()
          .pages.length ?? 0) > 0,
      undefined,
      { timeout: 60_000 }
    );
    const hasLoad = await page.evaluate(async () => {
      const agents = (await (window as unknown as EdWindow).__ed
        .api()
        .request("agents.list", undefined)) as { id: string }[];
      return agents.some((a) => a.id === "load");
    });
    if (!hasLoad) {
      throw new Error(
        "The editor has no `load` agent: start it with a --user-dir whose agents/load.json runs packages/acp/testing/load-agent.mjs (see this file's header)."
      );
    }
    await page.evaluate(
      ({ canvas, view }) => {
        const ed = (window as unknown as EdWindow).__ed;
        ed.openCanvas(canvas);
        ed.zoomToFit();
        if (view === "away") {
          ed.setView({ x: -100_000, y: -100_000 });
        }
      },
      { canvas: args.canvas, view: args.view }
    );
    // One at a time, each kept as soon as it is made, so that a failure leaves none behind.
    for (let i = 0; i < AGENTS; i += 1) {
      // biome-ignore lint/performance/noAwaitInLoops: the chats in the order they are named.
      const id = await page.evaluate(
        async (title) =>
          (
            (await (window as unknown as EdWindow).__ed
              .api()
              .request("threads.create", { agentId: "load", title })) as {
              id: string;
            }
          ).id,
        `load ${i + 1}`
      );
      ids.push(id);
    }
    await page.evaluate(
      (id) => (window as unknown as EdWindow).__ed.showLeftPanel({ chat: id }),
      ids[0]
    );
    // Settled: the canvas drawn, no long task for two seconds (thirty at most).
    await page
      .waitForFunction(
        () => {
          const last = (window as unknown as EdWindow).__bench.longTasks.at(-1);
          return (
            !last ||
            performance.timeOrigin + performance.now() - (last.t + last.d) >
              2000
          );
        },
        undefined,
        { polling: 250, timeout: 30_000 }
      )
      .catch(() => undefined);

    await cdp.send("Performance.enable");
    const metrics = async () =>
      Object.fromEntries(
        (await cdp.send("Performance.getMetrics")).metrics.map((m) => [
          m.name,
          m.value,
        ])
      );
    // A renderer's main thread is its first, whose id is the process's.
    const mainCpu = () =>
      rendererPids(profileDir).reduce(
        (sum, pid) => sum + threadCpuMs(pid, pid),
        0
      );
    const windows: Record<
      string,
      { from: number; to: number; work: Record<string, number> }
    > = {};
    const measure = async (name: string, seconds: number) => {
      const before = await metrics();
      const cpuBefore = mainCpu();
      const from = Date.now();
      await typeUntil(page, from + seconds * 1000);
      const to = Date.now();
      const cpuAfter = mainCpu();
      const after = await metrics();
      const spent = (k: string) =>
        round(
          (((after[k] ?? 0) - (before[k] ?? 0)) * 1000 * 1000) / (to - from)
        );
      windows[name] = {
        from,
        to,
        work: {
          mainCpuMsPerSecond: round(
            ((cpuAfter - cpuBefore) * 1000) / (to - from)
          ),
          scriptMsPerSecond: spent("ScriptDuration"),
          taskMsPerSecond: spent("TaskDuration"),
        },
      };
    };

    await measure("quiet", QUIET_SECONDS);

    // Each agent its own node to change, round the list given.
    const targets = args.mcp?.split(",") ?? [];
    const prompts = ids.map(
      (threadId, i) =>
        [
          threadId,
          // Streaming well past the busy window, whatever the warm-up took: stopped at the end.
          `load ${SECONDS + 60} ${targets[i % targets.length] ?? "-"} ${HISTORY}`,
        ] as const
    );
    await page.evaluate(
      (sent) =>
        Promise.all(
          sent.map(([threadId, text]) =>
            (window as unknown as EdWindow).__ed
              .api()
              .request("threads.prompt", { attachments: [], text, threadId })
          )
        ),
      prompts
    );
    // Every chat's history told before the clock starts, then a moment of streaming.
    await page.waitForFunction(
      async ({ started, history }) => {
        const { api } = (window as unknown as EdWindow).__ed;
        const told = await Promise.all(
          started.map(
            async (threadId) =>
              (
                (await api().request("threads.items", { threadId })) as {
                  kind: string;
                }[]
              ).filter((i) => i.kind === "tool").length
          )
        );
        return told.every((n) => n >= history);
      },
      { history: HISTORY, started: ids },
      { polling: 500, timeout: 120_000 }
    );
    await page.waitForTimeout(2000);
    if (args.renders) {
      await page.evaluate(() => {
        (window as unknown as EdWindow).__bench.counting = true;
      });
    }
    if (args.profile) {
      await cdp.send("Profiler.enable");
      await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
      await cdp.send("Profiler.start");
    }
    const traced: unknown[] = [];
    const traceDone = new Promise<void>((resolve) => {
      cdp.on("Tracing.dataCollected", (ev) => traced.push(...ev.value));
      cdp.on("Tracing.tracingComplete", () => resolve());
    });
    if (args.trace) {
      await cdp.send("Tracing.start", {
        categories:
          "devtools.timeline,disabled-by-default-devtools.timeline,v8,blink,cc",
        transferMode: "ReportEvents",
      });
    }
    await measure("busy", SECONDS);
    if (args.trace) {
      await cdp.send("Tracing.end");
      await traceDone;
      writeFileSync(args.trace, JSON.stringify({ traceEvents: traced }));
    }
    if (args.profile) {
      const { profile } = await cdp.send("Profiler.stop");
      writeFileSync(args.profile, JSON.stringify(profile));
    }
    const rec = await page.evaluate(
      () => (window as unknown as EdWindow).__bench
    );

    const report = (name: string) => {
      const { from, to, work } = windows[name] as (typeof windows)[string];
      const inside = <T extends { t: number }>(xs: T[]) =>
        xs.filter((x) => x.t >= from && x.t < to);
      const frames = rec.frames.filter((t) => t >= from && t < to);
      const gaps = frames.slice(1).map((t, i) => t - (frames[i] as number));
      const seconds = (to - from) / 1000;
      const long = inside(rec.longTasks);
      const keys = inside(rec.events).filter((e) => e.name.startsWith("key"));
      const commits = rec.commits.filter((t) => t >= from && t < to).length;
      const events = agentEvents.filter((t) => t >= from && t < to).length;
      const server = serverLines(from, to);
      return {
        ...work,
        agentEventsPerSecond: round(events / seconds),
        commitsPerSecond: round(commits / seconds),
        fps: round(frames.length / seconds),
        frameP95Ms: round(pct(gaps, 95)),
        framesOver50ms: gaps.filter((g) => g > 50).length,
        keyP95Ms: round(
          pct(
            keys.map((k) => k.d),
            95
          )
        ),
        longTaskMsPerSecond: round(long.reduce((s, x) => s + x.d, 0) / seconds),
        ...(name === "busy" &&
          args.renders &&
          events > 0 && {
            rendersPerEvent: round(
              Object.values(rec.renders).reduce((s, n) => s + n, 0) / events
            ),
          }),
        ...(server.length > 0 && {
          // Over the time the samples covered: a late tick covers more than a second.
          serverCpuPercent: round(
            (100 * server.reduce((s, l) => s + l.cpuMs, 0)) /
              server.reduce((s, l) => s + (l.elapsedMs ?? 1000), 0)
          ),
          serverDelayP99Ms: round(Math.max(...server.map((l) => l.delayP99Ms))),
        }),
      };
    };
    // With `--mcp`, the edits the agents made and those refused: a run whose edits failed
    // measured no edits, and says so.
    const mcpEdits = args.mcp
      ? await page.evaluate(async (started) => {
          const { api } = (window as unknown as EdWindow).__ed;
          const calls = (
            await Promise.all(
              started.map(
                (threadId) =>
                  api().request("threads.items", { threadId }) as Promise<
                    { kind: string; status?: string; title?: string }[]
                  >
              )
            )
          )
            .flat()
            .filter(
              (i) => i.kind === "tool" && i.title?.endsWith("apply_operations")
            );
          return {
            done: calls.filter((c) => c.status === "completed").length,
            failed: calls.filter((c) => c.status === "failed").length,
          };
        }, ids)
      : null;
    if (mcpEdits && (mcpEdits.failed > 0 || mcpEdits.done === 0)) {
      console.error(
        `Incomplete: ${mcpEdits.failed} of the agents' page edits failed, ${mcpEdits.done} made.`
      );
      process.exitCode = 1;
    }
    const top = (counts: Record<string, number>, n: number) =>
      Object.fromEntries(
        Object.entries(counts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, n)
      );
    const result = {
      agents: AGENTS,
      busy: report("busy"),
      history: HISTORY,
      mcp: args.mcp ?? null,
      mcpEdits,
      quiet: report("quiet"),
      seconds: SECONDS,
      ...(args.renders && {
        renders: top(rec.renders, 40),
        why: top(rec.why, 40),
      }),
    };
    console.log(JSON.stringify(result, null, 2));
    if (args.out) {
      writeFileSync(args.out, JSON.stringify(result, null, 2));
    }
  } finally {
    await page
      .evaluate(
        (started) =>
          Promise.all(
            started.map(async (threadId) => {
              const { api } = (window as unknown as EdWindow).__ed;
              await api().request("threads.cancel", { threadId });
              await api().request("threads.delete", { threadId });
            })
          ),
        ids
      )
      // A chat already stopped, or gone, is what was wanted.
      .catch(() => undefined);
    await browser.close();
    await rm(profileDir, { force: true, recursive: true });
  }
};

await main();
