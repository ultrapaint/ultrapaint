/// <reference lib="dom" />
/**
 * `pnpm bench:canvas`: how the canvas holds up with many screens on it, measured in a headless
 * Chrome against a running `pnpm dev`. It drives the editor the way a person does (wheel events on
 * the canvas, the store's own actions) and reports:
 *
 * - load: every frame of the canvas fitted on screen, from a fresh browser profile, until each
 *   preview has drawn;
 * - pan: across the canvas at 50% and back, with how busy the editor's main thread was, the
 *   frame times, and how long each screen stayed blank once on screen;
 * - zoom: in and out at the fitted view, with the editor's main thread and the frames React drew;
 * - goto: zooming to the page at the far end, until it has drawn;
 * - switch: to another canvas and back, until every screen on view has drawn;
 * - layers: opening the Layers panel, then selecting and hovering nodes with it open;
 * - memory: what the browser's processes hold at the end.
 *
 *   pnpm bench:canvas [--url http://127.0.0.1:4601] [--canvas redesign] [--other samples]
 *     [--scenarios load,pan,zoom,goto,switch,layers] [--out result.json] [--chrome /path/to/chrome]
 *
 * Without `--url` it finds the editor where `pnpm dev` puts it for this checkout.
 */
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  type BrowserContext,
  type CDPSession,
  chromium,
  type Page,
} from "playwright-core";

const { values: args } = parseArgs({
  options: {
    canvas: { default: "redesign", type: "string" },
    // The captures experiment (PLAN-editor-renderer Phase 6): frames drawn from captures.
    captures: { default: false, type: "boolean" },
    chrome: { type: "string" },
    other: { default: "samples", type: "string" },
    out: { type: "string" },
    scenarios: { type: "string" },
    url: { type: "string" },
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
const CANVAS = args.canvas;
const OTHER = args.other;
const SCENARIOS = new Set(
  (args.scenarios ?? "load,pan,zoom,goto,switch,layers")
    .split(",")
    .map((s) => s.trim())
);

const chromePath = () => {
  const candidates = [
    args.chrome,
    process.env.CHROME_PATH,
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ];
  const found = candidates.find((c) => c && existsSync(c));
  if (!found) {
    throw new Error("No Chrome found: pass --chrome or set CHROME_PATH.");
  }
  return found;
};

interface Box {
  height: number;
  width: number;
  x: number;
  y: number;
}
interface View {
  x: number;
  y: number;
  zoom: number;
}

interface TreeNode {
  children?: TreeNode[];
  id: string;
}

/** What the page under test offers the bench: the editor's dev handle and what is recorded. */
interface BenchWindow {
  __bench: {
    frameRenders: number;
    longTasks: { d: number; t: number }[];
    messages: { frame: string; t: number; type: string }[];
  };
  __ed: {
    openCanvas: (id: string) => void;
    useDocuments: {
      getState: () => {
        docs: Record<string, { root?: TreeNode | null }>;
      };
    };
    useEditor: {
      getState: () => {
        canvas: string | null;
        frames: Record<string, Box>;
        select: (s: { frame: string; nodeId: string } | null) => void;
        setHover: (s: { frame: string; nodeId: string } | null) => void;
        setLeftTab: (tab: string) => void;
        setView: (v: Partial<View>) => void;
        view: View;
        zoomToFit: (v: Box) => void;
      };
    };
    useProject: {
      getState: () => { pages: { canvas: string; id: string }[] };
    };
    zoomToPage: (page: unknown) => void;
  };
}

/**
 * Runs in the editor before the app does: records what the previews say (stamped with their
 * frame; `ed:ready` is a document loaded), long tasks, and how many times React drew a `Frame`.
 */
const instrument = () => {
  if (window.top !== window) {
    return;
  }
  const now = () => performance.timeOrigin + performance.now();
  const bench: BenchWindow["__bench"] = {
    frameRenders: 0,
    longTasks: [],
    messages: [],
  };
  (window as unknown as BenchWindow).__bench = bench;
  // What the frames say, which their bridges dispatch for this in development (ADR 0034).
  window.addEventListener("ed:frame", (ev) => {
    const { frame, type } = (ev as CustomEvent<{ frame: string; type: string }>)
      .detail;
    bench.messages.push({ frame, t: now(), type });
  });
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      bench.longTasks.push({
        d: e.duration,
        t: performance.timeOrigin + e.startTime,
      });
    }
  }).observe({ buffered: true, type: "longtask" });
  // A stand-in for React DevTools: counts the commits in which a `Frame` drew again.
  const seen = new Map<string, unknown>();
  interface Fiber {
    child: Fiber | null;
    elementType: { displayName?: string; name?: string } | null;
    memoizedProps: { frameId?: string } | null;
    memoizedState: unknown;
    sibling: Fiber | null;
  }
  (
    window as unknown as { __REACT_DEVTOOLS_GLOBAL_HOOK__: unknown }
  ).__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    checkDCE: () => undefined,
    inject: () => 1,
    isDisabled: false,
    onCommitFiberRoot: (_: number, root: { current: Fiber }) => {
      const stack: Fiber[] = [root.current];
      while (stack.length > 0) {
        const f = stack.pop() as Fiber;
        const type = f.elementType;
        const name = type?.displayName ?? type?.name;
        const id = f.memoizedProps?.frameId;
        if (name === "Frame" && id && seen.get(id) !== f.memoizedState) {
          seen.set(id, f.memoizedState);
          bench.frameRenders += 1;
        }
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

const stats = (values: number[]) => {
  if (values.length === 0) {
    return null;
  }
  const s = [...values].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  const round = (n: number | undefined) => Math.round((n ?? 0) * 10) / 10;
  return {
    max: round(s.at(-1)),
    n: s.length,
    p50: round(q(0.5)),
    p95: round(q(0.95)),
  };
};

const PS_LINE = /^(\d+)\s+(\d+)\s+(.*)$/;
const PSS = /^Pss:\s+(\d+)/m;

/** The renderer processes of a profile and what they hold (Linux: PSS from /proc). */
const memoryOf = (profile: string) => {
  if (process.platform !== "linux") {
    return null;
  }
  const rows = execSync("ps -eo pid=,ppid=,args=", {
    maxBuffer: 64 * 1024 * 1024,
  })
    .toString()
    .trim()
    .split("\n")
    .map((line) => {
      const [, pid, ppid, cmd] = line.trim().match(PS_LINE) ?? [];
      return { cmd: cmd ?? "", pid: Number(pid), ppid: Number(ppid) };
    });
  const root = rows.find(
    (r) =>
      r.cmd.includes(`--user-data-dir=${profile}`) && !r.cmd.includes("--type=")
  );
  if (!root) {
    return null;
  }
  const all = [root];
  // The list grows as it is walked: each process's children join it.
  for (const p of all) {
    all.push(...rows.filter((r) => r.ppid === p.pid));
  }
  const pss = (pid: number) => {
    try {
      const text = readFileSync(`/proc/${pid}/smaps_rollup`, "utf8");
      return Number(text.match(PSS)?.[1] ?? 0) / 1024;
    } catch {
      // The process went away while it was being read.
      return 0;
    }
  };
  const renderers = all.filter((r) => r.cmd.includes("--type=renderer"));
  return {
    rendererPssMB: Math.round(renderers.reduce((a, r) => a + pss(r.pid), 0)),
    renderers: renderers.length,
    totalPssMB: Math.round(all.reduce((a, r) => a + pss(r.pid), 0)),
  };
};

interface TraceEvent {
  args?: {
    data?: { frames?: { frame: string; parent?: string; processId: number }[] };
    name?: string;
  };
  dur?: number;
  name: string;
  ph: string;
  pid: number;
  tid: number;
  ts: number;
}

/** Records a trace around `run`. */
const traced = async <T>(cdp: CDPSession, record: () => Promise<T>) => {
  const events: TraceEvent[] = [];
  const onData = (d: { value: object[] }) =>
    events.push(...(d.value as TraceEvent[]));
  cdp.on("Tracing.dataCollected", onData);
  await cdp.send("Tracing.start", {
    categories:
      "devtools.timeline,disabled-by-default-devtools.timeline,toplevel,blink.user_timing",
    transferMode: "ReportEvents",
  });
  const result = await record();
  const done = new Promise((resolve) =>
    cdp.once("Tracing.tracingComplete", resolve)
  );
  await cdp.send("Tracing.end");
  await done;
  cdp.off("Tracing.dataCollected", onData);
  return { events, result };
};

/** How busy the editor's main thread was between the `bench-start` and `bench-end` marks. */
const mainThread = (events: TraceEvent[]) => {
  const started = events.find((e) => e.name === "TracingStartedInBrowser");
  const frames = started?.args?.data?.frames ?? [];
  const pid = frames.find((f) => !f.parent)?.processId;
  const threads = new Map<string, string>();
  for (const e of events) {
    if (e.ph === "M" && e.name === "thread_name") {
      threads.set(`${e.pid}:${e.tid}`, e.args?.name ?? "");
    }
  }
  const t0 = events.find((e) => e.name === "bench-start")?.ts ?? 0;
  const t1 = events.find((e) => e.name === "bench-end")?.ts ?? 0;
  const tasks = events.filter(
    (e) =>
      e.ph === "X" &&
      e.pid === pid &&
      e.name === "ThreadControllerImpl::RunTask" &&
      e.ts >= t0 &&
      e.ts <= t1 &&
      threads.get(`${e.pid}:${e.tid}`) === "CrRendererMain"
  );
  const busy = tasks.reduce((a, e) => a + (e.dur ?? 0), 0) / 1000;
  const wall = (t1 - t0) / 1000;
  const main = events
    .filter(
      (e) =>
        e.ph === "X" &&
        e.pid === pid &&
        e.ts >= t0 &&
        e.ts <= t1 &&
        threads.get(`${e.pid}:${e.tid}`) === "CrRendererMain"
    )
    .sort((a, b) => a.ts - b.ts);
  /** Milliseconds spent in these events, counting nested ones once. */
  const spent = (names: readonly string[]) => {
    let end = -1;
    let sum = 0;
    for (const e of main) {
      if (names.includes(e.name) && e.ts >= end) {
        end = e.ts + (e.dur ?? 0);
        sum += e.dur ?? 0;
      }
    }
    return Math.round(sum / 1000);
  };
  return {
    busyPct: wall > 0 ? Math.round((busy / wall) * 100) : 0,
    longestTaskMs: Math.round(
      Math.max(0, ...tasks.map((e) => e.dur ?? 0)) / 1000
    ),
    ms: {
      layout: spent(["Layout"]),
      paint: spent(["Paint", "PrePaint", "Layerize", "UpdateLayer"]),
      script: spent([
        "FunctionCall",
        "EvaluateScript",
        "TimerFire",
        "FireAnimationFrame",
        "EventDispatch",
        "RunMicrotasks",
      ]),
      style: spent(["UpdateLayoutTree", "RecalculateStyles"]),
    },
  };
};

const launch = async () => {
  const profile = await mkdtemp(path.join(tmpdir(), "bench-canvas-"));
  const context = await chromium.launchPersistentContext(profile, {
    args: [
      "--disable-renderer-backgrounding",
      "--disable-background-timer-throttling",
    ],
    executablePath: chromePath(),
    headless: true,
    viewport: { height: 1000, width: 1600 },
  });
  const page = context.pages()[0] ?? (await context.newPage());
  await page.addInitScript(instrument);
  // A page loaded again mid-run measures nothing: said, so it is not taken for a slow canvas.
  let loads = 0;
  page.on("load", () => {
    loads += 1;
    if (loads > 1) {
      console.warn(`\nthe editor loaded again (${loads})`);
    }
  });
  return { context, page, profile };
};

const open = async (page: Page, canvas: string) => {
  await page.goto(
    `${EDITOR}/?canvas=${canvas}${args.captures ? "&captures=1" : "&captures=0"}`,
    { waitUntil: "load" }
  );
  await page.waitForFunction(
    (c) => {
      const ed = (window as unknown as Partial<BenchWindow>).__ed;
      const s = ed?.useEditor.getState();
      return s?.canvas === c && Object.keys(s.frames).length > 0;
    },
    canvas,
    { timeout: 60_000 }
  );
  const notNow = page.getByRole("button", { name: "Not now" });
  if (await notNow.count()) {
    await notNow.first().click();
  }
};

/** The part of the canvas the side cards leave free, as `zoomToFit` takes it. */
const viewport = (page: Page) =>
  page.evaluate(() => {
    const el = document.querySelector("[data-canvas]") as HTMLElement;
    return { height: el.clientHeight, width: el.clientWidth, x: 0, y: 0 };
  });

const now = (page: Page) =>
  page.evaluate(() => performance.timeOrigin + performance.now());

/** The frames with a preview on the canvas. */
const mounted = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("[data-canvas] [data-frame]")]
      .filter((f) => f.querySelector("[data-ed-frame-host]"))
      .map((f) => f.getAttribute("data-frame") ?? "")
  );

/**
 * Waits until every frame in `ids` shows its preview drawn: a host, and an `ed:rendered` from it
 * since it was put there. Answers how long after `since` the last one was, 0 when all already
 * were, or null on a timeout.
 */
const untilLive = async (
  page: Page,
  ids: string[],
  since: number,
  timeout = 60_000
) => {
  const liveAt = () =>
    page.evaluate((frameIds) => {
      const b = (window as unknown as BenchWindow).__bench;
      const at = frameIds.map((id) => {
        const frame = document.querySelector(
          `[data-canvas] [data-frame="${CSS.escape(id)}"]`
        );
        if (!frame?.querySelector("[data-ed-frame-host]")) {
          return null;
        }
        // Since its document last loaded: a preview moved back from where it was kept
        // shows what it drew before.
        const loaded =
          b.messages.findLast((m) => m.frame === id && m.type === "ed:ready")
            ?.t ?? 0;
        // A frame drawn in the editor's page and taken back from the pool shows what it drew
        // as it is placed, and is not drawn again when nothing changed.
        if (frame.querySelector("[data-ed-drawn]") && loaded > 0) {
          return loaded;
        }
        return (
          b.messages.find(
            (m) => m.frame === id && m.type === "ed:rendered" && m.t >= loaded
          )?.t ?? null
        );
      });
      return at.some((t) => t === null)
        ? null
        : Math.max(0, ...(at as number[]));
    }, ids);
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    // biome-ignore lint/performance/noAwaitInLoops: polling, one look at a time.
    const at = await liveAt();
    if (at !== null) {
      return Math.max(0, Math.round(at - since));
    }
    await page.waitForTimeout(50);
  }
  return null;
};

/** The frames whose box is on screen at the current view. */
const onScreen = (page: Page) =>
  page.evaluate(() => {
    const s = (window as unknown as BenchWindow).__ed.useEditor.getState();
    const el = document.querySelector("[data-canvas]") as HTMLElement;
    const { x, y, zoom } = s.view;
    return Object.entries(s.frames)
      .filter(([, f]) => {
        const left = f.x * zoom + x;
        const top = f.y * zoom + y;
        return (
          left + f.width * zoom > 0 &&
          top + f.height * zoom > 0 &&
          left < el.clientWidth &&
          top < el.clientHeight
        );
      })
      .map(([id]) => id);
  });

interface Gesture {
  /** Pan: where `view.x` goes, from where it is. */
  readonly dx?: number;
  readonly ms: number;
  /** Zoom: how far in it goes before coming back out (1.3 is 30% closer). */
  readonly zoomTo?: number;
}

/**
 * Plays a pan or a zoom as wheel events on the canvas, one per animation frame, the way a
 * trackpad sends them. Answers the frame times and, for each frame that came on screen during the
 * gesture, when it did and whether it was drawn by then.
 */
const gesture = (page: Page, input: Gesture) =>
  page.evaluate(
    (g) =>
      new Promise<{
        deltas: number[];
        entered: Record<string, { live: boolean; t: number }>;
      }>((resolve) => {
        const w = window as unknown as BenchWindow;
        const el = document.querySelector("[data-canvas]") as HTMLElement;
        const rect = el.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const z0 = w.__ed.useEditor.getState().view.zoom;
        const deltas: number[] = [];
        const entered: Record<string, { live: boolean; t: number }> = {};
        const visible = new Set<string>();
        const liveNow = (id: string) => {
          const b = w.__bench;
          const frame = document.querySelector(
            `[data-canvas] [data-frame="${CSS.escape(id)}"]`
          );
          // A frame keeps what it drew while it was away.
          if (frame?.querySelector("[data-ed-drawn]")) {
            return true;
          }
          if (!frame?.querySelector("[data-ed-frame-host]")) {
            return false;
          }
          const loaded = b.messages.findLast(
            (m) => m.frame === id && m.type === "ed:ready"
          );
          return b.messages.some(
            (m) =>
              m.frame === id &&
              m.type === "ed:rendered" &&
              m.t >= (loaded?.t ?? 0)
          );
        };
        const track = (t: number) => {
          const s = w.__ed.useEditor.getState();
          const { x, y, zoom } = s.view;
          for (const [id, f] of Object.entries(s.frames)) {
            const left = f.x * zoom + x;
            const top = f.y * zoom + y;
            const on =
              left + f.width * zoom > 0 &&
              top + f.height * zoom > 0 &&
              left < rect.width &&
              top < rect.height;
            if (on && !visible.has(id) && !(id in entered)) {
              entered[id] = { live: liveNow(id), t };
            }
            if (on) {
              visible.add(id);
            } else {
              visible.delete(id);
            }
          }
        };
        for (const id of Object.keys(w.__ed.useEditor.getState().frames)) {
          // What is on screen before the gesture does not come on screen during it.
          const s = w.__ed.useEditor.getState();
          const f = s.frames[id] as Box;
          const left = f.x * s.view.zoom + s.view.x;
          const top = f.y * s.view.zoom + s.view.y;
          if (
            left + f.width * s.view.zoom > 0 &&
            top + f.height * s.view.zoom > 0 &&
            left < rect.width &&
            top < rect.height
          ) {
            visible.add(id);
          }
        }
        let start: number | null = null;
        let last: number | null = null;
        let sentX = 0;
        let zoomed = z0;
        performance.mark("bench-start");
        const tick = (ts: number) => {
          if (last !== null) {
            deltas.push(ts - last);
          }
          last = ts;
          start ??= ts;
          const k = Math.min(1, (ts - start) / g.ms);
          if (g.dx !== undefined) {
            const want = g.dx * k;
            el.dispatchEvent(
              new WheelEvent("wheel", {
                bubbles: true,
                cancelable: true,
                clientX: cx,
                clientY: cy,
                deltaX: -(want - sentX),
              })
            );
            sentX = want;
          } else if (g.zoomTo !== undefined) {
            const want = z0 * (1 + (g.zoomTo - 1) * Math.sin(Math.PI * k));
            el.dispatchEvent(
              new WheelEvent("wheel", {
                bubbles: true,
                cancelable: true,
                clientX: cx,
                clientY: cy,
                ctrlKey: true,
                deltaY: -Math.log(want / zoomed) / 0.01,
              })
            );
            zoomed = want;
          }
          track(performance.timeOrigin + ts);
          if (k < 1) {
            requestAnimationFrame(tick);
          } else {
            performance.mark("bench-end");
            resolve({ deltas, entered });
          }
        };
        requestAnimationFrame(tick);
      }),
    input
  );

/**
 * For each frame that came on screen, how long it stayed blank: until its preview drew, or none
 * at all when it was drawn (or showed a picture of itself) as it came.
 */
const blankAfter = async (
  page: Page,
  came: Record<string, { live: boolean; t: number }>
) => {
  await page.waitForTimeout(6000);
  return page.evaluate((entered) => {
    const b = (window as unknown as BenchWindow).__bench;
    return Object.entries(entered).map(([id, e]) => {
      if (e.live) {
        return 0;
      }
      const drew = b.messages.find(
        (m) => m.frame === id && m.type === "ed:rendered" && m.t >= e.t
      );
      return drew ? Math.round(drew.t - e.t) : 6000;
    });
  }, came);
};

const fitAll = async (page: Page) => {
  const box = await viewport(page);
  await page.evaluate(
    (vp) =>
      (window as unknown as BenchWindow).__ed.useEditor
        .getState()
        .zoomToFit(vp),
    box
  );
};

const setView = (page: Page, to: Partial<View>) =>
  page.evaluate(
    (v) =>
      (window as unknown as BenchWindow).__ed.useEditor.getState().setView(v),
    to
  );

const resetCounts = (page: Page) =>
  page.evaluate(() => {
    const b = (window as unknown as BenchWindow).__bench;
    b.frameRenders = 0;
    b.longTasks = [];
  });

const counts = (page: Page, from: number) =>
  page.evaluate((since) => {
    const b = (window as unknown as BenchWindow).__bench;
    return {
      frameRenders: b.frameRenders,
      // Documents loaded in a preview: what a frame shown again costs when it was not kept.
      previewLoads: b.messages.filter(
        (m) => m.type === "ed:ready" && m.t >= since
      ).length,
    };
  }, from);

const frameTimes = (deltas: number[]) => ({
  ...stats(deltas),
  over33ms: deltas.filter((d) => d > 33.4).length,
});

type Result = Record<string, unknown>;

const benchLoad = async (page: Page): Promise<Result> => {
  const t0 = await now(page);
  await fitAll(page);
  const ids = await onScreen(page);
  const allDrawnMs = await untilLive(page, ids, t0);
  const each = await Promise.all(ids.map((id) => untilLive(page, [id], t0)));
  return {
    allDrawnMs,
    frames: ids.length,
    perFrameMs: stats(each.filter((n) => n !== null)),
  };
};

/** The view that puts the first row's left end at the left at 50%, and how far the row goes. */
const row = (page: Page) =>
  page.evaluate(() => {
    const s = (window as unknown as BenchWindow).__ed.useEditor.getState();
    const el = document.querySelector("[data-canvas]") as HTMLElement;
    const frames = Object.values(s.frames);
    const top = Math.min(...frames.map((f) => f.y));
    const first = frames.filter((f) => f.y < top + 200);
    const left = Math.min(...first.map((f) => f.x));
    const right = Math.max(...first.map((f) => f.x + f.width));
    const zoom = 0.5;
    const start = { x: 420 - left * zoom, y: 80 - top * zoom, zoom };
    return { dx: -(right * zoom - left * zoom - el.clientWidth + 520), start };
  });

const benchPan = async (page: Page, cdp: CDPSession): Promise<Result> => {
  const { dx, start } = await row(page);
  await setView(page, start);
  await untilLive(page, await onScreen(page), 0);
  await page.waitForTimeout(2000);
  const passes: Result[] = [];
  for (const [label, by] of [
    ["across", dx],
    ["back", -dx],
    ["across again", dx],
  ] as const) {
    // biome-ignore lint/performance/noAwaitInLoops: each starts where the last one ended.
    await resetCounts(page);
    const since = await now(page);
    const { events, result } = await traced(cdp, () =>
      gesture(page, { dx: by, ms: 2000 })
    );
    const blank = await blankAfter(page, result.entered);
    passes.push({
      label,
      ...mainThread(events),
      blankMs: stats(blank),
      frames: frameTimes(result.deltas),
      ...(await counts(page, since)),
    });
  }
  return { passes };
};

const benchZoom = async (page: Page, cdp: CDPSession): Promise<Result> => {
  await fitAll(page);
  await untilLive(page, await onScreen(page), 0);
  await page.waitForTimeout(2000);
  await resetCounts(page);
  const since = await now(page);
  const { events, result } = await traced(cdp, () =>
    gesture(page, { ms: 2000, zoomTo: 1.6 })
  );
  return {
    ...mainThread(events),
    frames: frameTimes(result.deltas),
    ...(await counts(page, since)),
  };
};

const benchGoto = async (page: Page): Promise<Result> => {
  const goTo = (pageId: string) =>
    page.evaluate((id) => {
      const ed = (window as unknown as BenchWindow).__ed;
      const target = ed.useProject.getState().pages.find((p) => p.id === id);
      ed.zoomToPage(target);
    }, pageId);
  const ids = await page.evaluate(() => {
    const s = (window as unknown as BenchWindow).__ed.useEditor.getState();
    return Object.entries(s.frames)
      .sort(([, a], [, b]) => a.x + a.y - (b.x + b.y))
      .map(([id]) => id);
  });
  const first = ids[0] as string;
  const last = ids.at(-1) as string;
  const runs: Result[] = [];
  for (const [from, to] of [
    [first, last],
    [last, first],
    [first, last],
  ] as const) {
    // biome-ignore lint/performance/noAwaitInLoops: each starts where the last one ended.
    await goTo(from);
    await untilLive(page, [from], 0);
    await page.waitForTimeout(1500);
    await resetCounts(page);
    const since = await now(page);
    await goTo(to);
    const untilDrawnMs = await untilLive(page, [to], since, 30_000);
    await page.waitForTimeout(1000);
    runs.push({
      to,
      untilDrawnMs,
      ...(await counts(page, since)),
    });
  }
  return { runs };
};

const benchSwitch = async (page: Page): Promise<Result> => {
  const has = await page.evaluate(
    (other) =>
      (window as unknown as BenchWindow).__ed.useProject
        .getState()
        .pages.some((p) => p.canvas === other),
    OTHER
  );
  if (!has) {
    return { skipped: `no canvas ${OTHER}` };
  }
  const runs: Result[] = [];
  for (const canvas of [OTHER, CANVAS, OTHER, CANVAS]) {
    // biome-ignore lint/performance/noAwaitInLoops: each starts where the last one ended.
    await resetCounts(page);
    const since = await now(page);
    await page.evaluate(
      (to) => (window as unknown as BenchWindow).__ed.openCanvas(to),
      canvas
    );
    await page.waitForFunction(
      (to) =>
        (window as unknown as BenchWindow).__ed.useEditor.getState().canvas ===
        to,
      canvas
    );
    await page.waitForTimeout(300);
    const ids = await onScreen(page);
    const allDrawnMs = await untilLive(page, ids, since);
    await page.waitForTimeout(1500);
    const stray = await page.evaluate(
      ({ start, shown }) => {
        const b = (window as unknown as BenchWindow).__bench;
        // Previews loaded for frames not on screen: the canvas drew a view it was leaving.
        return b.messages.filter(
          (m) =>
            m.type === "ed:ready" && m.t >= start && !shown.includes(m.frame)
        ).length;
      },
      { shown: ids, start: since }
    );
    runs.push({
      allDrawnMs,
      onScreen: ids.length,
      strayLoads: stray,
      to: canvas,
      ...(await counts(page, since)),
    });
  }
  return { runs };
};

/**
 * The Layers panel: opening it on the canvas, then selecting nodes of its pages one after the
 * other and hovering others, each timed until the frame after it is drawn.
 */
const benchLayers = async (page: Page, cdp: CDPSession): Promise<Result> => {
  const { events, result } = await traced(cdp, () =>
    page.evaluate(async (canvas) => {
      const w = window as unknown as BenchWindow;
      const editor = () => w.__ed.useEditor.getState();
      const drawn = () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => setTimeout(resolve, 0))
        );
      const time = async (change: () => void) => {
        const t = performance.now();
        change();
        await drawn();
        return performance.now() - t;
      };
      const targets: { frame: string; nodeId: string }[] = [];
      const walk = (frame: string, node: TreeNode, depth: number) => {
        if (depth > 0) {
          targets.push({ frame, nodeId: node.id });
        }
        for (const child of node.children ?? []) {
          walk(frame, child, depth + 1);
        }
      };
      for (const [frame, doc] of Object.entries(
        w.__ed.useDocuments.getState().docs
      )) {
        if (frame.startsWith(`${canvas}/`) && doc.root) {
          walk(frame, doc.root, 0);
        }
      }
      // Spread over the canvas: every page, deep and shallow nodes.
      const stride = Math.max(1, Math.floor(targets.length / 12));
      const picked = targets.filter((_t, i) => i % stride === 0).slice(0, 12);
      performance.mark("bench-start");
      const opened = performance.now();
      editor().setLeftTab("layers");
      while (
        document.querySelector('[role="treeitem"]') === null &&
        performance.now() - opened < 20_000
      ) {
        // biome-ignore lint/performance/noAwaitInLoops: waiting for the panel to draw its rows.
        await drawn();
      }
      const openMs = performance.now() - opened;
      const inDom = document.querySelectorAll('[role="treeitem"]').length;
      const select: number[] = [];
      for (const target of picked) {
        // biome-ignore lint/performance/noAwaitInLoops: one change at a time, as a person makes them.
        select.push(await time(() => editor().select(target)));
      }
      const hover: number[] = [];
      for (const target of picked) {
        // biome-ignore lint/performance/noAwaitInLoops: one change at a time, as a person makes them.
        hover.push(await time(() => editor().setHover(target)));
      }
      performance.mark("bench-end");
      editor().select(null);
      editor().setHover(null);
      editor().setLeftTab("chat");
      return {
        hover,
        nodes: targets.length,
        open: openMs,
        rows: inDom,
        select,
      };
    }, CANVAS)
  );
  const { busyPct: _, ...thread } = mainThread(events);
  return {
    ...thread,
    hoverMs: stats(result.hover),
    nodes: result.nodes,
    openMs: Math.round(result.open),
    rowsInDom: result.rows,
    selectMs: stats(result.select),
  };
};

const run = async () => {
  const results: Record<string, unknown> = {
    at: new Date().toISOString(),
    canvas: CANVAS,
    editor: EDITOR,
  };
  const { context, page, profile } = await launch();
  const cdp = await (page.context() as BrowserContext).newCDPSession(page);
  const step = async (name: string, fn: () => Promise<Result>) => {
    if (!SCENARIOS.has(name)) {
      return;
    }
    process.stdout.write(`${name}… `);
    results[name] = await fn();
    console.log(JSON.stringify(results[name]));
  };
  try {
    await open(page, CANVAS);
    // Away from every frame, so the load starts from nothing.
    await setView(page, { x: 1e6, y: 1e6, zoom: 1 });
    await page.waitForTimeout(1500);
    await step("load", () => benchLoad(page));
    await step("pan", () => benchPan(page, cdp));
    await step("zoom", () => benchZoom(page, cdp));
    await step("goto", () => benchGoto(page));
    await step("switch", () => benchSwitch(page));
    await step("layers", () => benchLayers(page, cdp));
    await fitAll(page);
    await page.waitForTimeout(3000);
    results.mounted = (await mounted(page)).length;
    results.memory = memoryOf(profile);
    console.log(
      `memory ${JSON.stringify(results.memory)}, ${results.mounted} frames drawn`
    );
  } finally {
    await context.close();
    await rm(profile, { force: true, recursive: true });
  }
  if (args.out) {
    writeFileSync(args.out, `${JSON.stringify(results, null, 2)}\n`);
    console.log(`written to ${args.out}`);
  }
};

await run();
