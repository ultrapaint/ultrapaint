// @vitest-environment happy-dom
import "../testing/fake-browser.ts";
import {
  failOpening,
  noteLine,
  type Opening,
  openingSteps,
  reachStep,
} from "@ultrapaint/contracts/opening";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpeningSplash, type OpeningSplashProps } from "./opening-splash.tsx";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = 1_800_000_000_000;

let root: Root | null = null;

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  document.body.innerHTML = '<div id="root"></div>';
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  vi.useRealTimers();
});

const show = (props: OpeningSplashProps) =>
  act(() => {
    root = createRoot(document.getElementById("root") as HTMLElement);
    root.render(<OpeningSplash {...props} />);
  });

/** A local project two seconds into its open, the server started in 0.5 s. */
const local = (changes: Partial<Opening> = {}): Opening => {
  let opening: Opening = {
    log: [],
    name: "bike-shop",
    remote: false,
    since: NOW - 2000,
    steps: openingSteps("local"),
    where: "~/Code/bike-shop",
    ...changes,
  };
  opening = reachStep(opening, "server", NOW - 2000);
  return reachStep(opening, "project", NOW - 1500);
};

const text = () => document.body.textContent ?? "";
const button = (name: string) =>
  [...document.body.querySelectorAll("button")].find(
    (b) => b.textContent === name || b.getAttribute("aria-label") === name
  );
const steps = () =>
  [...document.querySelectorAll("ol li")].map((li) => li.textContent);

describe("the splash a project opens on", () => {
  it("names the project and where it is, and every step with its time", () => {
    show({ opening: local() });
    expect(document.querySelector("h1")?.textContent).toBe("Opening bike-shop");
    expect(text()).toContain("~/Code/bike-shop");
    expect(steps()).toEqual([
      "Starting the server0.5 s",
      "Reading the project1.5 s",
      "Drawing the canvas",
    ]);
  });

  it("estimates the time left from the project's last opening", () => {
    show({ opening: local({ estimate: 4000 }) });
    expect(text()).toContain("About 2 s left");
  });

  it("says when it takes longer than last time", () => {
    show({ opening: local({ estimate: 1000 }) });
    expect(text()).toContain("Longer than last time (1 s)");
  });

  it("shows no bar on a first open, which has no estimate", () => {
    show({ opening: local() });
    expect(text()).not.toContain("left");
    expect(document.querySelector("[aria-hidden] svg path[transform]")).toBe(
      null
    );
  });

  it("shows the last line a slow step printed", () => {
    show({
      opening: noteLine(
        reachStep(local(), "project", NOW - 1500),
        "pnpm install · 214 packages"
      ),
    });
    expect(text()).toContain("pnpm install · 214 packages");
  });

  it("says why an open failed under its step, with Cancel and Try again", () => {
    const onCancel = vi.fn();
    const onRetry = vi.fn();
    show({
      onCancel,
      onRetry,
      opening: failOpening(
        local(),
        "naf-mini did not accept a key. Load your key with ssh-add, then try again.",
        NOW
      ),
    });
    expect(document.querySelector("h1")?.textContent).toBe(
      "bike-shop didn’t open"
    );
    expect(text()).toContain("naf-mini did not accept a key.");
    expect(text()).toContain("Load your key with ssh-add, then try again.");
    act(() => button("Try again")?.click());
    expect(onRetry).toHaveBeenCalledOnce();
    act(() => button("Cancel")?.click());
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("is cancelled with Escape", () => {
    const onCancel = vi.fn();
    show({ onCancel, opening: local() });
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("offers a remote project's log, to read and to copy", () => {
    let opening: Opening = {
      log: [],
      name: "bike-shop",
      remote: true,
      since: NOW - 2000,
      steps: openingSteps("ssh", "naf-mini"),
      where: "naf-mini:~/Code/bike-shop",
    };
    opening = reachStep(opening, "connect", NOW - 2000);
    opening = noteLine(opening, "Authenticated to naf-mini");
    const log = () => document.querySelector("pre")?.textContent;
    show({ onCancel: () => undefined, opening });
    expect(log()).toBeUndefined();
    act(() => button("Show log")?.click());
    expect(log()).toBe("Authenticated to naf-mini");
    expect(button("Copy log")).toBeDefined();
    act(() => button("Hide log")?.click());
    expect(log()).toBeUndefined();
  });

  it("has no buttons where there is nothing to do: a local open in a browser", () => {
    show({ opening: local() });
    expect(document.querySelectorAll("button")).toHaveLength(0);
  });
});

describe("the paint over the splash", () => {
  /** What a test sees of a canvas: whether any paint is on it, and how often it was sized. */
  interface Layer {
    painted: boolean;
    resized: number;
  }
  const layers = new Map<HTMLCanvasElement, Layer>();
  let frames: FrameRequestCallback[] = [];
  let pictures: (() => void)[] = [];
  let clock = 0;

  beforeEach(() => {
    layers.clear();
    frames = [];
    clock = 1000;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      frames.push(callback)
    );
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockImplementation(
      function (this: HTMLCanvasElement) {
        return layers.get(this)?.painted
          ? "data:image/png;base64,cGFpbnQ="
          : "data:,";
      }
    );
    // A picture loads when the test says, as a browser decodes a data URL in its own time.
    pictures = [];
    vi.stubGlobal(
      "Image",
      class {
        onload: (() => void) | null = null;
        set src(_: string) {
          pictures.push(() => this.onload?.());
        }
      }
    );
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      function (this: HTMLCanvasElement) {
        const layer: Layer = { painted: false, resized: 0 };
        layers.set(this, layer);
        // A canvas is wiped when its size is set, as a browser's is.
        for (const side of ["width", "height"] as const) {
          let value = 0;
          Object.defineProperty(this, side, {
            get: () => value,
            set: (to: number) => {
              value = to;
              layer.painted = false;
              layer.resized += 1;
            },
          });
        }
        return {
          beginPath: () => undefined,
          canvas: this,
          clearRect: () => {
            layer.painted = false;
          },
          drawImage: () => {
            layer.painted = true;
          },
          fillRect: () => undefined,
          lineTo: () => undefined,
          moveTo: () => undefined,
          setTransform: () => undefined,
          stroke: () => {
            layer.painted = true;
          },
        } as unknown as CanvasRenderingContext2D;
      } as never
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  const canvas = () => document.querySelector("canvas") as HTMLCanvasElement;
  const layer = () => layers.get(canvas()) as Layer;
  /** The next frames, 16 ms apart. */
  const run = (count = 1) =>
    act(() => {
      for (let i = 0; i < count; i += 1) {
        clock += 16;
        const due = frames;
        frames = [];
        for (const frame of due) {
          frame(clock);
        }
      }
    });
  /** The pointer dragged across the splash, a move every 16 ms. */
  const drag = (points: readonly (readonly [number, number])[]) =>
    act(() => {
      const area = document.querySelector('[role="dialog"]') as HTMLElement;
      for (const [x, y] of points) {
        clock += 16;
        area.dispatchEvent(
          new PointerEvent("pointermove", {
            bubbles: true,
            clientX: x,
            clientY: y,
          })
        );
      }
    });

  it("keeps what was painted when a step of the opening moves on", () => {
    show({ opening: local() });
    const before = canvas();
    drag([
      [100, 100],
      [110, 104],
      [120, 108],
    ]);
    run();
    expect(layer().painted).toBe(true);
    const { resized } = layer();
    act(() =>
      root?.render(
        <OpeningSplash opening={reachStep(local(), "canvas", NOW - 100)} />
      )
    );
    run();
    expect(canvas()).toBe(before);
    expect(layer().resized).toBe(resized);
    expect(layer().painted).toBe(true);
  });

  it("carries what was painted on the start page to the editor's page", () => {
    show({ opening: local() });
    drag([
      [100, 100],
      [110, 104],
      [120, 108],
    ]);
    run();
    // The page goes, as the desktop app's start page does once the server is up, and the
    // editor's page takes its place in the same tab.
    window.dispatchEvent(new Event("pagehide"));
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = '<div id="root"></div>';
    show({ opening: reachStep(local(), "project", NOW - 100) });
    expect(pictures).toHaveLength(1);
    act(() => {
      for (const load of pictures.splice(0)) {
        load();
      }
    });
    run();
    expect(layer().painted).toBe(true);
  });
});
