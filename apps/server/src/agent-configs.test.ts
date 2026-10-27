import { homedir } from "node:os";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import type { AgentRuntime } from "@ultrapaint/acp/runtime";
import { Effect, FileSystem, Layer } from "effect";
import { ServerConfig } from "./config.ts";
import { AgentConfigs } from "./services/threads/agent-configs.ts";

/** The launch configurations as a server started with `agentRuntime` lists them. */
const configsWith = (userDir: string, agentRuntime?: AgentRuntime) =>
  AgentConfigs.layer.pipe(
    Layer.provide(
      ServerConfig.layerTest({
        agentRuntime,
        cwd: userDir,
        machine: { home: homedir() },
        storage: { home: userDir, mode: "managed" },
        userDir,
      })
    )
  );

const runtime: AgentRuntime = {
  agents: {
    "claude-code": {
      adapter: "/app/adapters/claude-agent-acp.mjs",
      env: { CLAUDE_CODE_EXECUTABLE: "/usr/local/bin/claude" },
    },
  },
  node: "/opt/Ultrapaint/ultrapaint",
  reads: [],
  wrapper: "/app/adapters/run.mjs",
};

describe("AgentConfigs", () => {
  it.effect(
    "starts the built-in agents with npx for the command, and with the app's adapters under the desktop app",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const dir = yield* fs.makeTempDirectoryScoped();
        const command = yield* Effect.provide(
          AgentConfigs.use((c) => c.list),
          configsWith(dir)
        );
        assert.deepStrictEqual(
          command.map((a) => a.command),
          ["npx", "npx"]
        );
        const desktop = yield* Effect.provide(
          AgentConfigs.use((c) => c.list),
          configsWith(dir, runtime)
        );
        const claude = desktop.find((a) => a.id === "claude-code");
        assert.strictEqual(claude?.command, "/opt/Ultrapaint/ultrapaint");
        assert.deepStrictEqual(claude?.args, [
          "/app/adapters/run.mjs",
          "/app/adapters/claude-agent-acp.mjs",
        ]);
        assert.strictEqual(claude?.env.ELECTRON_RUN_AS_NODE, "1");
        // An agent the runtime does not bring keeps npx.
        assert.strictEqual(
          desktop.find((a) => a.id === "codex")?.command,
          "npx"
        );
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );
});
