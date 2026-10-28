import { assert, describe, it } from "@effect/vitest";
import type { NewDesignUpdate } from "@ultrapaint/contracts/shell-bridge";
import {
  channelOf,
  exposeBridge,
  progressChannelOf,
  type RendererIpc,
} from "./bridge.ts";
import { bridgeInfo } from "./bridge-server.ts";

type Listener = (event: unknown, payload: unknown) => void;

/** `ipcRenderer` as the preload sees it: calls recorded, each answered with `answers`. */
const fakeIpc = (answers: Record<string, unknown> = {}) => {
  const invoked: unknown[][] = [];
  const listeners = new Map<string, Set<Listener>>();
  const pending: (() => void)[] = [];
  const ipc: RendererIpc = {
    invoke: (channel, ...args) => {
      invoked.push([channel, ...args]);
      // Answered when the test says, so that it can tell steps on the way.
      return new Promise((resolve) => {
        pending.push(() => resolve(answers[channel]));
      });
    },
    off: (channel, listener) => listeners.get(channel)?.delete(listener),
    on: (channel, listener) => {
      const set = listeners.get(channel) ?? new Set();
      set.add(listener);
      listeners.set(channel, set);
    },
  };
  const tell = (channel: string, payload: unknown) => {
    for (const listener of listeners.get(channel) ?? []) {
      listener({}, payload);
    }
  };
  const answerAll = () => {
    for (const resolve of pending.splice(0)) {
      resolve();
    }
  };
  return { answerAll, invoked, ipc, listeners, tell };
};

describe("exposeBridge", () => {
  it("puts each capability shown at its path, calling it on its channel", async () => {
    const fake = fakeIpc({ [channelOf("projects.current")]: "p1" });
    const platform = exposeBridge(
      fake.ipc,
      bridgeInfo(false, { shellStatus: null })
    );
    const answered = Promise.all([
      platform.projects?.current(),
      platform.projects?.open("p2"),
      platform.agents?.setApiKey("claude-code", null),
      platform.pickFolder?.(),
    ]);
    fake.answerAll();
    assert.strictEqual((await answered)[0], "p1");
    assert.deepStrictEqual(fake.invoked, [
      [channelOf("projects.current")],
      [channelOf("projects.open"), "p2"],
      [channelOf("agents.setApiKey"), "claude-code", null],
      [channelOf("pickFolder")],
    ]);
    assert.isFunction(platform.notices);
    assert.isFunction(platform.newDesign?.create);
    // Not given by the main process: the system draws the window's frame.
    assert.isUndefined(platform.windowControls);
  });

  it("leaves out what a remote project does not show", () => {
    const platform = exposeBridge(
      fakeIpc().ipc,
      bridgeInfo(true, { shellStatus: null })
    );
    assert.isUndefined(platform.agents);
    assert.isUndefined(platform.notices);
    assert.isFunction(platform.projects?.open);
    assert.isFunction(platform.newDesign?.folderFor);
  });

  it("tells a call's listener its steps until it is answered", async () => {
    const fake = fakeIpc({ [channelOf("newDesign.create")]: {} });
    const platform = exposeBridge(
      fake.ipc,
      bridgeInfo(false, { shellStatus: null })
    );
    const steps: NewDesignUpdate[] = [];
    const input = {
      code: "app",
      folder: "/f",
      git: false,
      name: "F",
      template: "blank",
    } as const;
    const created = platform.newDesign?.create(input, (step) =>
      steps.push(step)
    );
    fake.tell(progressChannelOf("newDesign.create"), {
      state: "active",
      step: "folder",
    });
    fake.answerAll();
    assert.deepStrictEqual(await created, {});
    fake.tell(progressChannelOf("newDesign.create"), {
      state: "done",
      step: "folder",
    });
    assert.deepStrictEqual(steps, [{ state: "active", step: "folder" }]);
    // The listener is not an argument the main process gets.
    assert.deepStrictEqual(fake.invoked, [
      [channelOf("newDesign.create"), input],
    ]);
    assert.strictEqual(
      fake.listeners.get(progressChannelOf("newDesign.create"))?.size,
      0
    );
  });

  it("holds a state as the page loads and as the main process tells it", () => {
    const fake = fakeIpc();
    const platform = exposeBridge(
      fake.ipc,
      bridgeInfo(false, {
        shellStatus: { message: "Reconnecting to devbox…" },
        windowControls: { fullScreen: false, inset: 86 },
      })
    );
    const status = platform.shellStatus;
    assert.deepStrictEqual(status?.current(), {
      message: "Reconnecting to devbox…",
    });
    const heard: unknown[] = [];
    const stop = status?.subscribe((next) => heard.push(next));
    fake.tell(channelOf("shellStatus"), null);
    stop?.();
    fake.tell(channelOf("shellStatus"), { message: "Again" });
    assert.deepStrictEqual(heard, [null]);
    assert.deepStrictEqual(status?.current(), { message: "Again" });
    fake.tell(channelOf("windowControls"), { fullScreen: true, inset: 86 });
    assert.isTrue(platform.windowControls?.current().fullScreen);
  });
});
