import "../testing/fake-browser.ts";
import type { Thread } from "@ultrapaint/contracts/threads";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeApi } from "../testing/fake-api.ts";
import { sendFirstPrompt } from "./first-prompt.ts";

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);
// The chat panel is the threads' own business; here it is only opened.
vi.mock("../state/panels.ts", () => ({ showLeftPanel: vi.fn() }));

const location = window.location as { href?: string; search: string };
const replaced: string[] = [];
window.history.replaceState = (_state, _title, url) => {
  replaced.push(String(url));
};

const openedWith = (search: string) => {
  location.search = search;
  location.href = `http://127.0.0.1:4770/${search}`;
};

const withPrompt = (start: object, extra = "") =>
  openedWith(
    `?first-prompt=${encodeURIComponent(JSON.stringify(start))}${extra}`
  );

const thread: Thread = {
  agentId: "claude-code",
  configOptions: [
    {
      category: "model",
      currentValue: "sonnet",
      id: "model",
      name: "Model",
      options: [
        { name: "Sonnet", value: "sonnet" },
        { name: "Opus", value: "opus" },
      ],
    },
  ],
  createdAt: 0,
  id: "t1",
  status: "idle",
  title: "New chat",
  updatedAt: 0,
};

const answerThreads = () => {
  fakeApi.respond("threads.create", () => thread);
  fakeApi.respond("threads.setConfigOption", () => undefined);
  fakeApi.respond("threads.prompt", () => undefined);
};

const call = (method: string) =>
  fakeApi.calls.find((c) => c.method === method)?.input;

afterEach(() => {
  fakeApi.reset();
  replaced.length = 0;
  openedWith("");
});

describe("the start screen's prompt", () => {
  it("is sent in a new chat with the agent and model chosen, and taken off the address", async () => {
    withPrompt(
      {
        agentId: "claude-code",
        look: "agent",
        model: "opus",
        prompt: "A habit tracker",
      },
      "&new-design=blank"
    );
    answerThreads();
    await sendFirstPrompt();
    expect(call("threads.create")).toEqual({ agentId: "claude-code" });
    expect(call("threads.setConfigOption")).toEqual({
      optionId: "model",
      threadId: "t1",
      value: "opus",
    });
    expect(call("threads.prompt")).toEqual({
      attachments: [],
      text: "A habit tracker",
      threadId: "t1",
    });
    // A reload sends nothing again.
    expect(replaced).toEqual(["/"]);
  });

  it("keeps the agent's model when the one chosen is not among its models", async () => {
    withPrompt({ look: "agent", model: "gone", prompt: "A shop" });
    answerThreads();
    await sendFirstPrompt();
    expect(call("threads.create")).toEqual({});
    expect(call("threads.setConfigOption")).toBeUndefined();
    expect(call("threads.prompt")).toMatchObject({ text: "A shop" });
  });

  it("opens the look page first when the person picks the look, and sends nothing yet", async () => {
    withPrompt({ look: "pick", prompt: "A shop" });
    answerThreads();
    const opened: unknown[] = [];
    await sendFirstPrompt(undefined, (pending) => opened.push(pending));
    expect(opened).toEqual([{ look: "pick", prompt: "A shop" }]);
    expect(call("threads.prompt")).toBeUndefined();
  });

  it("leaves any other opening of the editor as it is", async () => {
    openedWith("?page=home.page.json");
    await sendFirstPrompt();
    expect(fakeApi.calls).toEqual([]);
    expect(replaced).toEqual([]);
  });
});
