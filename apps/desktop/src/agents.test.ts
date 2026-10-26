import path from "node:path";
import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Effect, FileSystem, Layer } from "effect";
import { AgentDownloads } from "./agent-downloads.ts";
import { AgentSettings } from "./agent-settings.ts";
import { Agents, electronReads, makeRuntime } from "./agents.ts";
import { LoginShell } from "./login-shell.ts";
import { Secrets } from "./secrets.ts";

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
    Layer.provideMerge(
      AgentDownloads.layer(path.join(dataDir, "agents"), {
        codex: {
          entrypoint: "bin/codex",
          kind: "tar-gz-package",
          sha256: "0".repeat(64),
          size: 1000,
          target: "x86_64-test",
          url: "http://127.0.0.1:9/codex.tar.gz",
          version: "0.0.1",
        },
      })
    ),
    Layer.provideMerge(Secrets.layerTest),
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
            apiKey: false,
            canKeepKey: true,
            detail: "Signed in with claude.ai.",
            executable: path.join(bin, "claude"),
            id: "claude-code",
            install: "https://code.claude.com/docs/en/setup",
            name: "Claude Code",
            signIn: "terminal",
            source: "path",
            state: "ready",
            version: "2.1.308",
          },
          {
            detail:
              "Not signed in. Sign in with ChatGPT below, or run `codex login` in a terminal.",
            executable: path.join(bin, "codex"),
            id: "codex",
            install: "https://developers.openai.com/codex/cli",
            name: "Codex",
            signIn: "chatgpt",
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

  it.effect(
    "offers to download an agent not found, and finds it once downloaded",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const data = yield* fs.makeTempDirectoryScoped();
        const status = yield* Effect.provide(
          Agents.use((a) => a.status),
          agentsOn("/nonexistent", data)
        );
        const codex = status.find((a) => a.id === "codex");
        expect(codex?.state).toBe("missing");
        expect(codex?.download).toEqual({ size: 1000, version: "0.0.1" });
        // There is no release of Claude Code here to offer.
        expect(
          status.find((a) => a.id === "claude-code")?.download
        ).toBeUndefined();

        // As a download leaves it: the release's files, and the record beside them.
        const bin = path.join(data, "agents", "codex", "0.0.1", "bin");
        yield* fs.makeDirectory(bin, { recursive: true });
        yield* fs.writeFileString(
          path.join(bin, "codex"),
          "#!/bin/sh\nexit 0\n"
        );
        yield* fs.chmod(path.join(bin, "codex"), 0o755);
        yield* fs.writeFileString(
          path.join(data, "agents", "codex", "installed.json"),
          JSON.stringify({
            executable: "0.0.1/bin/codex",
            sha256: "x",
            version: "0.0.1",
          })
        );
        const located = yield* Effect.provide(
          Agents.use((a) => a.locate("codex")),
          agentsOn("/nonexistent", data)
        );
        expect(located).toEqual({
          _tag: "Found",
          executable: path.join(bin, "codex"),
          source: "download",
        });
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.effect(
    "signs Claude Code in with a key it keeps encrypted, and gives it to the adapter alone",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const bin = yield* fakeAgents({
          claudeSignedIn: false,
          codexSignedIn: true,
        });
        const data = yield* fs.makeTempDirectoryScoped();
        const result = yield* Effect.gen(function* () {
          const agents = yield* Agents;
          yield* agents.setApiKey("claude-code", "sk-ant-secret");
          const kept = yield* fs.readFileString(path.join(data, "agents.json"));
          const keyed = {
            kept,
            runtime: yield* agents.runtime,
            status: yield* agents.status,
          };
          yield* agents.setApiKey("claude-code", undefined);
          return { ...keyed, forgotten: yield* agents.runtime };
        }).pipe(Effect.provide(agentsOn(bin, data)));
        expect(result.kept).not.toContain("sk-ant-secret");
        expect(result.status[0]?.state).toBe("ready");
        expect(result.status[0]?.apiKey).toBe(true);
        expect(
          result.runtime.agents["claude-code"]?.env.ANTHROPIC_API_KEY
        ).toBe("sk-ant-secret");
        expect(
          result.runtime.agents.codex?.env.ANTHROPIC_API_KEY
        ).toBeUndefined();
        expect(
          result.forgotten.agents["claude-code"]?.env.ANTHROPIC_API_KEY
        ).toBeUndefined();
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );
});

/** The bundled layout, with Codex's adapter played by the fake ACP agent, on this Node. */
const fakeAdapters = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const dir = yield* fs.makeTempDirectoryScoped();
  yield* fs.copyFile(
    path.resolve(import.meta.dirname, "adapter-run.ts"),
    path.join(dir, "run.mjs")
  );
  yield* fs.symlink(
    path.resolve(
      import.meta.dirname,
      "../../../packages/acp/testing/fake-agent.mjs"
    ),
    path.join(dir, "codex-acp.mjs")
  );
  return { adaptersDir: dir, node: process.execPath };
});

describe("Agents.signIn", () => {
  it.effect(
    "signs Codex in through its adapter's ChatGPT method, and says when there is none",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const bin = yield* fakeAgents({
          claudeSignedIn: true,
          codexSignedIn: false,
        });
        const data = yield* fs.makeTempDirectoryScoped();
        const adapters = yield* fakeAdapters;
        const signInWith = (method: string) =>
          Effect.provide(
            Agents.use((a) => a.signIn("codex")),
            Agents.layer(adapters).pipe(
              Layer.provideMerge(AgentSettings.layer(data)),
              Layer.provideMerge(
                AgentDownloads.layer(path.join(data, "agents"), {})
              ),
              Layer.provideMerge(Secrets.layerTest),
              Layer.provide(
                LoginShell.layerTest({
                  FAKE_AGENT_AUTH_METHOD: method,
                  PATH: bin,
                })
              ),
              Layer.provideMerge(NodeServices.layer)
            )
          );
        yield* signInWith("chat-gpt");
        const error = yield* Effect.flip(signInWith("api-key"));
        expect(error.message).toContain("offers no ChatGPT sign-in");
        const claude = yield* Effect.flip(
          Effect.provide(
            Agents.use((a) => a.signIn("claude-code")),
            agentsOn(bin, data)
          )
        );
        expect(claude.message).toContain("run `claude` once in a terminal");
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );
});
