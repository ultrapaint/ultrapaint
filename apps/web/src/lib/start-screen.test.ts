import type { ChatPreferencesFile } from "@ultrapaint/contracts/threads";
import { describe, expect, it } from "vitest";
import type { PlatformAgent } from "../platform.ts";
import { firstStartModel, projectNameOf, startModels } from "./start-screen.ts";

describe("a project's name from its prompt", () => {
  it("is what the thing is, without the request around it", () => {
    expect(projectNameOf("Make me a booking app for a climbing gym")).toBe(
      "Booking app"
    );
    expect(projectNameOf("A habit tracker with streaks")).toBe("Habit tracker");
    expect(projectNameOf("I want a recipe site that plans the week")).toBe(
      "Recipe site"
    );
  });

  it("keeps four words at most, from the first line", () => {
    expect(
      projectNameOf("Bike shop admin orders dashboard\nwith refunds")
    ).toBe("Bike shop admin orders");
  });

  it("is Untitled when nothing names the thing", () => {
    expect(projectNameOf("")).toBe("Untitled");
    expect(projectNameOf("Make me a …")).toBe("Untitled");
  });
});

const agent = (
  id: PlatformAgent["id"],
  state: PlatformAgent["state"]
): PlatformAgent => ({
  detail: "",
  id,
  install: "",
  name: id === "claude-code" ? "Claude Code" : "Codex",
  state,
});

const remembered: ChatPreferencesFile = {
  agents: [
    {
      agentId: "claude-code",
      configOptions: [
        {
          category: "model",
          currentValue: "default",
          id: "model",
          name: "Model",
          options: [
            { name: "Default (recommended)", value: "default" },
            { name: "Opus", value: "opus" },
            { name: "Sonnet", value: "sonnet" },
          ],
        },
        {
          category: "thought_level",
          currentValue: "high",
          id: "effort",
          name: "Effort",
          options: [
            { name: "Medium", value: "medium" },
            { name: "High", value: "high" },
          ],
        },
      ],
    },
  ],
  defaults: {},
};

describe("the models the start screen offers", () => {
  it("are each agent's named models with the effort it last ran at, an agent never run as itself", () => {
    const agents = [
      agent("claude-code", "ready"),
      agent("codex", "signed-out"),
    ];
    expect(startModels(agents, remembered)).toEqual([
      {
        agentId: "claude-code",
        agentName: "Claude Code",
        effort: "High",
        label: "Opus",
        model: "opus",
      },
      {
        agentId: "claude-code",
        agentName: "Claude Code",
        effort: "High",
        label: "Sonnet",
        model: "sonnet",
      },
      { agentId: "codex", agentName: "Codex", label: "Codex" },
    ]);
  });

  it("leave out an agent that is not on this machine", () => {
    expect(
      startModels([agent("codex", "missing")], { agents: [], defaults: {} })
    ).toEqual([]);
  });

  it("start on the chat's default, else the model a signed-in agent last ran", () => {
    const agents = [
      agent("codex", "signed-out"),
      agent("claude-code", "ready"),
    ];
    const models = startModels(agents, remembered);
    // The agent's unnamed default stands for its first named model.
    expect(firstStartModel(models, agents, remembered)?.model).toBe("opus");
    const withDefault: ChatPreferencesFile = {
      ...remembered,
      defaults: { agentId: "claude-code", model: "sonnet" },
    };
    expect(firstStartModel(models, agents, withDefault)?.model).toBe("sonnet");
  });
});
