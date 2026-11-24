// @vitest-environment happy-dom
import "../testing/fake-browser.ts";
import type { Thread, ThreadItem } from "@ultrapaint/contracts/threads";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAgents } from "../state/agents.ts";
import { useDrafts } from "../state/drafts.ts";
import { useProject } from "../state/project.ts";
import { followServer } from "../state/server-data.ts";
import { fakeApi } from "../testing/fake-api.ts";
import { ThreadList } from "./chat-list.tsx";

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
    act(() => {
      const set = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      )?.set;
      set?.call(search, "checkout");
      search?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(row("Questionario")).toBeDefined();
    expect(row("Pricing hero")).toBeUndefined();
  });
});
