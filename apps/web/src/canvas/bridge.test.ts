import type { EditorMessage } from "@ultrapaint/contracts/preview";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bridgeFor, FrameBridge, installBridgeRouter } from "./bridge.ts";

const PREVIEW = "http://127.0.0.1:4772";

/** An iframe of the preview, whose window keeps what it was sent. */
const fakeIframe = (src = `${PREVIEW}/?frame=p1`) => {
  const sent: { msg: EditorMessage; origin: string }[] = [];
  const contentWindow = {
    postMessage: (msg: EditorMessage, origin: string) => {
      sent.push({ msg, origin });
    },
  };
  const iframe = { contentWindow, src } as unknown as HTMLIFrameElement;
  return { contentWindow, iframe, sent };
};

/** The id of the last request the preview was sent. */
const lastRequestId = (sent: { msg: EditorMessage }[]) => {
  const msg = sent.at(-1)?.msg;
  return msg && "requestId" in msg ? msg.requestId : -1;
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("FrameBridge requests", () => {
  it("answers each request with the response carrying its id", async () => {
    const bridge = new FrameBridge("p1");
    const { iframe, sent } = fakeIframe();
    bridge.attach(iframe);
    const first = bridge.hitTest(1, 2);
    const firstId = lastRequestId(sent);
    const second = bridge.hitTest(3, 4);
    const secondId = lastRequestId(sent);
    bridge.handle({ nodeIds: ["b"], requestId: secondId, type: "ed:hit" });
    bridge.handle({ nodeIds: ["a"], requestId: firstId, type: "ed:hit" });
    await expect(first).resolves.toEqual(["a"]);
    await expect(second).resolves.toEqual(["b"]);
  });

  it("gives up on a request the preview does not answer, and ignores a late answer", async () => {
    const bridge = new FrameBridge("p1");
    const { iframe, sent } = fakeIframe();
    bridge.attach(iframe);
    const asked = bridge.measure(["a"]);
    const id = lastRequestId(sent);
    await vi.advanceTimersByTimeAsync(4000);
    await expect(asked).resolves.toEqual({});
    const heard = vi.fn();
    bridge.on(heard);
    bridge.handle({ rects: {}, requestId: id, type: "ed:measured" });
    // Still told to whoever listens, but nothing waits on it any more.
    expect(heard).toHaveBeenCalledOnce();
  });

  it("sends to the preview's origin when its address says it", () => {
    const bridge = new FrameBridge("p1");
    const { iframe, sent } = fakeIframe();
    bridge.attach(iframe);
    bridge.editText("n");
    expect(sent.at(-1)?.origin).toBe(PREVIEW);
    const blank = fakeIframe("about:blank");
    bridge.attach(blank.iframe);
    bridge.editText("n");
    expect(blank.sent.at(-1)?.origin).toBe("*");
  });
});

describe("the bridge router", () => {
  let route: (ev: Partial<MessageEvent>) => void = () => undefined;

  beforeEach(() => {
    vi.stubGlobal("window", {
      addEventListener: (_type: string, listener: typeof route) => {
        route = listener;
      },
    });
    installBridgeRouter();
  });

  it("takes a preview's messages only from its own window and origin", () => {
    const bridge = bridgeFor("routed");
    const { contentWindow, iframe } = fakeIframe();
    bridge.attach(iframe);
    route({
      data: { frame: "routed", type: "ed:ready" },
      origin: PREVIEW,
      source: contentWindow as unknown as Window,
    });
    const heard = vi.fn();
    bridge.on(heard);
    const data = { frame: "routed", type: "ed:hmr" };

    // Another page naming the frame is not the frame.
    route({ data, origin: PREVIEW, source: {} as Window });
    route({
      data,
      origin: "http://evil.example",
      source: contentWindow as unknown as Window,
    });
    expect(heard).not.toHaveBeenCalled();

    route({
      data,
      origin: PREVIEW,
      source: contentWindow as unknown as Window,
    });
    // Without the frame id, the window says whose it is.
    route({
      data: { type: "ed:hmr" },
      origin: PREVIEW,
      source: contentWindow as unknown as Window,
    });
    expect(heard).toHaveBeenCalledTimes(2);
  });

  it("follows a preview that redirected to another origin, from the one it is ready on", () => {
    const bridge = bridgeFor("redirected");
    const { contentWindow, iframe, sent } = fakeIframe();
    bridge.attach(iframe);
    const heard = vi.fn();
    bridge.on(heard);
    const from = (origin: string, type: string) =>
      route({
        data: { frame: "redirected", type },
        origin,
        source: contentWindow as unknown as Window,
      });

    // Loaded from 127.0.0.1, the app sent it on to localhost.
    from("http://localhost:4772", "ed:ready");
    expect(bridge.ready).toBe(true);
    bridge.editText("n");
    expect(sent.at(-1)?.origin).toBe("http://localhost:4772");
    from("http://localhost:4772", "ed:hmr");
    // Once ready, its own address is no longer where it speaks from.
    from(PREVIEW, "ed:hmr");
    expect(heard.mock.calls.map(([msg]) => msg.type)).toEqual([
      "ed:ready",
      "ed:hmr",
    ]);
  });
});
