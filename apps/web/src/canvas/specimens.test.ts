import type { DesignNode } from "@ultrapaint/contracts/document";
import type {
  FrameEvents,
  FrameRuntime,
  Preview,
} from "@ultrapaint/framework-api/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { drawSpecimen, pictureKey } from "./specimens.ts";

/** The preview the specimens draw with: none until a test gives one. */
let preview: Preview | null = null;
vi.mock("./preview-module.ts", () => ({
  previewReady: () => Promise.resolve(preview),
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
      style: {},
    }),
  });
  vi.stubGlobal("requestAnimationFrame", (cb: () => void) =>
    setTimeout(cb, 16)
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("drawSpecimen", () => {
  it("draws nothing while the preview is not running", async () => {
    await expect(drawSpecimen(node, null)).resolves.toBeNull();
  });

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
});
