// @vitest-environment happy-dom
import "../testing/fake-browser.ts";
import type { Thread, ThreadItem } from "@ultrapaint/contracts/threads";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { markUnread, useAgents } from "../state/agents.ts";
import { CLOSED_AT_FIRST, useChatListFolds } from "../state/chat-list-folds.ts";
import { useChatRename } from "../state/chat-rename.ts";
import { useDrafts } from "../state/drafts.ts";
import { DEFAULT_PREFERENCES, usePreferences } from "../state/preferences.ts";
import { useProject } from "../state/project.ts";
import { followServer } from "../state/server-data.ts";
import { fakeApi } from "../testing/fake-api.ts";
import { ThreadList } from "./chat-list.tsx";

vi.mock("sonner", async (original) => ({
  ...(await original<typeof import("sonner")>()),
  toast: vi.fn(),
}));

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = Date.UTC(2026, 10, 24, 12);
const MINUTE = 60_000;

const chat = (
  id: string,
  title: string,
  status: Thread["status"],
  summary: Thread["summary"],
  updatedAt = NOW - MINUTE
): Thread => ({
  agentId: "claude-code",
  createdAt: NOW - 60 * MINUTE,
  id,
  status,
  summary,
  title,
  updatedAt,
});

const projectState = useProject.getState();
const agentsState = useAgents.getState();
let mounted: Root;
let container: HTMLElement;

/** Types into a field as a person does: React hears the value change. */
const typeInto = (field: HTMLInputElement | null, text: string) => {
  const set = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value"
  )?.set;
  set?.call(field, text);
  field?.dispatchEvent(new Event("input", { bubbles: true }));
};

/** The row of the chat titled so, by its text. */
const row = (title: string) =>
  [...container.querySelectorAll("button")].find((b) =>
    b.textContent?.startsWith(title)
  );

const show = (threads: Thread[], seen: Record<string, number> = {}) =>
  act(() => {
    useAgents.setState({ seen, threads });
    mounted.render(<ThreadList />);
  });

beforeEach(() => {
  // fake clock: the rows say how long a turn has run.
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  container = document.createElement("div");
  document.body.append(container);
  mounted = createRoot(container);
});

afterEach(() => {
  act(() => mounted.unmount());
  container.remove();
  useAgents.setState(agentsState, true);
  useProject.setState(projectState, true);
  useDrafts.setState({ byThread: {} });
  useChatRename.getState().done();
  useChatListFolds.setState({ closed: CLOSED_AT_FIRST });
  localStorage.clear();
  usePreferences.getState().setAll(DEFAULT_PREFERENCES);
  vi.mocked(toast).mockClear();
  vi.useRealTimers();
});

describe("a row of the chat list", () => {
  it("says where each chat stands, what needs the person first", async () => {
    const asked = {
      since: NOW - 4 * MINUTE,
      text: "Which hero?",
      waiting: true,
    };
    const said = { since: NOW - 9 * MINUTE, text: "Done.", waiting: false };
    await show(
      [
        chat("t1", "Questionario", "running", said),
        chat("t2", "Pricing hero", "running", asked),
        chat("t3", "Onboarding copy", "idle", said),
        chat("t4", "Billing table", "error", said),
        chat("t5", "Footer links", "idle", said, NOW - 3 * 60 * MINUTE),
      ],
      // The footer's chat was opened since its turn ended; the others were not.
      { t5: NOW }
    );
    expect(row("Questionario")?.textContent).toContain("Working 9m");
    expect(row("Pricing hero")?.textContent).toContain("Your turn");
    expect(row("Onboarding copy")?.textContent).toContain("Done");
    expect(row("Billing table")?.textContent).toContain("Stopped");
    expect(row("Footer links")?.textContent).toContain("3h");
    // The agent's last line is no longer in the row.
    expect(container.textContent).not.toContain("Which hero?");
  });

  it("shows a pen before the title while the chat's composer holds a draft", async () => {
    useDrafts.setState({ byThread: { t1: "Also check the" } });
    const said = { since: NOW - MINUTE, text: "Done.", waiting: false };
    await show([
      chat("t1", "Questionario", "running", said),
      chat("t2", "Pricing hero", "idle", said),
    ]);
    expect(
      row("Questionario")?.querySelector("[aria-label='Draft not sent']")
    ).not.toBeNull();
    expect(
      row("Pricing hero")?.querySelector("[aria-label='Draft not sent']")
    ).toBeNull();
  });

  it("says where a chat works under its title", async () => {
    useProject.setState({
      pages: [
        {
          file: "orientamento.page.json",
          id: "p1",
          name: "Orientamento",
          route: "/orientamento",
        },
      ] as never,
    });
    const thread = {
      ...chat("t1", "Questionario", "idle", undefined),
      scope: {
        count: 1,
        file: "orientamento.page.json",
        name: "Dubbi?",
        nodeId: "c_1",
      },
    };
    await show([thread, chat("t2", "Pricing hero", "idle", undefined)]);
    expect(row("Questionario")?.textContent).toContain(
      "Dubbi? · /orientamento"
    );
    expect(row("Pricing hero")?.textContent).toContain("Nothing attached");
  });
});

describe("the search", () => {
  let stop: () => void;
  beforeEach(() => {
    fakeApi.reset();
    stop = followServer({ report: () => undefined });
  });
  afterEach(() => stop());

  it("finds a chat by the line its agent streams, which the row does not show", async () => {
    const said: ThreadItem = {
      at: 1,
      id: "1",
      kind: "agent",
      text: "Looking at the ",
    };
    useAgents.setState({ items: { t1: [said] } });
    await show([
      chat("t1", "Questionario", "running", undefined),
      chat("t2", "Pricing hero", "running", undefined),
    ]);
    act(() => {
      fakeApi.emit("agent", {
        itemId: "1",
        offset: 15,
        text: "checkout",
        threadId: "t1",
        type: "itemText",
      });
    });
    expect(row("Questionario")?.textContent).not.toContain("checkout");
    const search = container.querySelector<HTMLInputElement>("input");
    act(() => typeInto(search, "checkout"));
    expect(row("Questionario")).toBeDefined();
    expect(row("Pricing hero")).toBeUndefined();
  });
});

/** The button named so, by its text or its label. */
const button = (name: string) =>
  [...container.querySelectorAll("button")].find(
    (b) => b.textContent === name || b.getAttribute("aria-label") === name
  );

/** The list's headings, as each reads. */
const headings = () =>
  [...container.querySelectorAll("h3")].map((h) => h.textContent);

const ended = { since: NOW - 9 * MINUTE, text: "Done.", waiting: false };

describe("the chat list's actions (ADR 0141)", () => {
  beforeEach(() => {
    fakeApi.reset();
    fakeApi.respond("threads.settle", () => undefined);
    fakeApi.respond("threads.rename", () => undefined);
  });

  it("settles a chat from its row, and brings a settled one back", async () => {
    await show([
      chat("t1", "Pricing hero", "idle", ended),
      { ...chat("t2", "Footer links", "idle", ended), settledAt: NOW },
    ]);
    // The row's actions are in its state's place, shown on hover or once the keyboard is there.
    await act(async () => button("Settle")?.click());
    expect(fakeApi.calls.at(-1)).toEqual({
      input: { settled: true, threadId: "t1" },
      method: "threads.settle",
    });
    // The settled chat is in Settled, closed, with its count, until it is opened.
    expect(headings()).toContain("Settled1");
    expect(row("Footer links")).toBeUndefined();
    await act(async () => button("Settled1")?.click());
    await act(async () => button("Un-settle")?.click());
    expect(fakeApi.calls.at(-1)).toEqual({
      input: { settled: false, threadId: "t2" },
      method: "threads.settle",
    });
  });

  it("keeps the Settled group as it was left, after the chat list is left and come back to", async () => {
    const chats = [
      chat("t1", "Pricing hero", "idle", ended),
      { ...chat("t2", "Footer links", "idle", ended), settledAt: NOW },
    ];
    await show(chats);
    await act(async () => button("Settled1")?.click());
    act(() => mounted.render(null));
    await show(chats);
    expect(row("Footer links")).toBeDefined();
  });

  it("discards a chat's draft, and Undo puts it back", async () => {
    useDrafts.setState({ byThread: { t1: "Also check the" } });
    await show([chat("t1", "Pricing hero", "idle", ended)]);
    await act(async () => button("Discard draft")?.click());
    expect(useDrafts.getState().byThread.t1).toBeUndefined();
    const [message, options] = vi.mocked(toast).mock.calls[0] ?? [];
    expect(message).toBe("Draft discarded");
    const undo = (options as unknown as { action: { onClick: () => void } })
      .action;
    act(() => undo.onClick());
    expect(useDrafts.getState().byThread.t1).toBe("Also check the");
  });

  it("keeps a draft written since when Undo would put a discarded one back", async () => {
    useDrafts.setState({ byThread: { t1: "Also check the" } });
    await show([chat("t1", "Pricing hero", "idle", ended)]);
    await act(async () => button("Discard draft")?.click());
    act(() => useDrafts.setState({ byThread: { t1: "Something else" } }));
    const [, options] = vi.mocked(toast).mock.calls[0] ?? [];
    const undo = (options as unknown as { action: { onClick: () => void } })
      .action;
    act(() => undo.onClick());
    expect(useDrafts.getState().byThread.t1).toBe("Something else");
  });

  it("renames a chat in place: Enter sends the title, Escape keeps the old one", async () => {
    await show([chat("t1", "Pricing hero", "idle", ended)]);
    const field = () =>
      container.querySelector<HTMLInputElement>("[aria-label='Chat title']");
    const type = (text: string) => act(() => typeInto(field(), text));
    const press = (key: string) =>
      act(() => {
        field()?.dispatchEvent(
          new KeyboardEvent("keydown", { bubbles: true, key })
        );
      });
    act(() => useChatRename.getState().start("t1"));
    await type("Something else");
    await press("Escape");
    expect(field()).toBeNull();
    expect(fakeApi.calls).toEqual([]);
    act(() => useChatRename.getState().start("t1"));
    await type("Pricing page hero");
    await press("Enter");
    expect(fakeApi.calls.at(-1)).toEqual({
      input: { threadId: "t1", title: "Pricing page hero" },
      method: "threads.rename",
    });
    // Sent once: the blur as the field goes is no second sending.
    expect(fakeApi.calls).toHaveLength(1);
    // The keyboard is back on the chat's row.
    expect(document.activeElement).toBe(row("Pricing hero"));
  });

  it("marks a chat unread: it reads Done again until it is opened", async () => {
    await show([chat("t1", "Pricing hero", "idle", ended)], { t1: NOW });
    expect(row("Pricing hero")?.textContent).not.toContain("Done");
    act(() => markUnread("t1"));
    expect(row("Pricing hero")?.textContent).toContain("Done");
  });

  it("groups the chats as the person chose, Working by state and Today by day", async () => {
    const chats = [
      chat("t1", "Pricing hero", "running", ended),
      chat("t2", "Footer links", "idle", ended, NOW - 3 * 24 * 60 * MINUTE),
    ];
    await show(chats);
    expect(headings()).toEqual(["Working1"]);
    act(() => usePreferences.getState().set("chatGrouping", "day"));
    expect(headings()).toEqual(["Today", "Earlier"]);
  });

  it("finds a settled chat by search, its group open while the search holds", async () => {
    await show([
      chat("t1", "Pricing hero", "idle", ended),
      { ...chat("t2", "Footer links", "idle", ended), settledAt: NOW },
    ]);
    const search = container.querySelector<HTMLInputElement>(
      "[aria-label='Search chats']"
    );
    act(() => typeInto(search, "footer"));
    expect(row("Footer links")).toBeDefined();
    expect(row("Pricing hero")).toBeUndefined();
  });
});
