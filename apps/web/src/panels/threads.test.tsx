// @vitest-environment happy-dom
import "../testing/fake-browser.ts";
import { RequestError } from "@ultrapaint/client-runtime/connection";
import type { ProjectInfo } from "@ultrapaint/contracts/project";
import type { Thread, ThreadItem } from "@ultrapaint/contracts/threads";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAgents } from "../state/agents.ts";
import { useProject } from "../state/project.ts";
import { fakeApi } from "../testing/fake-api.ts";
import { Threads } from "./threads.tsx";

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);
// The composer is no part of what the chat shows of its transcript.
vi.mock("./thread-composer.tsx", () => ({ Composer: () => null }));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const thread: Thread = {
  agentId: "claude-code",
  createdAt: 0,
  id: "t1",
  status: "idle",
  title: "Landing page",
  updatedAt: 0,
};

/** A new chat's first starter, in a folder whose settings were detected. */
const STARTER = "Check what Ultrapaint found";

let mounted: Root;
let container: HTMLElement;

const initial = useAgents.getState();

const button = (label: string) =>
  [...container.querySelectorAll("button")].find(
    (b) => b.textContent === label
  );

/** The thread's stream says its transcript, `items`, and that it is up to date. */
const told = (items: readonly ThreadItem[]) =>
  act(async () => {
    fakeApi.send("threads.follow", {
      items,
      kind: "snapshot",
      run: "run_1",
      sequence: 1,
      thread,
    });
    fakeApi.send("threads.follow", {
      kind: "synchronized",
      run: "run_1",
      sequence: 1,
    });
    await Promise.resolve();
  });

/** The thread's stream fails, as a transcript that cannot be read does. */
const failed = (error: RequestError) =>
  act(async () => {
    fakeApi.failStream("threads.follow", error);
    await Promise.resolve();
  });

const follows = () => fakeApi.started.length;

beforeEach(async () => {
  fakeApi.reset();
  fakeApi.respond("agents.list", () => []);
  fakeApi.respond("threads.list", () => [thread]);
  // Followed, and nothing said of it yet.
  fakeApi.respondStream("threads.follow", () => []);
  useAgents.setState(initial, true);
  useAgents.setState({ threads: [thread] });
  useProject.setState({
    error: null,
    info: {
      configured: true,
      name: "bike-shop",
      setup: "detected",
      storage: { mode: "ephemeral" },
    } as ProjectInfo,
  });
  container = document.createElement("div");
  document.body.append(container);
  mounted = createRoot(container);
  // The chat opened from the list: its transcript is asked for, and not answered yet.
  await act(async () => {
    useAgents.getState().open(thread.id);
    mounted.render(<Threads />);
    await Promise.resolve();
  });
});

afterEach(() => {
  act(() => mounted.unmount());
  container.remove();
});

describe("a chat opened", () => {
  it("draws no starters while its transcript is read, and a new chat's once it is read empty", async () => {
    expect(container.textContent).toContain("Landing page");
    expect(button(STARTER)).toBeUndefined();
    await told([]);
    expect(button(STARTER)).toBeDefined();
  });

  it("says in place that its transcript didn’t load, and reads it again", async () => {
    await failed(new RequestError("internal", "the file is gone"));
    expect(button(STARTER)).toBeUndefined();
    expect(container.querySelector("[role='alert']")?.textContent).toBe(
      "The chat didn’t loadTry again"
    );
    const asked = follows();
    await act(async () => {
      button("Try again")?.click();
      await Promise.resolve();
    });
    expect(follows()).toBe(asked + 1);
    expect(container.textContent).not.toContain("The chat didn’t load");
    // Read this time: something was said.
    const said: ThreadItem = { at: 1, id: "1", kind: "agent", text: "Hello" };
    await told([said]);
    expect(container.textContent).toContain("Hello");
    expect(button(STARTER)).toBeUndefined();
  });
});
