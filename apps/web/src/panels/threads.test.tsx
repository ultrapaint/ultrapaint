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
const STARTER = "Set up bike-shop";

let mounted: Root;
let container: HTMLElement;
/** The reads of the transcript asked for and not answered yet, oldest first. */
let reads: {
  answer: (items: readonly ThreadItem[]) => void;
  fail: (error: Error) => void;
}[] = [];

const initial = useAgents.getState();

const button = (label: string) =>
  [...container.querySelectorAll("button")].find(
    (b) => b.textContent === label
  );

/** Settles the oldest read of the transcript, and draws what follows. */
const settle = (how: (read: (typeof reads)[number]) => void) =>
  act(async () => {
    const read = reads.shift();
    if (read) {
      how(read);
    }
    await Promise.resolve();
  });

beforeEach(async () => {
  fakeApi.reset();
  reads = [];
  fakeApi.respond("agents.list", () => []);
  fakeApi.respond("threads.list", () => [thread]);
  fakeApi.respond(
    "threads.items",
    () =>
      new Promise((resolve, reject) => {
        reads.push({ answer: resolve, fail: reject });
      })
  );
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
    await settle((read) => read.answer([]));
    expect(button(STARTER)).toBeDefined();
  });

  it("says in place that its transcript didn’t load, and reads it again", async () => {
    await settle((read) =>
      read.fail(new RequestError("internal", "the file is gone"))
    );
    expect(button(STARTER)).toBeUndefined();
    expect(container.querySelector("[role='alert']")?.textContent).toBe(
      "The chat didn’t loadTry again"
    );
    const asked = fakeApi.calls.filter((c) => c.method === "threads.items");
    await act(async () => {
      button("Try again")?.click();
      await Promise.resolve();
    });
    expect(
      fakeApi.calls.filter((c) => c.method === "threads.items")
    ).toHaveLength(asked.length + 1);
    expect(container.textContent).not.toContain("The chat didn’t load");
    // Read this time, as the read the panel asked for as it was shown is: something was said.
    const said: ThreadItem = { at: 1, id: "1", kind: "agent", text: "Hello" };
    await settle((read) => read.answer([said]));
    await settle((read) => read.answer([said]));
    expect(reads).toEqual([]);
    expect(container.textContent).toContain("Hello");
    expect(button(STARTER)).toBeUndefined();
  });
});
