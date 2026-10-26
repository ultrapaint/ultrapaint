import path from "node:path";
import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Effect, FileSystem, Layer } from "effect";
import { AgentSettings } from "./agent-settings.ts";
import { Agents, electronReads, makeRuntime } from "./agents.ts";
import { LoginShell } from "./login-shell.ts";

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

/** A directory with fake `claude` and `codex` executables that answer as the real ones do. */
const fakeAgents = (options: {
  claudeSignedIn: boolean;
  codexSignedIn: boolean;
}) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const dir = yield* fs.realPath(yield* fs.makeTempDirectoryScoped());
    const write = (name: string, body: string) =>
      Effect.andThen(
        fs.writeFileString(path.join(dir, name), `#!/bin/sh\n${body}\n`),
        fs.chmod(path.join(dir, name), 0o755)
      );
    yield* write(
      "claude",
      [
        'if [ "$1" = "--version" ]; then echo "2.1.308 (Claude Code)"; exit 0; fi',
        options.claudeSignedIn
          ? `echo '{"loggedIn": true, "authMethod": "claude.ai"}'; exit 0`
          : `echo '{"loggedIn": false, "authMethod": "none"}'; exit 1`,
      ].join("\n")
    );
    yield* write(
      "codex",
      [
        'if [ "$1" = "--version" ]; then echo "codex-cli 0.160.1"; exit 0; fi',
        options.codexSignedIn
          ? 'echo "Logged in using ChatGPT" >&2; exit 0'
          : 'echo "Not logged in" >&2; exit 1',
      ].join("\n")
    );
    return dir;
  });

const agentsOn = (searchPath: string, dataDir: string) =>
  Agents.layer(layout).pipe(
    Layer.provideMerge(AgentSettings.layer(dataDir)),
    Layer.provide(LoginShell.layerTest({ PATH: searchPath })),
    Layer.provideMerge(NodeServices.layer)
  );

describe("Agents", () => {
  it.effect(
    "finds the agents on the PATH and asks each whether it is signed in",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const bin = yield* fakeAgents({
          claudeSignedIn: true,
          codexSignedIn: false,
        });
        const data = yield* fs.makeTempDirectoryScoped();
        const status = yield* Effect.provide(
          Agents.use((a) => a.status),
          agentsOn(`/nonexistent:${bin}`, data)
        );
        expect(status).toEqual([
          {
            detail: "Signed in with claude.ai.",
            executable: path.join(bin, "claude"),
            id: "claude-code",
            install: "https://code.claude.com/docs/en/setup",
            name: "Claude Code",
            source: "path",
            state: "ready",
            version: "2.1.308",
          },
          {
            detail:
              "Not signed in. Run `codex login` once in a terminal to sign in.",
            executable: path.join(bin, "codex"),
            id: "codex",
            install: "https://developers.openai.com/codex/cli",
            name: "Codex",
            source: "path",
            state: "signed-out",
            version: "0.160.1",
          },
        ]);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.effect(
    "takes the path set in the settings over the PATH, and says when it does not run",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const bin = yield* fakeAgents({
          claudeSignedIn: true,
          codexSignedIn: true,
        });
        const data = yield* fs.makeTempDirectoryScoped();
        const result = yield* Effect.gen(function* () {
          const settings = yield* AgentSettings;
          const agents = yield* Agents;
          yield* settings.update("codex", () => ({
            path: path.join(bin, "codex"),
          }));
          yield* settings.update("claude-code", () => ({
            path: "/nowhere/claude",
          }));
          return {
            runtime: yield* agents.runtime,
            status: yield* agents.status,
          };
        }).pipe(Effect.provide(agentsOn("/nonexistent", data)));
        const [claude, codex] = result.status;
        expect(claude?.state).toBe("missing");
        expect(claude?.detail).toContain(
          "/nowhere/claude, set in the app's settings"
        );
        expect(claude?.customPath).toBe("/nowhere/claude");
        expect(codex?.state).toBe("ready");
        expect(codex?.source).toBe("setting");
        // The server is told where Codex is; Claude Code's adapter says how to install it.
        expect(result.runtime.agents.codex?.env).toEqual({
          CODEX_PATH: path.join(bin, "codex"),
        });
        expect(result.runtime.agents["claude-code"]?.hint).toContain(
          "is not installed"
        );
        expect(result.runtime.reads).toContain(bin);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );
});
