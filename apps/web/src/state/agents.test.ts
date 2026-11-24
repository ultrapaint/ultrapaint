import "../testing/fake-browser.ts";
import { RequestError } from "@ultrapaint/client-runtime/connection";
import type {
  Thread,
  ThreadEvent,
  ThreadItem,
  ThreadStreamItem,
} from "@ultrapaint/contracts/threads";
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

/** A chunk of the reply `1` of thread `t`, added where its text was `offset` long. */
const chunk = (offset: number, text: string) =>
  ({ itemId: "1", offset, text, threadId: "t", type: "itemText" }) as const;

/** What the editor holds of the reply `1` of thread `t`. */
const reply = () => {
  const item = useAgents.getState().items.t?.find((i) => i.id === "1");
  return item?.kind === "agent" ? item.text : undefined;
};

/** Thread `t` as its stream says it is at `sequence`, holding `items`. */
const snapshot = (
  sequence: number,
  items: readonly ThreadItem[],
  run = "run_1"
): ThreadStreamItem => ({
  items,
  kind: "snapshot",
  run,
  sequence,
  thread: thread("t"),
});

const synchronized = (sequence: number, run = "run_1"): ThreadStreamItem => ({
  kind: "synchronized",
  run,
  sequence,
});

/** A change to thread `t`, numbered `sequence`, as its stream tells it. */
const change = (sequence: number, event: ThreadEvent): ThreadStreamItem => ({
  event,
  kind: "event",
  sequence,
});

/** Where each start of a thread's stream asked to follow it from: `afterSequence`, by thread. */
const followedFrom = () =>
  fakeApi.started.map(
    (s) => s.input as { afterSequence?: number; run?: string; threadId: string }
  );

/** Thread `t`'s stream answers a snapshot of `items` at `sequence`, as it starts. */
const answersSnapshot = (
  sequence: number,
  items: readonly ThreadItem[],
  run = "run_1"
) =>
  fakeApi.respondStream("threads.follow", () => [
    snapshot(sequence, items, run),
    synchronized(sequence, run),
  ]);

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

  it("gives the same list while the thread waits on the person no more than it did", () => {
    const once = summarised(threads, "a", [said("1", "Working on it")]);
    expect(once).not.toBe(threads);
    expect(once[0]?.summary).toEqual({ text: "Working on it", waiting: false });
    expect(once[1]).toBe(threads[1]);
    // The answer streams on, its first line too: the list reads the line itself (`lineOf`).
    expect(summarised(once, "a", [said("1", "Working on it now")])).toBe(once);
    expect(summarised(once, "a", [said("1", "Working on it\nand more")])).toBe(
      once
    );
  });

  it("keeps when a turn began when it holds a transcript only from its news", () => {
    const read = [
      thread("a", { summary: { since: 5, text: "", waiting: false } }),
    ];
    // An agent's line alone: the prompt that began the turn came before the list was read.
    expect(summarised(read, "a", [said("1", "Working on it")])).toBe(read);
    expect(
      summarised(read, "a", [said("1", "x"), asked("2")])[0]?.summary
    ).toEqual({
      since: 5,
      text: "Which tone?",
      waiting: true,
    });
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

  it("keeps the threads as they were while a reply streams its first line", () => {
    // Everything showing a thread, a frame on the canvas each, would be drawn again per word.
    useAgents.setState({
      items: { t: [said("1", "Hello ")] },
      threads: [thread("t", { summary: { text: "Hello", waiting: false } })],
    });
    const before = useAgents.getState().threads;
    fakeApi.emit("agent", chunk(6, "world"));
    fakeApi.emit("agent", chunk(11, " and more"));
    expect(useAgents.getState().threads).toBe(before);
    expect(reply()).toBe("Hello world and more");
  });

  it("brings a thread up to date once it waits on the person, and once it no longer does", () => {
    useAgents.setState({
      items: { t: [said("1", "Hello")] },
      threads: [thread("t", { summary: { text: "Hello", waiting: false } })],
    });
    fakeApi.emit("agent", { item: asked("q"), threadId: "t", type: "item" });
    expect(useAgents.getState().threads[0]?.summary?.waiting).toBe(true);
    fakeApi.emit("agent", {
      item: { ...asked("q"), answers: { tone: ["calm"] } },
      threadId: "t",
      type: "itemUpdate",
    });
    expect(useAgents.getState().threads[0]?.summary?.waiting).toBe(false);
  });

  it("puts a streamed chunk at the end of its item, the others kept as they were", () => {
    const other = said("2", "Done before");
    useAgents.setState({
      items: { t: [other, said("1", "Hello ")] },
      threads: [thread("t")],
    });
    fakeApi.emit("agent", chunk(6, "world"));
    const [kept, streamed] = useAgents.getState().items.t ?? [];
    expect(kept).toBe(other);
    expect(streamed).toEqual(said("1", "Hello world"));
  });

  it("takes a chunk told twice once", () => {
    useAgents.setState({ items: { t: [said("1", "Hello ")] } });
    fakeApi.emit("agent", chunk(6, "world"));
    const once = useAgents.getState().items;
    fakeApi.emit("agent", chunk(6, "world"));
    expect(reply()).toBe("Hello world");
    expect(useAgents.getState().items).toBe(once);
  });

  it("takes of a chunk only what it says past the end of the message", () => {
    useAgents.setState({ items: { t: [said("1", "Hello wor")] } });
    fakeApi.emit("agent", chunk(6, "world"));
    expect(reply()).toBe("Hello world");
  });

  it("leaves a message as it is at a chunk that starts past its end, in a thread not open", () => {
    useAgents.setState({ items: { t: [said("1", "Hello ")] } });
    fakeApi.emit("agent", chunk(9, "ld"));
    expect(reply()).toBe("Hello ");
  });

  it("holds an item told again once, as it holds it", () => {
    useAgents.setState({ items: { t: [said("1", "Hello world")] } });
    fakeApi.emit("agent", {
      item: said("1", "Hello "),
      threadId: "t",
      type: "item",
    });
    expect(useAgents.getState().items.t).toEqual([said("1", "Hello world")]);
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
    fakeApi.respondStream("threads.follow", ({ threadId }) => [
      { ...snapshot(0, []), thread: thread(threadId) },
      synchronized(0),
    ]);
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
  it("holds nothing of its transcript until its stream says it: not an empty one", async () => {
    fakeApi.respondStream("threads.follow", () => []);
    useAgents.setState({ threads: [thread("t")] });
    const opened = useAgents.getState().open("t");
    expect(useAgents.getState()).toMatchObject({
      current: "t",
      view: "thread",
    });
    expect(useAgents.getState().items.t).toBeUndefined();
    fakeApi.send("threads.follow", snapshot(0, []));
    fakeApi.send("threads.follow", synchronized(0));
    await opened;
    expect(useAgents.getState().items.t).toEqual([]);
    expect(useAgents.getState().readFailed).toEqual({});
  });

  it("is followed from a snapshot, then takes the changes after it in order", async () => {
    answersSnapshot(3, [said("1", "Hello ")]);
    await useAgents.getState().open("t");
    expect(followedFrom()).toEqual([{ threadId: "t" }]);
    fakeApi.send("threads.follow", change(4, chunk(6, "world")));
    fakeApi.send(
      "threads.follow",
      change(5, { item: said("2", "Done"), threadId: "t", type: "item" })
    );
    expect(useAgents.getState().items.t).toEqual([
      said("1", "Hello world"),
      said("2", "Done"),
    ]);
  });

  it("drops a change at or below the last one it applied", async () => {
    answersSnapshot(3, [said("1", "Hello ")]);
    await useAgents.getState().open("t");
    const held = useAgents.getState().items;
    // Already in the snapshot, told again.
    fakeApi.send(
      "threads.follow",
      change(3, { item: said("2", "Again"), threadId: "t", type: "item" })
    );
    fakeApi.send(
      "threads.follow",
      change(2, { item: said("1", "Old"), threadId: "t", type: "itemUpdate" })
    );
    expect(useAgents.getState().items).toBe(held);
    fakeApi.send("threads.follow", change(4, chunk(6, "world")));
    fakeApi.send("threads.follow", change(4, chunk(6, "world")));
    expect(reply()).toBe("Hello world");
  });

  it("takes no news of its items from the threads' news, which its stream tells in order", async () => {
    answersSnapshot(3, [said("1", "Hello ")]);
    await useAgents.getState().open("t");
    fakeApi.emit("agent", chunk(6, "world"));
    fakeApi.emit("agent", {
      item: said("2", "Done"),
      threadId: "t",
      type: "item",
    });
    expect(useAgents.getState().items.t).toEqual([said("1", "Hello ")]);
  });

  it("resumes after a reconnect from the last change it applied", async () => {
    answersSnapshot(3, [said("1", "Hello ")]);
    await useAgents.getState().open("t");
    fakeApi.send("threads.follow", change(4, chunk(6, "wor")));
    fakeApi.disconnect();
    // Told while the editor was away: the stream tells it again from where it was.
    fakeApi.respondStream("threads.follow", () => [
      change(5, chunk(9, "ld")),
      change(6, { item: said("2", "Done"), threadId: "t", type: "item" }),
      synchronized(6),
    ]);
    fakeApi.connect();
    expect(followedFrom()).toEqual([
      { threadId: "t" },
      { afterSequence: 4, run: "run_1", threadId: "t" },
    ]);
    expect(useAgents.getState().items.t).toEqual([
      said("1", "Hello world"),
      said("2", "Done"),
    ]);
  });

  it("puts a snapshot in place of the items it held", async () => {
    answersSnapshot(3, [said("1", "Hello "), asked("q1")]);
    await useAgents.getState().open("t");
    fakeApi.disconnect();
    // Too far behind: the server sends the thread as it is, the card settled meanwhile gone.
    answersSnapshot(400, [said("1", "Hello world")]);
    fakeApi.connect();
    expect(useAgents.getState().items.t).toEqual([said("1", "Hello world")]);
    fakeApi.send("threads.follow", change(400, chunk(11, "!")));
    expect(reply()).toBe("Hello world");
  });

  it("is followed again from nothing once it is opened again after the list", async () => {
    answersSnapshot(3, [said("1", "Hello")]);
    await useAgents.getState().open("t");
    useAgents.getState().back();
    await useAgents.getState().open("t");
    expect(followedFrom()).toEqual([{ threadId: "t" }, { threadId: "t" }]);
  });

  it("is followed when shown without being opened, and again from where it was when the connection opens again", () => {
    answersSnapshot(1, []);
    useAgents.getState().show(thread("t"));
    expect(useAgents.getState().items.t).toEqual([]);
    fakeApi.disconnect();
    answersSnapshot(2, [said("1", "Hello")]);
    fakeApi.connect();
    expect(followedFrom()).toEqual([
      { threadId: "t" },
      { afterSequence: 1, run: "run_1", threadId: "t" },
    ]);
    expect(useAgents.getState().items.t).toEqual([said("1", "Hello")]);
  });

  it("follows a restarted server's run from its own numbers, lower as they may be", () => {
    answersSnapshot(3, [said("1", "Hello"), said("2", "Lost")]);
    useAgents.getState().show(thread("t"));
    // The server was killed and started again: another run, at a lower number.
    fakeApi.disconnect();
    answersSnapshot(0, [said("1", "Hello")], "run_2");
    fakeApi.connect();
    expect(useAgents.getState().items.t).toEqual([said("1", "Hello")]);
    fakeApi.send(
      "threads.follow",
      change(1, { item: said("3", "New"), threadId: "t", type: "item" })
    );
    expect(useAgents.getState().items.t).toEqual([
      said("1", "Hello"),
      said("3", "New"),
    ]);
    fakeApi.disconnect();
    fakeApi.connect();
    expect(followedFrom().at(-1)).toEqual({
      afterSequence: 1,
      run: "run_2",
      threadId: "t",
    });
  });

  it("is read again once its stream is up to date, even with nothing to replay", () => {
    answersSnapshot(1, [said("1", "Hello")]);
    useAgents.getState().show(thread("t"));
    fakeApi.failStream(
      "threads.follow",
      new RequestError("internal", "the file is gone")
    );
    expect(useAgents.getState().readFailed).toEqual({ t: true });
    fakeApi.respondStream("threads.follow", () => [synchronized(1)]);
    fakeApi.disconnect();
    fakeApi.connect();
    expect(useAgents.getState().readFailed).toEqual({});
    expect(useAgents.getState().items.t).toEqual([said("1", "Hello")]);
  });

  it("keeps a thread's newer row over a list read answered after it", async () => {
    fakeApi.respond("agents.list", () => []);
    fakeApi.respond("threads.list", () => [
      { ...thread("t"), status: "idle", updatedAt: 1 },
    ]);
    useAgents.setState({
      threads: [{ ...thread("t"), status: "running", updatedAt: 2 }],
    });
    await useAgents.getState().load();
    expect(useAgents.getState().threads[0]?.status).toBe("running");
    fakeApi.respond("threads.list", () => [
      { ...thread("t"), status: "idle", updatedAt: 3 },
    ]);
    await useAgents.getState().load();
    expect(useAgents.getState().threads[0]?.status).toBe("idle");
  });

  it("keeps a rename or a settling over a list read at the same time, with the read's line (ADR 0141)", async () => {
    fakeApi.respond("agents.list", () => []);
    fakeApi.respond("threads.list", () => [
      {
        ...thread("t"),
        summary: { text: "Read now", waiting: false },
        title: "Before",
        updatedAt: 2,
      },
    ]);
    useAgents.setState({
      threads: [
        { ...thread("t"), settledAt: 5, title: "Renamed", updatedAt: 2 },
      ],
    });
    await useAgents.getState().load();
    const [kept] = useAgents.getState().threads;
    expect([kept?.title, kept?.settledAt, kept?.summary?.text]).toEqual([
      "Renamed",
      5,
      "Read now",
    ]);
  });

  it("says its transcript could not be read, until it is", async () => {
    fakeApi.respondStream("threads.follow", () => []);
    useAgents.setState({ threads: [thread("t")] });
    const opened = useAgents.getState().open("t");
    fakeApi.failStream(
      "threads.follow",
      new RequestError("internal", "the file is gone")
    );
    await opened;
    expect(useAgents.getState().readFailed).toEqual({ t: true });
    expect(useAgents.getState().items.t).toBeUndefined();
    // Asked again, it is being read: not failed while it is, nor once it is read.
    const again = useAgents.getState().open("t");
    expect(useAgents.getState().readFailed).toEqual({});
    // On a stream of its own: the failed one hears nothing more.
    expect(followedFrom()).toHaveLength(2);
    fakeApi.send("threads.follow", snapshot(1, [said("1", "Hello")]));
    fakeApi.send("threads.follow", synchronized(1));
    await again;
    expect(useAgents.getState().items.t).toEqual([said("1", "Hello")]);
  });
});
