// @vitest-environment happy-dom
import "../testing/fake-browser.ts";
import type { ProjectInfo } from "@ultrapaint/contracts/project";
import type { Thread, ThreadItem } from "@ultrapaint/contracts/threads";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAgents } from "../state/agents.ts";
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

const thread = (id: string, extra: Partial<Thread> = {}): Thread => ({
  agentId: "claude-code",
  createdAt: 1,
  id,
  status: "running",
  title: `Chat ${id}`,
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
let mounted: Root;
let container: HTMLElement;
let stop: () => void;

beforeEach(() => {
  fakeApi.reset();
  useAgents.setState(initial, true);
  useProject.setState({
    info: {
      configured: true,
      name: "bike-shop",
      setup: "saved",
      storage: { mode: "ephemeral" },
    } as ProjectInfo,
  });
  stop = followServer({ report: () => undefined });
  container = document.createElement("div");
  document.body.append(container);
  mounted = createRoot(container);
});

afterEach(() => {
  act(() => mounted.unmount());
  container.remove();
  stop();
  localStorage.clear();
});

const rowOf = (title: string) =>
  [...container.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(title)
  );

it("says each chat's last line as its agent streams it, and as the list was read", () => {
  useAgents.setState({
    items: { a: [said("1", "Hello ")] },
    threads: [
      thread("a", { summary: { text: "Hello", waiting: false } }),
      thread("b", { summary: { text: "Read before", waiting: false } }),
    ],
  });
  act(() => mounted.render(<ThreadList />));
  act(() => {
    fakeApi.emit("agent", {
      itemId: "1",
      offset: 6,
      text: "world",
      threadId: "a",
      type: "itemText",
    });
  });
  expect(rowOf("Chat a")?.textContent).toContain("Hello world");
  // A chat whose transcript the editor does not hold says what the list was read with.
  expect(rowOf("Chat b")?.textContent).toContain("Read before");
});

it("finds a chat by the line it streams", () => {
  useAgents.setState({
    items: { a: [said("1", "Looking at the ")] },
    threads: [thread("a"), thread("b")],
  });
  act(() => mounted.render(<ThreadList />));
  act(() => {
    fakeApi.emit("agent", {
      itemId: "1",
      offset: 15,
      text: "checkout",
      threadId: "a",
      type: "itemText",
    });
  });
  const search = container.querySelector<HTMLInputElement>("input");
  expect(search).not.toBeNull();
  act(() => {
    const set = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )?.set;
    set?.call(search, "checkout");
    search?.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(rowOf("Chat a")).toBeDefined();
  expect(rowOf("Chat b")).toBeUndefined();
});
