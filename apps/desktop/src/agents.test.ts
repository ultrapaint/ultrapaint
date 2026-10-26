import { describe, expect, it } from "@effect/vitest";
import { electronReads, makeRuntime } from "./agents.ts";

const layout = { adaptersDir: "/opt/app/adapters", node: "/opt/app/electron" };

describe("the agent runtime the app hands its servers", () => {
  it("starts each built-in adapter, told where its agent is", () => {
    const runtime = makeRuntime(
      layout,
      {
        "claude-code": {
          env: { ANTHROPIC_API_KEY: "sk-ant-test" },
          executable: "/usr/local/bin/claude",
        },
        codex: { executable: "/usr/local/bin/codex" },
      },
      {}
    );
    expect(runtime.node).toBe("/opt/app/electron");
    expect(runtime.wrapper).toBe("/opt/app/adapters/run.mjs");
    expect(runtime.agents["claude-code"]).toEqual({
      adapter: "/opt/app/adapters/claude-agent-acp.mjs",
      env: {
        ANTHROPIC_API_KEY: "sk-ant-test",
        CLAUDE_CODE_EXECUTABLE: "/usr/local/bin/claude",
      },
    });
    expect(runtime.agents.codex?.env).toEqual({
      CODEX_PATH: "/usr/local/bin/codex",
    });
    // The sandbox lets the agent read Electron, the adapters and the agents themselves.
    expect(runtime.reads).toEqual([
      "/opt/app",
      "/opt/app/adapters",
      "/usr/local/bin",
    ]);
  });

  it("still brings an agent not found, which then says how to install it", () => {
    const runtime = makeRuntime(layout, {}, { codex: "Install Codex." });
    expect(runtime.agents.codex).toEqual({
      adapter: "/opt/app/adapters/codex-acp.mjs",
      env: {},
      hint: "Install Codex.",
    });
  });

  it("reads all of the app bundle on macOS, whose frameworks the binary loads", () => {
    expect(
      electronReads(
        "/Users/me/Applications/Ultrapaint.app/Contents/MacOS/Ultrapaint"
      )
    ).toBe("/Users/me/Applications/Ultrapaint.app");
    expect(electronReads("/opt/Ultrapaint/ultrapaint")).toBe(
      "/opt/Ultrapaint"
    );
  });
});
