import { describe, expect, it, vi } from "vitest";
import { FrameBridge } from "./bridge.ts";

/** A frame drawn in the editor's page, which keeps what it is asked. */
const fakeRuntime = () => {
  const renders: unknown[] = [];
  const runtime = {
    editText: vi.fn(),
    hitTest: (x: number, y: number) => [`at ${x},${y}`],
    measure: (ids: readonly string[]) =>
      Object.fromEntries(
        ids.map((id) => [id, { height: 1, width: 2, x: 3, y: 4 }])
      ),
    render: (request: unknown) => renders.push(request),
    screenshot: () => Promise.resolve("data:image/png;base64,"),
    scrollIntoView: vi.fn(),
    setInteractive: vi.fn(),
    skeleton: vi.fn(),
    tokens: () => ({ "--color-primary": "red" }),
    unmount: vi.fn(),
    watchRects: vi.fn(),
  };
  return { renders, runtime };
};

describe("FrameBridge on a frame in the editor's page", () => {
  it("answers at once, and is ready as soon as it is attached", async () => {
    const bridge = new FrameBridge("p1");
    const { runtime } = fakeRuntime();
    bridge.attachRuntime(runtime);
    expect(bridge.ready).toBe(true);
    expect(await bridge.hitTest(1, 2)).toEqual(["at 1,2"]);
    expect(await bridge.measure(["n"])).toEqual({
      n: { height: 1, width: 2, x: 3, y: 4 },
    });
    expect(await bridge.tokens()).toEqual({ "--color-primary": "red" });
  });

  it("tells the frame what it watches once it is attached", () => {
    const bridge = new FrameBridge("p1");
    bridge.watchRects(["a", "b"]);
    const { runtime } = fakeRuntime();
    bridge.attachRuntime(runtime);
    expect(runtime.watchRects).toHaveBeenCalledWith(["a", "b"]);
  });

  it("does not draw the frame again with what it already shows", () => {
    const bridge = new FrameBridge("p1");
    const { renders, runtime } = fakeRuntime();
    bridge.attachRuntime(runtime);
    const root = { children: [], id: "root", type: "page" as const };
    const look = { specs: [], styles: "" };
    const first = bridge.render({
      designSystem: null,
      look,
      mode: "page",
      root,
    });
    const again = bridge.render({
      designSystem: null,
      look,
      mode: "page",
      root,
    });
    expect(again).toBe(first);
    expect(renders).toHaveLength(1);
    bridge.render({
      designSystem: null,
      look,
      mode: "page",
      root: { ...root },
    });
    expect(renders).toHaveLength(2);
  });

  it("hands on what the frame says as messages", () => {
    const bridge = new FrameBridge("p1");
    const heard: string[] = [];
    bridge.on((msg) => heard.push(msg.type));
    bridge.attachRuntime(fakeRuntime().runtime);
    bridge.announce();
    bridge.events().rendered?.(3);
    bridge.events().textCommit?.("t", "Hello");
    expect(heard).toEqual(["ed:ready", "ed:rendered", "ed:textCommit"]);
  });
});
