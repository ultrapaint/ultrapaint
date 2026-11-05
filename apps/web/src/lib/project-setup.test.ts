import "../testing/fake-browser.ts";
import type { ProjectInfo } from "@ultrapaint/contracts/project";
import type { Thread } from "@ultrapaint/contracts/threads";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useProject } from "../state/project.ts";
import { fakeApi } from "../testing/fake-api.ts";
import { setUpOnOpen, startSetup } from "./project-setup.ts";

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);
vi.mock("../state/panels.ts", () => ({ showLeftPanel: vi.fn() }));

const thread = (title: string): Thread => ({
  agentId: "claude-code",
  createdAt: 0,
  id: "t1",
  status: "idle",
  title,
  updatedAt: 0,
});

const opened = (info: Partial<ProjectInfo>) =>
  useProject.setState({
    info: {
      configured: true,
      name: "bike-shop",
      storage: { mode: "ephemeral" },
      ...info,
    } as ProjectInfo,
  });

const inputsOf = (method: string) =>
  fakeApi.calls.filter((c) => c.method === method).map((c) => c.input);

afterEach(() => fakeApi.reset());

describe("a folder opened for the first time", () => {
  it("is set up in a chat of its own, sent /setup", async () => {
    opened({ setup: "detected" });
    fakeApi.respond("threads.list", () => []);
    fakeApi.respond("threads.create", () => thread("Set up bike-shop"));
    fakeApi.respond("threads.prompt", () => undefined);
    await setUpOnOpen();
    expect(inputsOf("threads.create")).toEqual([{ title: "Set up bike-shop" }]);
    expect(inputsOf("threads.prompt")).toEqual([
      { attachments: [], text: "/setup", threadId: "t1" },
    ]);
  });

  it("is not set up again while its setup chat is there, nor once saved", async () => {
    opened({ setup: "detected" });
    fakeApi.respond("threads.list", () => [thread("Set up bike-shop")]);
    await startSetup();
    opened({ setup: "saved" });
    await setUpOnOpen();
    expect(inputsOf("threads.create")).toEqual([]);
  });
});
