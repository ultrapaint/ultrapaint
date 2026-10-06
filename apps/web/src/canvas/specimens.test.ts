import type { DesignNode } from "@ultrapaint/contracts/document";
import type { EditorMessage } from "@ultrapaint/contracts/preview";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bridgeFor } from "./bridge.ts";
import { drawSpecimen, READY_MS } from "./specimens.ts";

/** A hidden iframe as the specimens make it, whose preview answers when `alive`. */
interface FakeFrame {
  alive: boolean;
  removed: boolean;
}

const frames: FakeFrame[] = [];
let alive = false;

const makeFrame = () => {
  const bridge = bridgeFor("specimen");
  const frame: FakeFrame = { alive, removed: false };
  frames.push(frame);
  return {
    contentWindow: {
      postMessage: (msg: EditorMessage) => {
        if (!frame.alive) {
          return;
        }
        // The preview answers on its own turn, as a real one does.
        queueMicrotask(() => {
          if (msg.type === "ed:render") {
            bridge.handle({ renderId: msg.renderId, type: "ed:rendered" });
          } else if (msg.type === "ed:screenshot") {
            bridge.handle({
              dataUrl: "data:image/png;base64,AA",
              requestId: msg.requestId,
              type: "ed:screenshot",
            });
          }
        });
      },
    },
    remove: () => {
      frame.removed = true;
    },
    setAttribute: () => undefined,
    src: "",
    style: {},
    tabIndex: 0,
  };
};

const node: DesignNode = {
  id: "n",
  role: "paragraph",
  text: "Hi",
  type: "text",
};

beforeEach(() => {
  vi.useFakeTimers();
  frames.length = 0;
  alive = false;
  vi.stubGlobal("document", {
    body: { append: () => undefined },
    createElement: makeFrame,
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
  it("gives up on a preview that never loads, and loads it afresh for the next picture", async () => {
    const first = drawSpecimen("http://preview", node, null, { canvas: "a" });
    await vi.advanceTimersByTimeAsync(READY_MS);
    await expect(first).resolves.toBeNull();
    expect(frames).toHaveLength(1);
    expect(frames[0]?.removed).toBe(true);

    // The preview is back: the next picture makes a new iframe, which answers.
    alive = true;
    const second = drawSpecimen("http://preview", node, null, { canvas: "a" });
    await vi.advanceTimersByTimeAsync(0);
    expect(frames).toHaveLength(2);
    bridgeFor("specimen").handle({ frame: "specimen", type: "ed:ready" });
    await vi.advanceTimersByTimeAsync(200);
    await expect(second).resolves.toBe("data:image/png;base64,AA");
  });

  it("draws the pictures queued behind one whose preview did not answer", async () => {
    const stuck = drawSpecimen("http://preview", node, null, { canvas: "b" });
    const behind = drawSpecimen("http://preview", node, null, { canvas: "b" });
    alive = true;
    await vi.advanceTimersByTimeAsync(READY_MS);
    await expect(stuck).resolves.toBeNull();
    // The one behind it opened its own iframe instead of waiting on the dead one.
    await vi.advanceTimersByTimeAsync(0);
    expect(frames.at(-1)?.removed).toBe(false);
    bridgeFor("specimen").handle({ frame: "specimen", type: "ed:ready" });
    await vi.advanceTimersByTimeAsync(200);
    await expect(behind).resolves.toBe("data:image/png;base64,AA");
  });
});
