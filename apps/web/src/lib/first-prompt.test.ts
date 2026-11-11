import "../testing/fake-browser.ts";
import type { FirstPrompt } from "@ultrapaint/contracts/shell-bridge";
import type { Thread } from "@ultrapaint/contracts/threads";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type Platform, setPlatform } from "../platform.ts";
import { fakeApi } from "../testing/fake-api.ts";
import { sendFirstPrompt } from "./first-prompt.ts";

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);
// The chat panel is the threads' own business; here it is only opened.
vi.mock("../state/panels.ts", () => ({ showLeftPanel: vi.fn() }));

/** The desktop app, keeping `start` for the project until the editor takes it. */
const withPrompt = (start: FirstPrompt | null) => {
  let kept = start;
  setPlatform({
    projects: {
      takeFirstPrompt: () => {
        const taken = kept;
        kept = null;
        return Promise.resolve(taken);
      },
    },
    serverUrl: "ws://127.0.0.1:4770",
  } as unknown as Platform);
};

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
  setPlatform(null);
});

describe("the start screen's prompt", () => {
  it("is sent in a new chat with the agent and model chosen, once", async () => {
    withPrompt({
      agentId: "claude-code",
      look: "agent",
      model: "opus",
      prompt: "A habit tracker",
    });
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
    fakeApi.reset();
    await sendFirstPrompt();
    expect(fakeApi.calls).toEqual([]);
  });

  it("carries the pictures and files attached on the start screen", async () => {
    const attachments = [
      {
        dataUrl: "data:image/png;base64,AAAA",
        kind: "image" as const,
        name: "Sketch",
      },
      { kind: "text" as const, name: "brief.md", text: "Warm, quiet" },
    ];
    withPrompt({ attachments, look: "agent", prompt: "A café" });
    answerThreads();
    await sendFirstPrompt();
    expect(call("threads.prompt")).toEqual({
      attachments,
      text: "A café",
      threadId: "t1",
    });
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
    await sendFirstPrompt((pending) => opened.push(pending));
    expect(opened).toEqual([{ look: "pick", prompt: "A shop" }]);
    expect(call("threads.prompt")).toBeUndefined();
  });

  it("sends nothing when the project was opened without one, or in a browser", async () => {
    withPrompt(null);
    await sendFirstPrompt();
    setPlatform(null);
    await sendFirstPrompt();
    expect(fakeApi.calls).toEqual([]);
  });
});
