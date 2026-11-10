// @vitest-environment happy-dom
import "../testing/fake-browser.ts";
import type { AgentConfig, AgentOptions } from "@ultrapaint/contracts/threads";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAgents } from "../state/agents.ts";
import { useProject } from "../state/project.ts";
import { fakeApi } from "../testing/fake-api.ts";
import { ChatDefaultsGroup } from "./settings-agents.tsx";

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const agent: AgentConfig = {
  args: [],
  builtIn: true,
  command: "claude",
  env: {},
  id: "claude",
  name: "Claude Code",
};

const options: AgentOptions = {
  agentId: "claude",
  configOptions: [
    {
      category: "thought_level",
      currentValue: "medium",
      id: "effort",
      name: "Effort",
      options: [
        { name: "Low", value: "low" },
        { name: "Medium", value: "medium" },
        { name: "High", value: "high" },
      ],
    },
  ],
};

let mounted: Root;
let container: HTMLElement;

const effort = (name: string) =>
  [...container.querySelectorAll("button")].find((b) => b.textContent === name);

const pressed = () =>
  [...container.querySelectorAll("button[aria-pressed=true]")].map(
    (b) => b.textContent
  );

beforeEach(async () => {
  fakeApi.reset();
  fakeApi.respond("agents.list", () => [agent]);
  fakeApi.respond("threads.list", () => []);
  fakeApi.respond("agents.options", () => [options]);
  fakeApi.respond("chat.defaults", () => ({
    agentId: "claude",
    effort: "low",
  }));
  useAgents.setState({ agents: [agent] });
  useProject.setState({ error: null });
  container = document.createElement("div");
  mounted = createRoot(container);
  act(() => mounted.render(<ChatDefaultsGroup />));
  await act(() => fakeApi.requested("chat.defaults"));
});

afterEach(() => {
  act(() => mounted.unmount());
  useAgents.setState({ agents: [] });
  useProject.setState({ error: null });
});

describe("Settings › Agents › New chats", () => {
  it("shows the default the server holds again when saving another fails", async () => {
    expect(pressed()).toEqual(["Low"]);
    fakeApi.respond("chat.setDefaults", () =>
      Promise.reject(new Error("the preferences could not be written"))
    );
    await act(async () => {
      effort("High")?.click();
      await fakeApi.requested("chat.setDefaults");
    });
    expect(pressed()).toEqual(["Low"]);
    expect(useProject.getState().error).toBe(
      "the preferences could not be written"
    );
  });

  it("goes back to the last default saved, not the one read at first", async () => {
    fakeApi.respond("chat.setDefaults", () => undefined);
    await act(async () => {
      effort("Medium")?.click();
      await fakeApi.requested("chat.setDefaults");
    });
    fakeApi.respond("chat.setDefaults", () => Promise.reject(new Error("no")));
    await act(async () => {
      effort("High")?.click();
      await fakeApi.requested("chat.setDefaults", 2);
    });
    expect(pressed()).toEqual(["Medium"]);
  });
});
