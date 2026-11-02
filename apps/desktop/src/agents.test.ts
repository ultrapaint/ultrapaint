import path from "node:path";
import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import {
  BUILT_IN_AGENTS,
  type BuiltInAgent,
  type BuiltInAgents,
} from "@ultrapaint/acp/built-in";
import { Effect, FileSystem, Layer } from "effect";
import { AgentDownloads } from "./agent-downloads.ts";
import { AgentSettings } from "./agent-settings.ts";
import { Agents, electronReads, makeRuntime, signInHint } from "./agents.ts";
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
    expect(electronReads("/opt/Ultrapaint/ultrapaint")).toBe("/opt/Ultrapaint");
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
            signInWith: "ChatGPT",
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

/**
 * A third built-in agent, as a descriptor says it: a program of its own, asked `whoami` whether
 * it is signed in, with no key and no sign-in through its adapter, and a variable of its own when
 * downloaded. Nothing in the app may treat it as Claude Code or Codex.
 */
const third = {
  adapter: {
    bundle: "third-acp",
    entry: "dist/index.js",
    external: [],
    package: "third-acp",
    range: "^1.0.0",
  },
  env: { download: { THIRD_PINNED: "1" } },
  executable: {
    env: "THIRD_PATH",
    install: "https://example.com/third",
    program: "third",
  },
  // Not an id the shell bridge names: the app is run here on a list it does not ship.
  id: "third" as BuiltInAgent["id"],
  launch: { env: {} },
  name: "Third",
  signIn: {
    parse: (output) => ({
      how: output.stdout.trim() || undefined,
      signedIn: output.exitCode === 0,
    }),
    status: ["whoami"],
    yourself: "run `third login` in a terminal",
  },
} satisfies BuiltInAgent;
const threeAgents = {
  ...BUILT_IN_AGENTS,
  third,
} as unknown as BuiltInAgents;

describe("Agents on a third descriptor", () => {
  /** `third` on the PATH: it answers `whoami` only, as signed in or not. */
  const fakeThird = (dir: string, signedIn: boolean) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const file = path.join(dir, "third");
      yield* fs.writeFileString(
        file,
        [
          "#!/bin/sh",
          'if [ "$1" = "--version" ]; then echo "third 1.2.3"; exit 0; fi',
          signedIn
            ? 'if [ "$1" = "whoami" ]; then echo "as me@example.com"; exit 0; fi'
            : 'if [ "$1" = "whoami" ]; then exit 1; fi',
          // Codex's probe, or Claude Code's, would be taken for a sign-in here.
          'echo "Logged in using ChatGPT"; echo \'{"loggedIn": true}\'; exit 0',
        ].join("\n")
      );
      yield* fs.chmod(file, 0o755);
    });

  const threeOn = (searchPath: string, dataDir: string) =>
    Agents.layer(layout, threeAgents).pipe(
      Layer.provideMerge(AgentSettings.layer(dataDir)),
      Layer.provideMerge(
        AgentDownloads.layer(path.join(dataDir, "agents"), {})
      ),
      Layer.provideMerge(Secrets.layerTest),
      Layer.provide(LoginShell.layerTest({ PATH: searchPath })),
      Layer.provideMerge(NodeServices.layer)
    );

  it.effect(
    "asks it whether it is signed in its own way, and offers neither a key nor ChatGPT",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const bin = yield* fakeAgents({
          claudeSignedIn: true,
          codexSignedIn: true,
        });
        yield* fakeThird(bin, false);
        const data = yield* fs.makeTempDirectoryScoped();
        const status = yield* Effect.provide(
          Agents.use((a) => a.status),
          threeOn(bin, data)
        );
        expect(status.map((a) => a.id)).toEqual([
          "claude-code",
          "codex",
          "third",
        ]);
        expect(status[2]).toEqual({
          detail:
            "Not signed in. Sign in with Third: run `third login` in a terminal.",
          executable: path.join(bin, "third"),
          id: "third",
          install: "https://example.com/third",
          name: "Third",
          source: "path",
          state: "signed-out",
          version: "1.2.3",
        });

        yield* fakeThird(bin, true);
        const signedIn = yield* Effect.provide(
          Agents.use((a) => a.status),
          threeOn(bin, data)
        );
        expect(signedIn[2]?.detail).toBe("Signed in as me@example.com.");
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.effect(
    "starts its adapter told where it is, with the variables of where it was found, and no key",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const bin = yield* fs.realPath(yield* fs.makeTempDirectoryScoped());
        yield* fakeThird(bin, true);
        const data = yield* fs.realPath(yield* fs.makeTempDirectoryScoped());
        const runtimeOn = (searchPath: string) =>
          Effect.provide(
            Agents.use((a) => a.runtime),
            threeOn(searchPath, data)
          );
        const onPath = yield* runtimeOn(bin);
        expect(onPath.agents.third).toEqual({
          adapter: "/opt/app/adapters/third-acp.mjs",
          env: { THIRD_PATH: path.join(bin, "third") },
        });
        // Claude Code and Codex are not on this PATH: their adapters say how to install them.
        expect(onPath.agents.codex?.hint).toContain("Codex is not installed");

        // As a download leaves it: the release's executable, and the record beside it.
        const release = path.join(data, "agents", "third", "1.0.0");
        yield* fs.makeDirectory(release, { recursive: true });
        yield* fs.copyFile(
          path.join(bin, "third"),
          path.join(release, "third")
        );
        yield* fs.chmod(path.join(release, "third"), 0o755);
        yield* fs.writeFileString(
          path.join(data, "agents", "third", "installed.json"),
          JSON.stringify({
            executable: "1.0.0/third",
            sha256: "x",
            version: "1.0.0",
          })
        );
        const downloaded = yield* runtimeOn("/nonexistent");
        expect(downloaded.agents.third?.env).toEqual({
          THIRD_PATH: path.join(release, "third"),
          THIRD_PINNED: "1",
        });

        yield* Effect.provide(
          AgentSettings.use((s) =>
            s.update("third", () => ({ path: "/nowhere/third" }))
          ),
          AgentSettings.layer(data)
        );
        const missing = yield* runtimeOn(bin);
        expect(missing.agents.third?.hint).toBe(
          "Third is not installed: /nowhere/third, set in the app's settings, is not a program that runs. Install it (https://example.com/third), download it or set where it is in Settings, under Agents."
        );
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.effect(
    "refuses a key and a sign-in through the app, saying how it signs in",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const data = yield* fs.makeTempDirectoryScoped();
        const id = "third" as BuiltInAgent["id"];
        const errors = yield* Effect.gen(function* () {
          const agents = yield* Agents;
          return {
            key: yield* Effect.flip(agents.setApiKey(id, "sk-third")),
            signIn: yield* Effect.flip(agents.signIn(id)),
          };
        }).pipe(Effect.provide(threeOn("/nonexistent", data)));
        expect(errors.key.message).toBe("Third takes no API key here");
        expect(errors.signIn.message).toBe(
          "Third signs in by itself: run `third login` in a terminal."
        );
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it("says what to do by what the descriptor offers", () => {
    expect(signInHint(third, true)).toBe(
      "Sign in with Third: run `third login` in a terminal."
    );
    expect(signInHint(BUILT_IN_AGENTS["claude-code"], false)).toBe(
      "Sign in with Claude Code: run `claude` once in a terminal, or set ANTHROPIC_API_KEY in your shell's startup file."
    );
    expect(signInHint(BUILT_IN_AGENTS.codex, true)).toBe(
      "Sign in with ChatGPT below, or run `codex login` in a terminal."
    );
  });
});
