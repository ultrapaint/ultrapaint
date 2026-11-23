import type { DesignNode } from "@ultrapaint/contracts/document";
import type { RenderedFinding } from "@ultrapaint/contracts/screenshots";
import type {
  FrameEvents,
  FrameRuntime,
  Preview,
} from "@ultrapaint/preview-core/preview";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { drawMeasuredSpecimen, drawSpecimen, pictureKey } from "./specimens.ts";

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

/** A preview whose frame draws on its own turn, as React does, and is captured as `picture`. */
const fakePreview = (picture: string | null) => {
  const drawn: unknown[] = [];
  const mounted: string[] = [];
  const value = {
    mountFrame: (
      _host: HTMLElement,
      options: { canvas: string; events: FrameEvents }
    ) => {
      mounted.push(options.canvas);
      return {
        render: (request: { renderId: number; root: unknown }) => {
          drawn.push(request.root);
          queueMicrotask(() => options.events.rendered?.(request.renderId));
        },
        screenshot: () => Promise.resolve(picture),
        show: () => undefined,
        skeleton: () => undefined,
        unmount: () => undefined,
        watchRects: () => undefined,
      } as unknown as FrameRuntime;
    },
  } as unknown as Preview;
  return { drawn, mounted, value };
};

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
  });
  vi.stubGlobal("requestAnimationFrame", (cb: () => void) =>
    // fake clock: a frame is a timer of the fake clock set above.
    setTimeout(cb, 16)
  );
});

afterEach(() => {
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
