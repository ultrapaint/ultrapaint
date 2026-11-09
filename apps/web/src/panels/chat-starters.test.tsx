// @vitest-environment happy-dom
import "../testing/fake-browser.ts";
import type { ProjectInfo } from "@ultrapaint/contracts/project";
import type { Thread } from "@ultrapaint/contracts/threads";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { showLeftPanel } from "../state/panels.ts";
import { useProject } from "../state/project.ts";
import { fakeApi } from "../testing/fake-api.ts";
import { ThreadList } from "./chat-list.tsx";
import { ChatStarters } from "./chat-starters.tsx";

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);
vi.mock("../state/panels.ts", () => ({ showLeftPanel: vi.fn() }));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const thread: Thread = {
  agentId: "claude-code",
  createdAt: 0,
  id: "t1",
  status: "idle",
  title: "New chat",
  updatedAt: 0,
};

let mounted: Root;
let container: HTMLElement;

const opened = (setup: ProjectInfo["setup"]) => {
  useProject.setState({
    info: {
      configured: true,
      name: "bike-shop",
      setup,
      storage: { mode: "ephemeral" },
    } as ProjectInfo,
  });
  act(() => mounted.render(<ChatStarters thread={thread} />));
};

const starters = () =>
  [...container.querySelectorAll("button")].map((b) => b.textContent);

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  mounted = createRoot(container);
});

afterEach(() => {
  act(() => mounted.unmount());
  container.remove();
  fakeApi.reset();
  vi.mocked(showLeftPanel).mockReset();
});

describe("a new chat's starters", () => {
  it("suggest setting up a folder whose settings were detected, sending nothing", () => {
    opened("detected");
    expect(starters()[0]).toBe("Set up bike-shop");
    act(() => {
      container.querySelector("button")?.click();
    });
    expect(showLeftPanel).toHaveBeenCalledWith({
      chat: "t1",
      draft: "/setup",
    });
    expect(fakeApi.calls).toEqual([]);
  });

  it("suggest no setup once the settings are saved", () => {
    opened("saved");
    expect(starters()).not.toContain("Set up bike-shop");
  });
});

describe("the agents' list with no chats", () => {
  it("suggests a detected folder's setup, drafted in a new chat and not sent", async () => {
    fakeApi.respond("threads.create", () => thread);
    const shown = new Promise((resolve) => {
      // The chat panel first, then the new chat with its draft.
      vi.mocked(showLeftPanel).mockImplementation((to) => {
        if (typeof to === "object") {
          resolve(to);
        }
        return Promise.resolve();
      });
    });
    useProject.setState({
      info: {
        configured: true,
        name: "bike-shop",
        setup: "detected",
        storage: { mode: "ephemeral" },
      } as ProjectInfo,
    });
    act(() => mounted.render(<ThreadList />));
    const setUp = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "Set up bike-shop"
    );
    act(() => setUp?.click());
    expect(await shown).toEqual({ chat: thread, draft: "/setup " });
    expect(fakeApi.calls.map((c) => c.method)).toEqual(["threads.create"]);
  });
});
