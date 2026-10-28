import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import { BUILT_IN_AGENTS, launchOf } from "./built-in.ts";
import { AgentRuntimeJson, withRuntime } from "./runtime.ts";

const runtime = {
  agents: {
    "claude-code": {
      adapter: "/app/adapters/claude-agent-acp.mjs",
      env: { CLAUDE_CODE_EXECUTABLE: "/home/me/.local/bin/claude" },
    },
    codex: {
      adapter: "/app/adapters/codex-acp.mjs",
      env: {},
      hint: "Codex is not installed: download it in Settings, under Agents.",
    },
  },
  node: "/opt/Ultrapaint/ultrapaint",
  reads: ["/opt/Ultrapaint"],
  wrapper: "/app/adapters/run.mjs",
};

const claude = launchOf(BUILT_IN_AGENTS["claude-code"]);
const codex = launchOf(BUILT_IN_AGENTS.codex);

describe("withRuntime", () => {
  it("leaves every launch as it is without a runtime: the command keeps npx", () => {
    expect(withRuntime(claude, undefined)).toBe(claude);
  });

  it("starts a built-in agent's bundled adapter through the wrapper, on Electron as Node", () => {
    const launched = withRuntime(claude, runtime);
    expect(launched.command).toBe("/opt/Ultrapaint/ultrapaint");
    expect(launched.args).toEqual([
      "/app/adapters/run.mjs",
      "/app/adapters/claude-agent-acp.mjs",
    ]);
    // Its own variables stay; the agent's executable and Node's switch come with them.
    expect(launched.env).toEqual({
      ...claude.env,
      CLAUDE_CODE_EXECUTABLE: "/home/me/.local/bin/claude",
      ELECTRON_RUN_AS_NODE: "1",
    });
    expect(launched.authHint).toBe(claude.authHint);
    expect(withRuntime(codex, runtime).authHint).toBe(
      "Codex is not installed: download it in Settings, under Agents."
    );
  });

  it("leaves an agent of the user's own alone, even under a built-in's id", () => {
    const custom = {
      args: [],
      builtIn: false,
      command: "my-agent",
      env: {},
      id: "codex",
      name: "Mine",
    };
    expect(withRuntime(custom, runtime)).toBe(custom);
  });

  it("is read from the JSON the app hands over", () => {
    const decoded = Schema.decodeUnknownSync(AgentRuntimeJson)(
      JSON.stringify(runtime)
    );
    expect(decoded.agents.codex?.adapter).toBe("/app/adapters/codex-acp.mjs");
  });
});
