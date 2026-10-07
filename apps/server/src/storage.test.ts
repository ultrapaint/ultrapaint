import { homedir, tmpdir } from "node:os";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it, layer } from "@effect/vitest";
import { Effect, Fiber, FileSystem, Layer, Path, Scope, Stream } from "effect";
import { AppLog } from "./app-log.ts";
import { ServerConfig, type StorageTarget } from "./config.ts";
import { EventBus } from "./events.ts";
import { ServerLive } from "./server.ts";
import { SettingsService } from "./services/settings.ts";
import { Storage } from "./services/storage.ts";
import { resolveStorage } from "./storage-resolve.ts";
import {
  freePort,
  makeRepository,
  makeTestServer,
  subscribed,
  TestEnv,
} from "./testing/harness.ts";

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
    "finds ultrapaint.config.json, and prefers it to the old name in the same directory",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const repo = yield* tempDir;
        const cwd = path.join(repo, "front");
        yield* fs.makeDirectory(cwd, { recursive: true });
        yield* fs.writeFileString(
          path.join(repo, "ultrapaint.config.json"),
          "{}"
        );
        const found = yield* resolveStorage({ ...flags, cwd });
        assert.deepStrictEqual(found.storage, {
          configPath: path.join(repo, "ultrapaint.config.json"),
          mode: "file",
          stateDir: path.join(repo, ".ultrapaint"),
        });
        yield* fs.writeFileString(path.join(repo, "ultrapaint.json"), "{}");
        const both = yield* resolveStorage({ ...flags, cwd });
        assert.strictEqual(
          both.storage.mode === "file" && both.storage.configPath,
          path.join(repo, "ultrapaint.config.json")
        );
      }).pipe(Effect.provide(NodeServices.layer))
  );

  it.effect("keeps an unsaved session in the directory the command lends", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const cwd = yield* tempDir;
      const resolved = yield* resolveStorage({
        ...flags,
        cwd,
        sessionDir: "session",
      });
      assert.deepStrictEqual(resolved.storage, {
        mode: "ephemeral",
        sessionDir: path.join(cwd, "session"),
      });
      // A configuration, when there is one, is still where things are saved.
      const saved = yield* resolveStorage({
        ...flags,
        cwd,
        home: "/h",
        sessionDir: "session",
      });
      assert.strictEqual(saved.storage.mode, "managed");
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
          // Replacing is for a configuration; any other JSON file stays as it is.
          const fs = yield* FileSystem.FileSystem;
          const packageJson = `${repo}/package.json`;
          const before = yield* fs.readFileString(packageJson);
          const other = yield* Effect.flip(
            client["settings.persist"]({
              configPath: packageJson,
              overwrite: true,
              settings,
            })
          );
          assert.strictEqual(other._tag, "BadRequest");
          assert.strictEqual(yield* fs.readFileString(packageJson), before);
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
          const snapshot = yield* client["snapshots.create"]({ name: "kept" });
          const configPath = path.join(repo, "ultrapaint.json");

          const events = yield* subscribed(
            client["events.project"]().pipe(
              Stream.filter((info) => info.storage.mode === "file"),
              Stream.runHead
            )
          );
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
          assert.isTrue(
            yield* fs.exists(
              path.join(state, "snapshots", `${snapshot.id}.json`)
            )
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

const Appearing = makeTestServer(() => Effect.succeed({ mode: "ephemeral" }));

layer(Appearing, { excludeTestServices: true, timeout: "60 seconds" })(
  "an unsaved session whose repository gets a configuration file",
  (test) => {
    test.effect(
      "takes the file without a restart, and renames the old name to the new one",
      () =>
        Effect.gen(function* () {
          const { client, repo } = yield* TestEnv;
          const fs = yield* FileSystem.FileSystem;
          const legacy = `${repo}/ultrapaint.json`;
          yield* fs.writeFileString(
            legacy,
            JSON.stringify({ designsDir: "designs" })
          );
          const followed = yield* Effect.gen(function* () {
            for (;;) {
              const info = yield* client["project.info"]();
              if (info.storage.mode === "file" && info.configured) {
                return info;
              }
              yield* Effect.sleep("100 millis");
            }
          }).pipe(Effect.timeoutOption("10 seconds"));
          assert.strictEqual(followed._tag, "Some");
          assert.strictEqual(
            followed._tag === "Some" && followed.value.storage.configPath,
            legacy
          );

          const renamed = yield* client["settings.renameConfig"]();
          assert.strictEqual(renamed, `${repo}/ultrapaint.config.json`);
          assert.isFalse(yield* fs.exists(legacy));
          const info = yield* client["project.info"]();
          assert.strictEqual(info.storage.configPath, renamed);
          const settings = yield* client["settings.get"]();
          if (settings) {
            yield* client["settings.set"]({ ...settings, theme: "dark" });
          }
          assert.strictEqual(
            JSON.parse(yield* fs.readFileString(renamed)).theme,
            "dark"
          );
          const again = yield* Effect.flip(client["settings.renameConfig"]());
          assert.strictEqual(again._tag, "BadRequest");

          // The old name is no longer the configuration: a file that takes it again is not read.
          yield* fs.writeFileString(
            legacy,
            JSON.stringify({ designsDir: "designs", theme: "light" })
          );
          yield* Effect.sleep("600 millis");
          assert.strictEqual((yield* client["settings.get"]())?.theme, "dark");
          yield* fs.remove(legacy);
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
                allowedHosts: [],
                briefing: true,
                cwd: dir,
                discovery: false,
                host: "127.0.0.1",
                machine: {
                  addresses: () => [],
                  home: homedir(),
                  path: process.env.PATH ?? "",
                  tmpdir: tmpdir(),
                  uid: process.getuid?.(),
                },
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

/** The settings of an unsaved session alone, as one start of the server builds them. */
const settingsOf = (cwd: string, storage: StorageTarget) =>
  SettingsService.layer.pipe(
    Layer.provideMerge(Storage.layer),
    Layer.provide(AppLog.layer),
    Layer.provide(EventBus.layer),
    Layer.provide(
      Layer.succeed(ServerConfig, {
        allowedHosts: [],
        briefing: true,
        cwd,
        discovery: false,
        host: "127.0.0.1",
        machine: {
          addresses: () => [],
          home: homedir(),
          path: process.env.PATH ?? "",
          tmpdir: tmpdir(),
          uid: process.getuid?.(),
        },
        mcp: false,
        port: 0,
        storage,
        userDir: cwd,
        version: "test",
        webDist: undefined,
      })
    )
  );

describe("an unsaved session in a directory the command lends", () => {
  it.effect("keeps its settings across restarts of the server", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const repo = yield* makeRepository;
      const sessionDir = yield* tempDir;
      const storage: StorageTarget = { mode: "ephemeral", sessionDir };
      const settings = {
        componentPackages: [],
        designsDir: "designs",
        hostCss: [],
        libraryDirs: [],
        repoPath: repo,
        theme: "dark" as const,
      };

      const first = yield* Effect.scoped(
        Effect.gen(function* () {
          const service = yield* SettingsService;
          assert.isNull(yield* service.get);
          assert.isTrue((yield* service.set(settings)).ok);
          assert.isFalse(yield* service.detected);
          return yield* (yield* Storage).stateDir;
        }).pipe(Effect.provide(settingsOf(repo, storage)))
      );
      assert.strictEqual(first, sessionDir);
      assert.isTrue(yield* fs.exists(path.join(sessionDir, "session.json")));
      assert.isFalse(yield* fs.exists(path.join(repo, "ultrapaint.json")));

      // The restart: the server is built again on the same directory.
      const again = yield* Effect.scoped(
        Effect.flatMap(SettingsService, (service) => service.get).pipe(
          Effect.provide(settingsOf(repo, storage))
        )
      );
      assert.deepStrictEqual(again, settings);
      // The directory is the command's: stopping the server leaves it.
      assert.isTrue(yield* fs.exists(sessionDir));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.effect("holds detected settings in memory only", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const repo = yield* makeRepository;
      const sessionDir = yield* tempDir;
      const services = settingsOf(repo, { mode: "ephemeral", sessionDir });
      const settings = {
        componentPackages: [],
        designsDir: "designs",
        hostCss: [],
        libraryDirs: [],
        repoPath: repo,
        theme: "light" as const,
      };
      yield* Effect.scoped(
        Effect.gen(function* () {
          const service = yield* SettingsService;
          const missing = yield* service.adopt({
            ...settings,
            designsDir: "docs/designs",
          });
          assert.isFalse(missing.ok);
          assert.isNull(yield* service.get);

          assert.isTrue((yield* service.adopt(settings)).ok);
          assert.isTrue(yield* service.detected);
          assert.deepStrictEqual(yield* service.get, settings);
          assert.isFalse(
            yield* fs.exists(path.join(sessionDir, "session.json"))
          );
          // Once something is in force, detection does not replace it.
          assert.isFalse((yield* service.adopt(settings)).ok);

          // Applying them makes them the user's, and saved.
          assert.isTrue((yield* service.set(settings)).ok);
          assert.isFalse(yield* service.detected);
          assert.isTrue(
            yield* fs.exists(path.join(sessionDir, "session.json"))
          );
        }).pipe(Effect.provide(services))
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );
});

const DETECTED_PACKAGE = `${JSON.stringify({
  dependencies: { react: "^19.0.0" },
  name: "designs",
})}\n`;

/** Unsaved, started in a repository whose designs package detection recognises. */
const Detected = makeTestServer(({ repo }) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.writeFileString(`${repo}/designs/package.json`, DETECTED_PACKAGE);
    return { mode: "ephemeral" } as const;
  })
);

layer(Detected, { excludeTestServices: true, timeout: "60 seconds" })(
  "an unsaved session started in a repository that holds its pages",
  (test) => {
    test.effect("opens the repository with what detection finds", () =>
      Effect.gen(function* () {
        const { client, repo } = yield* TestEnv;
        const opened = yield* Effect.gen(function* () {
          while (!(yield* client["project.info"]()).configured) {
            yield* Effect.sleep("100 millis");
          }
          return yield* client["project.info"]();
        }).pipe(Effect.timeoutOption("20 seconds"));
        assert.strictEqual(opened._tag, "Some");
        const info = opened._tag === "Some" ? opened.value : null;
        assert.strictEqual(info?.setup, "detected");
        assert.strictEqual(info?.designsDir, "designs");
        assert.strictEqual(info?.repoPath, repo);

        // Applying settings makes them the saved ones.
        const settings = yield* client["settings.get"]();
        assert.isNotNull(settings);
        if (settings) {
          assert.isTrue((yield* client["settings.set"](settings)).ok);
        }
        assert.strictEqual((yield* client["project.info"]()).setup, "saved");
      })
    );
  }
);
