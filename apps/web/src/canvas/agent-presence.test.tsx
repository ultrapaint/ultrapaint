// @vitest-environment happy-dom
import "../testing/fake-browser.ts";
import type { Page } from "@ultrapaint/contracts/pages";
import type { Thread, ThreadItem } from "@ultrapaint/contracts/threads";
import { act, Profiler } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAgents } from "../state/agents.ts";
import { useProject } from "../state/project.ts";
import { followServer } from "../state/server-data.ts";
import { fakeApi } from "../testing/fake-api.ts";
import { FramePresence, PresenceLabel } from "./agent-presence.tsx";

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

const pages = ["home", "pricing", "about"].map(
  (id) => ({ file: `designs/${id}.page.json`, id }) as Page
);

const initial = useAgents.getState();
let mounted: Root;
let container: HTMLElement;
let stop: () => void;

beforeEach(() => {
  fakeApi.reset();
  useAgents.setState(initial, true);
  useProject.setState({ pages });
  stop = followServer({ report: () => undefined });
  container = document.createElement("div");
  document.body.append(container);
  mounted = createRoot(container);
});

afterEach(() => {
  act(() => mounted.unmount());
  container.remove();
  stop();
  useProject.setState({ pages: [] });
});

it("draws no frame again while chats stream their replies", () => {
  useAgents.setState({
    focused: { b: "pricing" },
    items: { a: [said("1", "Hello ")], b: [said("2", "Looking ")] },
    threads: [
      thread("a", { summary: { text: "Hello", waiting: false } }),
      thread("b", { summary: { text: "Looking", waiting: false } }),
    ],
  });
  let drawn = 0;
  act(() =>
    mounted.render(
      <Profiler
        id="frames"
        onRender={() => {
          drawn += 1;
        }}
      >
        {pages.map((p) => (
          <div key={p.id}>
            <FramePresence pageId={p.id} />
            <PresenceLabel pageId={p.id} />
          </div>
        ))}
      </Profiler>
    )
  );
  expect(container.textContent).toContain("Chat b · thinking");
  drawn = 0;
  // Each chunk on its own, as each arrives from the server.
  for (let i = 0; i < 20; i += 1) {
    act(() => {
      fakeApi.emit("agent", {
        itemId: "1",
        offset: 6 + i,
        text: "x",
        threadId: "a",
        type: "itemText",
      });
    });
    act(() => {
      fakeApi.emit("agent", {
        itemId: "2",
        offset: 8 + i,
        text: "y",
        threadId: "b",
        type: "itemText",
      });
    });
  }
  expect(drawn).toBe(0);
});

it("renames the agent on its frame when its chat is renamed", () => {
  useAgents.setState({
    focused: { b: "pricing" },
    threads: [thread("b")],
  });
  act(() => mounted.render(<PresenceLabel pageId="pricing" />));
  act(() => {
    fakeApi.emit("agent", {
      thread: thread("b", { title: "Pricing ideas" }),
      type: "thread",
    });
  });
  expect(container.textContent).toContain("Pricing ideas · thinking");
});
