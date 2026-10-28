// @vitest-environment happy-dom
import type {
  FrameEvents,
  FrameRuntime,
  MountFrameOptions,
  Preview,
} from "@ultrapaint/framework-api/browser";
import { scriptedPreview } from "@ultrapaint/preview-core/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { tryNextTime } = vi.hoisted(() => ({ tryNextTime: vi.fn() }));
vi.mock("./watchdog.ts", async (original) => ({
  ...(await original<typeof import("./watchdog.ts")>()),
  tryNextTime,
}));

/** A frame the fake preview drew: its runtime, which keeps what it is asked, and its events. */
interface Drawn {
  readonly events: FrameEvents;
  readonly host: HTMLElement;
  readonly options: MountFrameOptions;
  readonly runtime: {
    readonly [K in keyof FrameRuntime]: ReturnType<typeof vi.fn> &
      FrameRuntime[K];
  };
}

/**
 * A preview that draws nothing and never touches the host, for what the module decides itself:
 * the pool, what it draws, what it hears. What the host shows is the core's, tested with the
 * real one below.
 */
const fakePreview = () => {
  const drawn: Drawn[] = [];
  const preview: Preview = {
    fromFrame: () => false,
    mountFrame: (host, options) => {
      const runtime = {
        editText: vi.fn(),
        hitTest: vi.fn((x: number, y: number) => [`at ${x},${y}`]),
        measure: vi.fn((ids: readonly string[]) =>
          Object.fromEntries(
            ids.map((id) => [id, { height: 1, width: 2, x: 3, y: 4 }])
          )
        ),
        render: vi.fn(),
        screenshot: vi.fn(() => Promise.resolve("data:image/png;base64,")),
        scrollIntoView: vi.fn(),
        show: vi.fn(),
        skeleton: vi.fn(),
        tokens: vi.fn(() => ({ "--color-primary": "red" })),
        unmount: vi.fn(),
        watchRects: vi.fn(),
      };
      drawn.push({ events: options.events, host, options, runtime });
      return runtime;
    },
    notifyHmr: () => undefined,
    onRunning: () => () => undefined,
    onStrayError: () => () => undefined,
    reportError: () => undefined,
    setComponents: () => undefined,
  };
  return { drawn, preview };
};

const root = { children: [], id: "root", type: "page" as const };
const look = { specs: [], styles: "" };
const page = { designSystem: null, look, mode: "page" as const, root };

/** The module afresh, with no frame opened or parked yet. */
const load = async () => {
  vi.resetModules();
  document.body.innerHTML = "";
  tryNextTime.mockClear();
  const frames = await import("./editor-frame.ts");
  const { useFrozen } = await import("./watchdog.ts");
  return { ...frames, useFrozen };
};

const holder = () => {
  const el = document.createElement("div");
  document.body.append(el);
  return el;
};

const only = (drawn: readonly Drawn[]): Drawn => {
  const [first] = drawn;
  if (!first || drawn.length !== 1) {
    throw new Error(`expected one frame drawn, got ${drawn.length}`);
  }
  return first;
};

let m: Awaited<ReturnType<typeof load>>;
beforeEach(async () => {
  m = await load();
});

describe("a frame opened in the editor's page", () => {
  it("puts a host in the holder, and answers at once", () => {
    const { drawn, preview } = fakePreview();
    const frame = m.frameOf("p1");
    // Asked before it is open: nothing there, without waiting.
    expect(frame.ready).toBe(false);
    expect(frame.hitTest(1, 2)).toEqual([]);
    expect(frame.measure(["n"])).toEqual({});
    const into = holder();
    const opened = frame.open({ canvas: "c", holder: into, preview });
    expect(opened?.host.parentElement).toBe(into);
    expect(only(drawn).options).toMatchObject({ canvas: "c", frame: "p1" });
    expect(frame.ready).toBe(true);
    expect(frame.hitTest(1, 2)).toEqual(["at 1,2"]);
    expect(frame.measure(["n"])).toEqual({
      n: { height: 1, width: 2, x: 3, y: 4 },
    });
    expect(frame.tokens()).toEqual({ "--color-primary": "red" });
  });

  it("is not opened while it froze the editor, and pictures try again next time", () => {
    const { drawn, preview } = fakePreview();
    m.useFrozen.setState({ frames: new Map([["stuck", undefined]]) });
    expect(
      m.frameOf("stuck").open({ canvas: "c", holder: holder(), preview })
    ).toBeNull();
    expect(tryNextTime).not.toHaveBeenCalled();
    expect(
      m.frameOf("stuck").open({
        canvas: "c",
        holder: holder(),
        preview,
        retryFrozenNextLoad: true,
      })
    ).toBeNull();
    expect(tryNextTime).toHaveBeenCalledWith("stuck");
    expect(drawn).toHaveLength(0);
    // Drawn anyway: it opens.
    m.useFrozen.setState({ frames: new Map() });
    expect(
      m.frameOf("stuck").open({ canvas: "c", holder: holder(), preview })
    ).not.toBeNull();
  });

  it("tells a frame opened later what it was asked before: rects, skeletons, how it is shown", () => {
    const { drawn, preview } = fakePreview();
    const frame = m.frameOf("p1");
    frame.watchRects(["a", "b"]);
    frame.skeleton(["s"]);
    frame.setInteractive(true);
    frame.setTitle("Home");
    frame.setAway(true);
    frame.open({ canvas: "c", className: "x", holder: holder(), preview });
    const { options, runtime } = only(drawn);
    expect(runtime.watchRects).toHaveBeenCalledWith(["a", "b"]);
    expect(runtime.skeleton).toHaveBeenCalledWith(["s"]);
    expect(options.shown).toEqual({
      away: true,
      className: "x",
      interactive: true,
      style: "",
      title: "Home",
    });
    frame.setInteractive(false);
    expect(runtime.show).toHaveBeenLastCalledWith({ interactive: false });
  });
});

describe("the host, drawn by the preview core", () => {
  const core = scriptedPreview();
  afterEach(() => {
    for (const id of opened.splice(0)) {
      m.frameOf(id).drop();
    }
  });
  const opened: string[] = [];
  /** Frame `id` of the canvas, opened in the core, drawn with `code` as its page's. */
  const openReal = (id: string, className = "block h-full w-full") => {
    opened.push(id);
    const frame = m.frameOf(id);
    const open = () =>
      frame.open({
        canvas: "c",
        className,
        holder: holder(),
        keep: true,
        preview: core.preview,
      });
    return { frame, open };
  };

  it("keeps what the page put on its <html> when a parked frame is opened again", () => {
    const { frame, open } = openReal("p1");
    const first = open();
    const host = first?.host as HTMLElement;
    core.page(() =>
      core.asPage(() => {
        document.documentElement.classList.add("dark");
        document.documentElement.style.colorScheme = "dark";
      })
    );
    frame.render(page);
    core.page(() => undefined);
    expect(host.classList.contains("dark")).toBe(true);
    // Drawn, parked and opened again: the editor shows it anew.
    first?.close();
    expect(frame.parkedAt()).not.toBeNull();
    const again = open();
    expect(again?.host).toBe(host);
    expect(host.classList.contains("dark")).toBe(true);
    expect(host.classList.contains("block")).toBe(true);
    expect(host.style.colorScheme).toBe("dark");
  });

  it("is marked with the frame's id, and shows its title and input as asked", () => {
    const { frame, open } = openReal("p2");
    frame.setTitle("Home");
    frame.setInteractive(true);
    const host = open()?.host as HTMLElement;
    expect(host.dataset.edFrameHost).toBe("p2");
    expect(host.title).toBe("Home");
    expect(host.style.pointerEvents).toBe("auto");
    // A picture: the pointer goes past it.
    frame.setInteractive(false);
    expect(host.style.pointerEvents).toBe("none");
    frame.setAway(true);
    expect(host.style.contentVisibility).toBe("hidden");
  });

  it("is where the editor's keys leave an event alone: the core's frames, not a mark", async () => {
    const { previewLoaded } = await import("./from-frame.ts");
    const { isTyping } = await import("../lib/keys.ts");
    previewLoaded(core.preview);
    const { frame, open } = openReal("p4");
    // The prototype: its page takes input.
    frame.setInteractive(true);
    const host = open()?.host as HTMLElement;
    const inside = host.shadowRoot?.querySelector("#root") as HTMLElement;
    const stray = holder();
    stray.dataset.edFrameHost = "stray";
    const typing: boolean[] = [];
    const hear = (e: Event) => typing.push(isTyping(e));
    document.addEventListener("keydown", hear);
    try {
      for (const target of [inside, stray]) {
        target.dispatchEvent(
          new KeyboardEvent("keydown", { bubbles: true, composed: true })
        );
      }
    } finally {
      document.removeEventListener("keydown", hear);
    }
    expect(typing).toEqual([true, false]);
  });

  it("keeps its size while parked, and is placed as asked when opened again", () => {
    const { frame, open } = openReal("p3");
    const first = open();
    const host = first?.host as HTMLElement;
    frame.render(page);
    first?.close();
    expect(host.style.width).toBe(`${host.offsetWidth}px`);
    open();
    expect(host.style.width).toBe("");
    expect(host.classList.contains("block")).toBe(true);
  });
});

describe("drawing", () => {
  it("does not draw again what the frame shows already", () => {
    const { drawn, preview } = fakePreview();
    const frame = m.frameOf("p1");
    frame.open({ canvas: "c", holder: holder(), preview });
    const { runtime } = only(drawn);
    const first = frame.render(page);
    expect(frame.render({ ...page })).toBe(first);
    expect(runtime.render).toHaveBeenCalledTimes(1);
    expect(runtime.render).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "page", renderId: first, root })
    );
    // Another document is drawn.
    expect(frame.render({ ...page, root: { ...root } })).toBeGreaterThan(first);
    expect(runtime.render).toHaveBeenCalledTimes(2);
  });

  it("draws what it is told once it is open, and again in a frame drawn anew", () => {
    const { drawn, preview } = fakePreview();
    const frame = m.frameOf("p1");
    // Not open: nothing to draw in, and nothing taken as shown.
    frame.render(page);
    frame.open({ canvas: "a", holder: holder(), preview });
    frame.render(page);
    frame.render(page);
    // Another canvas: the page is drawn anew, and so is what it shows.
    frame.open({ canvas: "b", holder: holder(), preview });
    frame.render(page);
    expect(drawn.map((d) => d.runtime.render.mock.calls.length)).toEqual([
      1, 1,
    ]);
    expect(drawn[0]?.runtime.unmount).toHaveBeenCalled();
  });
});

describe("what a frame says", () => {
  it("is heard by kind; ready as one listens to an open frame, and when it is opened anew", () => {
    const { drawn, preview } = fakePreview();
    const frame = m.frameOf("p1");
    const heard: string[] = [];
    const off = frame.listen({
      ready: () => heard.push("ready"),
      rects: (rects) => heard.push(`rects ${Object.keys(rects).join(",")}`),
      textCommit: (nodeId, text) => heard.push(`text ${nodeId} ${text}`),
    });
    expect(heard).toEqual([]);
    frame.open({ canvas: "c", holder: holder(), preview });
    expect(heard).toEqual(["ready"]);
    const { events } = only(drawn);
    events.rects?.({ a: { height: 1, width: 1, x: 0, y: 0 } });
    events.textCommit?.("t", "Hello");
    // A kind nobody listens for is let go of.
    events.hmr?.();
    expect(heard).toEqual(["ready", "rects a", "text t Hello"]);
    const late: string[] = [];
    frame.listen({ ready: () => late.push("ready") });
    expect(late).toEqual(["ready"]);
    off();
    events.textCommit?.("t", "Again");
    expect(heard).toHaveLength(3);
  });

  it("says which render it drew last, whoever listens", () => {
    const { drawn, preview } = fakePreview();
    const frame = m.frameOf("p1");
    frame.open({ canvas: "c", holder: holder(), preview });
    const id = frame.render(page);
    expect(frame.renderedId).toBeLessThan(id);
    only(drawn).events.rendered?.(id);
    expect(frame.renderedId).toBe(id);
  });
});

describe("the pool", () => {
  it("parks a kept frame that drew, and gives it back as it was", () => {
    const { drawn, preview } = fakePreview();
    const frame = m.frameOf("p1");
    const changes = vi.fn();
    m.onPoolChange(changes);
    const opened = frame.open({
      canvas: "c",
      holder: holder(),
      keep: true,
      preview,
    });
    const { events, host, runtime } = only(drawn);
    expect(m.isWarm("p1")).toBe(false);
    events.rendered?.(frame.render(page));
    expect(m.isWarm("p1")).toBe(true);
    expect(host.dataset.edDrawn).toBe("");
    expect(changes).toHaveBeenCalledTimes(1);
    frame.watchRects(["a"]);
    opened?.close();
    // Parked, out of sight, and still drawn.
    expect(host.parentElement?.dataset.previewParking).toBe("");
    expect(runtime.unmount).not.toHaveBeenCalled();
    expect(frame.parkedAt()).not.toBeNull();
    const back = holder();
    const again = frame.open({
      canvas: "c",
      holder: back,
      keep: true,
      preview,
    });
    expect(again?.host).toBe(host);
    expect(host.parentElement).toBe(back);
    expect(drawn).toHaveLength(1);
    // What it shows it is not told again.
    frame.render(page);
    expect(runtime.render).toHaveBeenCalledTimes(1);
  });

  it("throws away a frame closed before it drew, and one not kept", () => {
    const { drawn, preview } = fakePreview();
    m.frameOf("loading")
      .open({ canvas: "c", holder: holder(), keep: true, preview })
      ?.close();
    const surface = m.frameOf("surface");
    const opened = surface.open({ canvas: "c", holder: holder(), preview });
    drawn[1]?.events.rendered?.(surface.render(page));
    opened?.close();
    for (const d of drawn) {
      expect(d.runtime.unmount).toHaveBeenCalledTimes(1);
      expect(d.host.isConnected).toBe(false);
    }
    expect(m.frameOf("loading").ready).toBe(false);
    expect(surface.ready).toBe(false);
  });

  it("replays what a frame watches to the one drawn after it was thrown away", () => {
    const { drawn, preview } = fakePreview();
    const frame = m.frameOf("p1");
    frame.open({ canvas: "c", holder: holder(), preview })?.close();
    frame.watchRects(["a"]);
    frame.skeleton(["s"]);
    frame.open({ canvas: "c", holder: holder(), preview });
    expect(drawn).toHaveLength(2);
    expect(drawn[1]?.runtime.watchRects).toHaveBeenCalledWith(["a"]);
    expect(drawn[1]?.runtime.skeleton).toHaveBeenCalledWith(["s"]);
  });

  it("takes a frame from another preview or canvas as a new one, and an old close does nothing", () => {
    const { drawn, preview } = fakePreview();
    const other = fakePreview();
    const frame = m.frameOf("p1");
    const first = frame.open({
      canvas: "c",
      holder: holder(),
      keep: true,
      preview,
    });
    frame.open({
      canvas: "c",
      holder: holder(),
      keep: true,
      preview: other.preview,
    });
    expect(only(drawn).runtime.unmount).toHaveBeenCalled();
    first?.close();
    expect(frame.ready).toBe(true);
    expect(only(other.drawn).runtime.unmount).not.toHaveBeenCalled();
  });

  it("keeps 32 parked frames, the one not seen for longest going first", () => {
    const { drawn, preview } = fakePreview();
    expect(m.PARKED_MAX).toBe(32);
    for (let i = 0; i <= m.PARKED_MAX; i += 1) {
      const frame = m.frameOf(`f${i}`);
      const opened = frame.open({
        canvas: "c",
        holder: holder(),
        keep: true,
        preview,
      });
      drawn[i]?.events.rendered?.(frame.render(page));
      opened?.close();
    }
    expect(drawn[0]?.runtime.unmount).toHaveBeenCalled();
    expect(m.isWarm("f0")).toBe(false);
    expect(
      drawn.slice(1).every((d) => d.runtime.unmount.mock.calls.length === 0)
    ).toBe(true);
  });

  it("does not let a frame that never says it drew hold the queue", () => {
    vi.useFakeTimers();
    try {
      const { preview } = fakePreview();
      m.frameOf("p1").open({
        canvas: "c",
        holder: holder(),
        keep: true,
        preview,
      });
      vi.advanceTimersByTime(10_000);
      expect(m.isWarm("p1")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
