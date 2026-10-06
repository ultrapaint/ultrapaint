import "../testing/fake-browser.ts";
import type { Thread, ThreadItem } from "@ultrapaint/contracts/threads";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeApi } from "../testing/fake-api.ts";
import {
  type AgentWork,
  editedWork,
  finishWork,
  focusedWork,
  summarised,
  terminalKey,
  useAgents,
} from "./agents.ts";

vi.mock(
  "./connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

const thread = (id: string, extra: Partial<Thread> = {}): Thread => ({
  agentId: "claude",
  createdAt: 1,
  id,
  status: "running",
  title: id,
  updatedAt: 1,
  ...extra,
});

const said = (id: string, text: string): ThreadItem => ({
  at: 1,
  id,
  kind: "agent",
  text,
});

const initial = useAgents.getState();
useAgents.getState().bind();

beforeEach(() => {
  useAgents.setState(initial, true);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("summarised", () => {
  const threads = [thread("a"), thread("b")];

  it("gives the same list while the summary stays what it was", () => {
    const once = summarised(threads, "a", [said("1", "Working on it")]);
    expect(once).not.toBe(threads);
    expect(once[0]?.summary).toEqual({ text: "Working on it", waiting: false });
    expect(once[1]).toBe(threads[1]);
    // The answer streams on past its first line: the list shows the same.
    const again = summarised(once, "a", [said("1", "Working on it\nand more")]);
    expect(again).toBe(once);
  });

  it("leaves the list as it is for a thread it does not hold, or no items", () => {
    expect(summarised(threads, "zz", [said("1", "x")])).toBe(threads);
    expect(summarised(threads, "a", [])).toBe(threads);
  });
});

describe("focusedWork and editedWork", () => {
  const working: AgentWork = {
    action: "formatting the dates",
    doc: "p1",
    done: false,
    intent: ["a", "b"],
    nodeIds: ["a", "b"],
  };

  it("adds what is announced on the same page to the work there", () => {
    expect(
      focusedWork(working, {
        nodeIds: ["c"],
        pageId: "p1",
        threadId: "t",
      })
    ).toEqual({
      doc: "p1",
      done: false,
      intent: ["c"],
      nodeIds: ["a", "b", "c"],
    });
  });

  it("starts afresh on another page, or after the work was done", () => {
    const fresh = {
      action: "new",
      doc: "p2",
      done: false,
      intent: ["x"],
      nodeIds: ["x"],
    };
    expect(
      focusedWork(working, {
        action: "new",
        nodeIds: ["x"],
        pageId: "p2",
        threadId: "t",
      })
    ).toEqual(fresh);
    expect(
      focusedWork(
        { ...working, doc: "p2", done: true },
        { action: "new", nodeIds: ["x"], pageId: "p2", threadId: "t" }
      )
    ).toEqual(fresh);
  });

  it("takes what was changed out of the skeletons and keeps the action said", () => {
    expect(
      editedWork(working, {
        doc: "p1",
        label: "Edit",
        nodeIds: ["a", "z"],
        threadId: "t",
      })
    ).toEqual({
      action: "formatting the dates",
      doc: "p1",
      done: false,
      intent: ["b"],
      nodeIds: ["a", "b", "z"],
    });
  });

  it("names an edit elsewhere by its label, with no skeletons", () => {
    expect(
      editedWork(working, {
        doc: "p9",
        label: "Edit",
        nodeIds: ["q"],
        threadId: "t",
      })
    ).toEqual({
      action: "Edit",
      doc: "p9",
      done: false,
      intent: [],
      nodeIds: ["q"],
    });
  });
});

describe("finishWork", () => {
  it("marks the work done at once and takes it off a moment later", async () => {
    vi.useFakeTimers();
    useAgents.setState({
      working: {
        t: { doc: "p", done: false, intent: ["a"], nodeIds: ["a"] },
      },
    });
    finishWork("t");
    await vi.advanceTimersByTimeAsync(0);
    expect(useAgents.getState().working.t).toEqual({
      doc: "p",
      done: true,
      intent: [],
      nodeIds: ["a"],
    });
    await vi.advanceTimersByTimeAsync(4000);
    expect(useAgents.getState().working.t).toBeUndefined();
  });
});

describe("the agent events", () => {
  it("keeps the thread object while an item streams without changing its summary", () => {
    useAgents.setState({ threads: [thread("t")] });
    fakeApi.emit("agent", {
      item: said("1", "Looking"),
      threadId: "t",
      type: "item",
    });
    const before = useAgents.getState().threads;
    fakeApi.emit("agent", {
      item: said("1", "Looking\nat the page"),
      threadId: "t",
      type: "itemUpdate",
    });
    expect(useAgents.getState().threads).toBe(before);
    expect(useAgents.getState().items.t).toHaveLength(1);
  });

  it("forgets a removed thread's transcript, terminals and work", () => {
    useAgents.setState({
      focused: { t: "p", u: "p" },
      items: { t: [said("1", "x")], u: [said("2", "y")] },
      terminals: {
        [terminalKey("t", "1")]: "out",
        [terminalKey("u", "1")]: "kept",
      },
      threads: [thread("t"), thread("u")],
      working: { t: { doc: "p", done: false, intent: [], nodeIds: [] } },
    });
    fakeApi.emit("agent", { threadId: "t", type: "removed" });
    const s = useAgents.getState();
    expect(Object.keys(s.items)).toEqual(["u"]);
    expect(s.terminals).toEqual({ [terminalKey("u", "1")]: "kept" });
    expect(s.working).toEqual({});
    expect(s.focused).toEqual({ u: "p" });
  });
});
