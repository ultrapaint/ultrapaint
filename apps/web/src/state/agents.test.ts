import "../testing/fake-browser.ts";
import { RequestError } from "@ultrapaint/client-runtime/connection";
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
import { pick, sendAnswers, useAnswers } from "./answers.ts";
import { addChip, useAttachments } from "./attachments.ts";
import { followServer } from "./server-data.ts";

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

type QuestionItem = Extract<ThreadItem, { kind: "question" }>;

/** A card asking one question, not yet answered. */
const asked = (id: string): QuestionItem => ({
  answers: null,
  at: 1,
  id,
  kind: "question",
  questions: [
    {
      id: "tone",
      options: [
        { id: "calm", label: "Calm" },
        { id: "loud", label: "Loud" },
      ],
      question: "Which tone?",
    },
  ],
});

const initial = useAgents.getState();

beforeEach(() => {
  fakeApi.reset();
  useAgents.setState(initial, true);
  useAnswers.setState({ drafts: {} });
  useAttachments.setState({ byThread: {} });
  localStorage.clear();
  return followServer({ report: () => undefined });
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

  it("leaves the work of a turn begun before the moment is over", async () => {
    vi.useFakeTimers();
    useAgents.setState({
      working: {
        t: { doc: "p", done: false, intent: ["a"], nodeIds: ["a"] },
      },
    });
    finishWork("t");
    await vi.advanceTimersByTimeAsync(1000);
    fakeApi.emit("agent.focus", { nodeIds: ["b"], pageId: "p", threadId: "t" });
    await vi.advanceTimersByTimeAsync(4000);
    expect(useAgents.getState().working.t).toEqual({
      doc: "p",
      done: false,
      intent: ["b"],
      nodeIds: ["b"],
    });
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

  it("puts a streamed chunk at the end of its item, the others kept as they were", () => {
    const other = said("2", "Done before");
    useAgents.setState({
      items: { t: [other, said("1", "Hello ")] },
      threads: [thread("t")],
    });
    fakeApi.emit("agent", {
      itemId: "1",
      text: "world",
      threadId: "t",
      type: "itemText",
    });
    const [kept, streamed] = useAgents.getState().items.t ?? [];
    expect(kept).toBe(other);
    expect(streamed).toEqual(said("1", "Hello world"));
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

  it("forgets a removed thread's chips, when it was looked at, and the answers it was being given", async () => {
    fakeApi.respond("threads.items", () => []);
    const card = asked("q1");
    const other = asked("q2");
    useAgents.setState({
      items: { t: [card], u: [other] },
      threads: [thread("t"), thread("u")],
    });
    await useAgents.getState().open("t");
    await useAgents.getState().open("u");
    useAgents.setState({ items: { t: [card], u: [other] } });
    const chip = (pageId: string) =>
      ({
        file: `designs/${pageId}`,
        kind: "page",
        name: pageId,
        pageId,
      }) as const;
    addChip("t", chip("home"));
    addChip("u", chip("about"));
    pick("q1", card.questions[0] as QuestionItem["questions"][number], "calm");
    pick("q2", other.questions[0] as QuestionItem["questions"][number], "loud");
    fakeApi.emit("agent", { threadId: "t", type: "removed" });
    expect(Object.keys(useAgents.getState().seen)).toEqual(["u"]);
    expect(
      Object.keys(
        JSON.parse(localStorage.getItem("ultrapaint:threads-seen") ?? "")
      )
    ).toEqual(["u"]);
    expect(Object.keys(useAttachments.getState().byThread)).toEqual(["u"]);
    expect(Object.keys(useAnswers.getState().drafts)).toEqual(["q2"]);
  });

  it("forgets the answers given to a card once it is answered, told before the request is", async () => {
    const card = asked("q1");
    const question = card.questions[0] as QuestionItem["questions"][number];
    useAgents.setState({ items: { t: [card] }, threads: [thread("t")] });
    fakeApi.respond("threads.answer", ({ answers, itemId }) => {
      fakeApi.emit("agent", {
        item: { ...card, answers, id: itemId },
        threadId: "t",
        type: "itemUpdate",
      });
    });
    pick("q1", question, "calm");
    await sendAnswers(card, "t");
    expect(useAnswers.getState().drafts).toEqual({});
  });

  it("forgets the answers given to a card that was declined", () => {
    const card = asked("q1");
    useAgents.setState({ items: { t: [card] }, threads: [thread("t")] });
    pick("q1", card.questions[0] as QuestionItem["questions"][number], "calm");
    fakeApi.emit("agent", {
      item: { ...card, outcome: "declined" },
      threadId: "t",
      type: "itemUpdate",
    });
    expect(useAnswers.getState().drafts).toEqual({});
  });
});

describe("a thread opened", () => {
  it("holds nothing of its transcript until it is read: not an empty one", async () => {
    let answer: (items: readonly ThreadItem[]) => void = () => undefined;
    fakeApi.respond(
      "threads.items",
      () =>
        new Promise((resolve) => {
          answer = resolve;
        })
    );
    useAgents.setState({ threads: [thread("t")] });
    const opened = useAgents.getState().open("t");
    expect(useAgents.getState()).toMatchObject({
      current: "t",
      view: "thread",
    });
    expect(useAgents.getState().items.t).toBeUndefined();
    answer([]);
    await opened;
    expect(useAgents.getState().items.t).toEqual([]);
    expect(useAgents.getState().readFailed).toEqual({});
  });

  it("says its transcript could not be read, until it is", async () => {
    fakeApi.respond("threads.items", () =>
      Promise.reject(new RequestError("internal", "the file is gone"))
    );
    useAgents.setState({ threads: [thread("t")] });
    await useAgents.getState().open("t");
    expect(useAgents.getState().readFailed).toEqual({ t: true });
    expect(useAgents.getState().items.t).toBeUndefined();
    // Asked again, it is being read: not failed while it is, nor once it is read.
    fakeApi.respond("threads.items", () => [said("1", "Hello")]);
    const again = useAgents.getState().open("t");
    expect(useAgents.getState().readFailed).toEqual({});
    await again;
    expect(useAgents.getState().items.t).toEqual([said("1", "Hello")]);
  });
});
