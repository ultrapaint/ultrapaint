import { homedir } from "node:os";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it, layer } from "@effect/vitest";
import { Effect, Fiber, FileSystem, Layer, Path, Scope, Stream } from "effect";
import { ServerConfig } from "./config.ts";
import { ServerLive } from "./server.ts";
import { resolveStorage } from "./storage-resolve.ts";
import { freePort, makeTestServer, TestEnv } from "./testing/harness.ts";

const tempDir = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  return yield* fs.realPath(yield* fs.makeTempDirectoryScoped());
});

describe("resolveStorage", () => {
  const flags = {
    config: undefined,
    ephemeral: false,
    home: undefined,
    userHome: "/users/someone",
  };

  it.effect("saves nothing when no configuration is given or found", () =>
    Effect.gen(function* () {
      const cwd = yield* tempDir;
      const resolved = yield* resolveStorage({ ...flags, cwd });
      assert.deepStrictEqual(resolved.storage, { mode: "ephemeral" });
      assert.strictEqual(resolved.userDir, "/users/someone/.ultrapaint");
    }).pipe(Effect.provide(NodeServices.layer))
  );

  it.effect(
    "finds the nearest ultrapaint.json from the working directory up",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const repo = yield* tempDir;
        const cwd = path.join(repo, "apps", "web");
        yield* fs.makeDirectory(cwd, { recursive: true });
        yield* fs.writeFileString(path.join(repo, "ultrapaint.json"), "{}");
        const resolved = yield* resolveStorage({ ...flags, cwd });
        assert.deepStrictEqual(resolved.storage, {
          configPath: path.join(repo, "ultrapaint.json"),
          mode: "file",
          stateDir: path.join(repo, ".ultrapaint"),
        });
        const forced = yield* resolveStorage({
          ...flags,
          cwd,
          ephemeral: true,
        });
        assert.deepStrictEqual(forced.storage, { mode: "ephemeral" });
      }).pipe(Effect.provide(NodeServices.layer))
  );

  it.effect(
    "takes --config relative to the working directory, existing or not",
    () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const cwd = yield* tempDir;
        const resolved = yield* resolveStorage({
          ...flags,
          config: "conf/design.json",
          cwd,
        });
        assert.deepStrictEqual(resolved.storage, {
          configPath: path.join(cwd, "conf", "design.json"),
          mode: "file",
          stateDir: path.join(cwd, "conf", ".ultrapaint"),
        });
      }).pipe(Effect.provide(NodeServices.layer))
  );

  it.effect(
    "uses --home as a home of its own, and as the state directory of a --config",
    () =>
      Effect.gen(function* () {
        const cwd = yield* tempDir;
        const managed = yield* resolveStorage({ ...flags, cwd, home: "/h" });
        assert.deepStrictEqual(managed, {
          storage: { home: "/h", mode: "managed" },
          userDir: "/h",
        });
        const both = yield* resolveStorage({
          ...flags,
          config: "/r/ultrapaint.json",
          cwd,
          home: "/h",
        });
        assert.deepStrictEqual(both.storage, {
          configPath: "/r/ultrapaint.json",
          mode: "file",
          stateDir: "/h",
        });
      }).pipe(Effect.provide(NodeServices.layer))
  );
});

const Unsaved = makeTestServer(() => Effect.succeed({ mode: "ephemeral" }));

layer(Unsaved, { excludeTestServices: true, timeout: "60 seconds" })(
  "a session started without a configuration",
  (test) => {
    test.effect(
      "runs a project from memory and writes no settings anywhere",
      () =>
        Effect.gen(function* () {
          const { client, home, repo, settings } = yield* TestEnv;
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const before = yield* client["project.info"]();
          assert.strictEqual(before.storage.mode, "ephemeral");
          // The fixture repository is where the server was started.
          assert.strictEqual(before.storage.defaultRepoPath, repo);

          assert.isTrue((yield* client["settings.set"](settings)).ok);
          const info = yield* client["project.info"]();
          assert.isTrue(info.configured);
          assert.strictEqual(info.storage.mode, "ephemeral");
          assert.isFalse(yield* fs.exists(path.join(home, "settings.json")));
          assert.isFalse(yield* fs.exists(path.join(home, "threads")));
          assert.isFalse(yield* fs.exists(path.join(repo, "ultrapaint.json")));
        })
    );

    test.effect(
      "refuses a configuration path it cannot write a shared file to",
      () =>
        Effect.gen(function* () {
          const { client, repo, settings } = yield* TestEnv;
          const relative = yield* Effect.flip(
            client["settings.persist"]({ configPath: "design.json", settings })
          );
          assert.strictEqual(relative._tag, "BadRequest");
          const missing = yield* Effect.flip(
            client["settings.persist"]({
              configPath: `${repo}/nowhere/ultrapaint.json`,
              settings,
            })
          );
          assert.strictEqual(missing._tag, "BadRequest");
        })
    );

    test.effect(
      "saves the session to a file and keeps saving from then on",
      () =>
        Effect.gen(function* () {
          const { client, repo, settings } = yield* TestEnv;
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const thread = yield* client["threads.create"]({
            agentId: "fake",
            title: "before saving",
          });
          const configPath = path.join(repo, "ultrapaint.json");

          const events = yield* Effect.forkScoped(
            client["events.project"]().pipe(
              Stream.filter((info) => info.storage.mode === "file"),
              Stream.runHead
            )
          );
          yield* Effect.sleep("150 millis");
          const result = yield* client["settings.persist"]({
            configPath,
            settings,
          });
          assert.isTrue(result.validation.ok);
          assert.strictEqual(result.configPath, configPath);
          assert.strictEqual(result.command, `cd ${repo} && ultrapaint`);
          const pushed = yield* Fiber.join(events);
          assert.strictEqual(
            pushed._tag === "Some" ? pushed.value.storage.configPath : null,
            configPath
          );

          // A shared file: no machine-specific path, stable key order.
          const written = JSON.parse(yield* fs.readFileString(configPath));
          assert.notProperty(written, "repoPath");
          assert.deepStrictEqual(
            Object.keys(written),
            Object.keys(written).sort()
          );
          assert.strictEqual(written.designsDir, "designs");

          // What the session had collected moved next to the file, out of git's sight.
          const state = path.join(repo, ".ultrapaint");
          assert.isTrue(
            yield* fs.exists(path.join(state, "threads", `${thread.id}.json`))
          );
          assert.strictEqual(
            yield* fs.readFileString(path.join(state, ".gitignore")),
            "*\n"
          );

          // Later changes go to the file, and a second save is refused.
          yield* client["settings.set"]({ ...settings, theme: "dark" });
          const again = JSON.parse(yield* fs.readFileString(configPath));
          assert.strictEqual(again.theme, "dark");
          const twice = yield* Effect.flip(
            client["settings.persist"]({
              configPath,
              overwrite: true,
              settings,
            })
          );
          assert.strictEqual(twice._tag, "BadRequest");
        })
    );
  }
);

const Shared = makeTestServer(({ repo }) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const configPath = `${repo}/ultrapaint.json`;
    // Hand-written and minimal: everything else has a default.
    yield* fs.writeFileString(
      configPath,
      JSON.stringify({ $schema: "./schema.json", designsDir: "designs" })
    );
    return { configPath, mode: "file", stateDir: `${repo}/.ultrapaint` };
  })
);

layer(Shared, { excludeTestServices: true, timeout: "60 seconds" })(
  "a session started from a configuration file in the repository",
  (test) => {
    test.effect("resolves the repository from where the file is", () =>
      Effect.gen(function* () {
        const { client, repo } = yield* TestEnv;
        const settings = yield* client["settings.get"]();
        assert.strictEqual(settings?.repoPath, repo);
        assert.deepStrictEqual(settings?.libraryDirs, []);
        assert.strictEqual(settings?.theme, "light");
        const info = yield* client["project.info"]();
        assert.strictEqual(info.storage.mode, "file");
      })
    );

    test.effect(
      "writes changes back without a machine path and keeps $schema",
      () =>
        Effect.gen(function* () {
          const { client, repo, settings } = yield* TestEnv;
          const fs = yield* FileSystem.FileSystem;
          yield* client["settings.set"]({ ...settings, theme: "dark" });
          const written = JSON.parse(
            yield* fs.readFileString(`${repo}/ultrapaint.json`)
          );
          assert.strictEqual(written.$schema, "./schema.json");
          assert.strictEqual(written.theme, "dark");
          assert.notProperty(written, "repoPath");
        })
    );

    test.effect("follows a change someone else makes to the file", () =>
      Effect.gen(function* () {
        const { client, repo } = yield* TestEnv;
        const fs = yield* FileSystem.FileSystem;
        yield* fs.makeDirectory(`${repo}/screens`);
        yield* fs.writeFileString(
          `${repo}/ultrapaint.json`,
          JSON.stringify({ designsDir: "screens" })
        );
        const followed = yield* Effect.gen(function* () {
          while ((yield* client["project.info"]()).designsDir !== "screens") {
            yield* Effect.sleep("100 millis");
          }
          return true;
        }).pipe(Effect.timeoutOption("10 seconds"));
        assert.strictEqual(followed._tag, "Some");
        assert.strictEqual(
          (yield* client["settings.get"]())?.designsDir,
          "screens"
        );
      })
    );
  }
);

describe("a configuration file that cannot be read", () => {
  it.effect("stops the server instead of being replaced", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const dir = yield* tempDir;
      const configPath = `${dir}/ultrapaint.json`;
      yield* fs.writeFileString(configPath, '{ "designsDir": 12 }');
      const scope = yield* Scope.make();
      const exit = yield* Effect.exit(
        Layer.buildWithScope(
          ServerLive.pipe(
            Layer.provide(
              Layer.succeed(ServerConfig, {
                briefing: true,
                cwd: dir,
                host: "127.0.0.1",
                machine: { home: homedir(), path: process.env.PATH ?? "" },
                mcp: true,
                port: yield* freePort,
                storage: {
                  configPath,
                  mode: "file",
                  stateDir: `${dir}/.ultrapaint`,
                },
                userDir: dir,
                version: "test",
                webDist: undefined,
              })
            )
          ),
          scope
        )
      );
      yield* Scope.close(scope, exit);
      assert.strictEqual(exit._tag, "Failure");
      assert.include(String(exit), "ConfigInvalid");
      assert.strictEqual(
        yield* fs.readFileString(configPath),
        '{ "designsDir": 12 }'
      );
    }).pipe(Effect.provide(NodeServices.layer))
  );
});
