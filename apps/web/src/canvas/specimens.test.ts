import type { DesignNode } from "@ultrapaint/contracts/document";
import type { RenderedFinding } from "@ultrapaint/contracts/screenshots";
import type {
  FrameEvents,
  FrameRuntime,
  Preview,
} from "@ultrapaint/preview-core/preview";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  drawMeasuredSpecimen,
  drawSpecimen,
  pictureKey,
  provideCanvasDefaults,
} from "./specimens.ts";

/** The preview the specimens draw with, the one a test gives. */
let preview: Preview | null = null;
vi.mock("./preview-module.ts", () => ({
  thePreview: () => preview,
}));

/**
 * What the checks find on the frame, the test's: happy-dom lays nothing out, so the measuring
 * itself is the design checks' own tests' and the lab's `measure` on real pages.
 */
let checks: () => readonly RenderedFinding[] = () => [];
vi.mock("./rendered-checks.ts", () => ({
  renderedChecks: () => checks(),
}));

/**
 * A preview whose frame draws on its own turn, as React does, and is captured as `picture`: each
 * capture as `captures` says, in turn, once they run out as `picture`. The first `silent` renders
 * never say they drew.
 */
const fakePreview = (
  picture: string | null,
  captures: (() => Promise<string | null>)[] = [],
  silent = 0
) => {
  let unheard = silent;
  const drawn: unknown[] = [];
  const mounted: string[] = [];
  const unmounted: string[] = [];
  const value = {
    mountFrame: (
      _host: HTMLElement,
      options: { canvas: string; events: FrameEvents }
    ) => {
      mounted.push(options.canvas);
      return {
        render: (request: { renderId: number; root: unknown }) => {
          drawn.push(request.root);
          if (unheard > 0) {
            unheard -= 1;
            return;
          }
          queueMicrotask(() => options.events.rendered?.(request.renderId));
        },
        screenshot: () => captures.shift()?.() ?? Promise.resolve(picture),
        show: () => undefined,
        skeleton: () => undefined,
        unmount: () => {
          unmounted.push(options.canvas);
        },
        watchRects: () => undefined,
      } as unknown as FrameRuntime;
    },
  } as unknown as Preview;
  return { drawn, mounted, unmounted, value };
};

/** A step of a picture that never settles. */
const never = <T>() => new Promise<T>(() => undefined);

const node: DesignNode = {
  id: "n",
  role: "paragraph",
  text: "Hi",
  type: "text",
};

beforeEach(() => {
  vi.useFakeTimers();
  preview = null;
  vi.stubGlobal("document", {
    body: { append: () => undefined },
    createElement: () => ({
      append: () => undefined,
      dataset: {},
      remove: () => undefined,
      setAttribute: () => undefined,
      // The frame's shadow root, which the checks measure.
      shadowRoot: {},
      style: {},
    }),
    visibilityState: "visible",
  });
  vi.stubGlobal("requestAnimationFrame", (cb: () => void) =>
    // fake clock: a frame is a timer of the fake clock set above.
    setTimeout(cb, 16)
  );
});

afterEach(() => {
  provideCanvasDefaults(() => Promise.resolve(undefined));
  vi.useRealTimers();
  vi.unstubAllGlobals();
  checks = () => [];
});

describe("drawSpecimen", () => {
  it("draws one picture after the other in the frame nobody sees", async () => {
    const fake = fakePreview("data:image/png;base64,AA");
    preview = fake.value;
    const first = drawSpecimen(node, null, { canvas: "a" });
    const second = drawSpecimen({ ...node, id: "m" }, null, { canvas: "a" });
    await vi.advanceTimersByTimeAsync(200);
    await expect(first).resolves.toBe("data:image/png;base64,AA");
    await expect(second).resolves.toBe("data:image/png;base64,AA");
    expect(fake.drawn).toHaveLength(2);
    // One frame for the canvas, kept for the next picture.
    expect(fake.mounted).toEqual(["a"]);
  });

  it("fails alone a picture whose capture never settles: the next is drawn in a frame opened anew", async () => {
    const fake = fakePreview("data:image/png;base64,AA", [never]);
    preview = fake.value;
    const stuck = drawSpecimen(node, null, { canvas: "s" });
    const next = drawSpecimen({ ...node, id: "m" }, null, { canvas: "s" });
    const stuckFails = expect(stuck).rejects.toThrow(
      "could not draw it in time"
    );
    await vi.advanceTimersByTimeAsync(16_000);
    await stuckFails;
    await expect(next).resolves.toBe("data:image/png;base64,AA");
    // The frame the stuck picture was taken in is not used again.
    expect(fake.unmounted).toEqual(["s"]);
    expect(fake.mounted).toEqual(["s", "s"]);
  });

  it("gives no picture of a frame that does not draw in time, and draws the next in a frame opened anew", async () => {
    const fake = fakePreview("data:image/png;base64,AA", [], 1);
    preview = fake.value;
    const late = drawSpecimen(node, null, { canvas: "r" });
    const next = drawSpecimen({ ...node, id: "m" }, null, { canvas: "r" });
    await vi.advanceTimersByTimeAsync(8200);
    await expect(late).resolves.toBeNull();
    await expect(next).resolves.toBe("data:image/png;base64,AA");
    expect(fake.mounted).toEqual(["r", "r"]);
  });

  it("says a picture is not drawn in time in a tab in the background, and what helps", async () => {
    preview = fakePreview("data:image/png;base64,AA", [never]).value;
    vi.stubGlobal("document", { ...document, visibilityState: "hidden" });
    const stuck = drawSpecimen(node, null, { canvas: "h" });
    const fails = expect(stuck).rejects.toThrow(
      "bring the editor to the front"
    );
    await vi.advanceTimersByTimeAsync(16_000);
    await fails;
  });

  it("draws in the stylesheet's own defaults a canvas whose defaults are not read in time", async () => {
    const fake = fakePreview("data:image/png;base64,AA");
    preview = fake.value;
    provideCanvasDefaults(never);
    const drawn = drawSpecimen(node, null, { canvas: "d" });
    await vi.advanceTimersByTimeAsync(5200);
    await expect(drawn).resolves.toBe("data:image/png;base64,AA");
  });

  it("takes a picture of what the frame shows already, without waiting for it to draw again", async () => {
    const fake = fakePreview("data:image/png;base64,AA");
    preview = fake.value;
    const first = drawSpecimen(node, null, { canvas: "c" });
    await vi.advanceTimersByTimeAsync(200);
    await first;
    const again = drawSpecimen(node, null, { canvas: "c" });
    await vi.advanceTimersByTimeAsync(200);
    await expect(again).resolves.toBe("data:image/png;base64,AA");
    expect(fake.drawn).toHaveLength(1);
  });
});

describe("drawMeasuredSpecimen", () => {
  const touching: RenderedFinding = {
    box: { height: 84, width: 200, x: 0, y: 40 },
    kind: "touching-rows",
    list: "Files",
    rowHeight: 28,
  };

  it("gives what the checks found on the frame with its picture", async () => {
    preview = fakePreview("data:image/png;base64,AA").value;
    checks = () => [touching];
    const drawn = drawMeasuredSpecimen(node, null, { canvas: "m" });
    await vi.advanceTimersByTimeAsync(200);
    await expect(drawn).resolves.toEqual({
      findings: [touching],
      picture: "data:image/png;base64,AA",
    });
  });

  it("gives its picture alone when the checks throw", async () => {
    preview = fakePreview("data:image/png;base64,AA").value;
    checks = () => {
      throw new Error("no layout");
    };
    const drawn = drawMeasuredSpecimen(node, null, { canvas: "t" });
    await vi.advanceTimersByTimeAsync(200);
    await expect(drawn).resolves.toEqual({
      picture: "data:image/png;base64,AA",
    });
  });
});

describe("pictureKey", () => {
  const drawnIn = { canvas: "c_1", components: [], designSystem: null };
  const look = {
    base: { root: { radius: 4 } },
    name: "Button",
    origin: "system",
    states: {},
    variants: {},
    version: 1,
  } as const;
  const ds = { colors: [{ name: "Brand", tokens: [] }] } as never;

  it("is the same for the same node drawn in the same design system, code and canvas", () => {
    expect(pictureKey(["Button", "primary"], drawnIn)).toBe(
      pictureKey(["Button", "primary"], { ...drawnIn })
    );
  });

  it("changes with the design system, the components and the canvas", () => {
    const key = pictureKey(["Button", "primary"], drawnIn);
    expect(
      pictureKey(["Button", "primary"], { ...drawnIn, designSystem: ds })
    ).not.toBe(key);
    expect(
      pictureKey(["Button", "primary"], { ...drawnIn, components: [look] })
    ).not.toBe(key);
    expect(
      pictureKey(["Button", "primary"], { ...drawnIn, canvas: "c_2" })
    ).not.toBe(key);
  });

  it("writes a design system out once for every option of a menu", () => {
    let written = 0;
    const counted = {
      toJSON: () => {
        written += 1;
        return ds;
      },
    } as never;
    const keys = ["sm", "md", "lg"].map((size) =>
      pictureKey(["Button", size], { ...drawnIn, designSystem: counted })
    );
    expect(new Set(keys).size).toBe(3);
    expect(keys[0]).toBe(
      pictureKey(["Button", "sm"], { ...drawnIn, designSystem: ds })
    );
    expect(written).toBe(1);
  });
});
