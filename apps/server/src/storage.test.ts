import { homedir } from "node:os";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it, layer } from "@effect/vitest";
import {
  Effect,
  Fiber,
  FileSystem,
  Layer,
  Option,
  Path,
  Scope,
  Stream,
} from "effect";
import { AppLog } from "./app-log.ts";
import { ServerConfig, type StorageTarget } from "./config.ts";
import { EventBus } from "./events.ts";
import { ServerLive } from "./server.ts";
import { SettingsService } from "./services/settings.ts";
import { Storage } from "./services/storage.ts";
import { resolveStorage } from "./storage-resolve.ts";
import {
  makeRepository,
  makeTestServer,
  nextEvent,
  subscribed,
  TestEnv,
} from "./testing/harness.ts";
import { waitFor } from "./testing/wait-for.ts";

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
              path.join(state, "store", "refs", "designs", snapshot.id)
            )
          );
          assert.strictEqual(
            yield* fs.readFileString(path.join(state, ".gitignore")),
            "*\n"
          );
          // The run file too: a second start in the repository finds this server there.
          assert.isTrue(yield* fs.exists(path.join(state, "run.json")));

          // Later changes go to the file, and a second save is refused.
          yield* client["settings.set"]({ ...settings, codeTokens: "auto" });
          const again = JSON.parse(yield* fs.readFileString(configPath));
          assert.strictEqual(again.codeTokens, "auto");
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
          yield* client["settings.set"]({ ...settings, codeTokens: "auto" });
          const written = JSON.parse(
            yield* fs.readFileString(`${repo}/ultrapaint.json`)
          );
          assert.strictEqual(written.$schema, "./schema.json");
          assert.strictEqual(written.codeTokens, "auto");
          assert.notProperty(written, "repoPath");
        })
    );

    test.effect(
      "keeps the project open when the file is written again with what runs",
      () =>
        Effect.gen(function* () {
          const { client, repo } = yield* TestEnv;
          const fs = yield* FileSystem.FileSystem;
          const configPath = `${repo}/ultrapaint.json`;
          yield* waitFor(client["project.info"](), (info) => info.configured);
          yield* client["documents.apply"]({
            edits: [
              {
                doc: "home.page.json",
                ops: [{ id: "heading", op: "update", set: { name: "Title" } }],
              },
            ],
            label: "Name the title",
          });
          // The same settings, written another way: an editor that reformats the file.
          const same = JSON.parse(yield* fs.readFileString(configPath));
          yield* fs.writeFileString(configPath, JSON.stringify(same));
          yield* waitFor(client["logs.recent"](), (lines) =>
            lines.some((line) => line.text === `reloaded ${configPath}`)
          );
          yield* waitFor(client["project.info"](), (info) => info.configured);
          // Reopening would have started a new undo history.
          assert.strictEqual(
            (yield* client["edit.state"]()).undoLabel,
            "Name the title"
          );
          yield* client["edit.undo"]();
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
        yield* waitFor(
          client["project.info"](),
          (info) => info.designsDir === "screens"
        );
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
          const followed = yield* waitFor(
            client["project.info"](),
            (now) => now.storage.mode === "file" && now.configured
          );
          assert.strictEqual(followed.storage.configPath, legacy);

          const renamed = yield* client["settings.renameConfig"]();
          assert.strictEqual(renamed, `${repo}/ultrapaint.config.json`);
          assert.isFalse(yield* fs.exists(legacy));
          const info = yield* client["project.info"]();
          assert.strictEqual(info.storage.configPath, renamed);
          const settings = yield* client["settings.get"]();
          if (settings) {
            yield* client["settings.set"]({ ...settings, codeTokens: "auto" });
          }
          assert.strictEqual(
            JSON.parse(yield* fs.readFileString(renamed)).codeTokens,
            "auto"
          );
          const again = yield* Effect.flip(client["settings.renameConfig"]());
          assert.strictEqual(again._tag, "BadRequest");

          // The old name is no longer the configuration: a file that takes it again is not read.
          yield* fs.writeFileString(
            legacy,
            JSON.stringify({ codeTokens: "manual", designsDir: "designs" })
          );
          yield* Effect.sleep("600 millis");
          assert.strictEqual(
            (yield* client["settings.get"]())?.codeTokens,
            "auto"
          );
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
              ServerConfig.layerTest({
                cwd: dir,
                machine: { home: homedir(), path: process.env.PATH ?? "" },
                mcp: true,
                port: 0,
                storage: {
                  configPath,
                  mode: "file",
                  stateDir: `${dir}/.ultrapaint`,
                },
                userDir: dir,
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
      ServerConfig.layerTest({
        cwd,
        machine: { home: homedir(), path: process.env.PATH ?? "" },
        storage,
        userDir: cwd,
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
        codeTokens: "auto" as const,
        designsDir: "designs",
        hostCss: [],
        libraryDirs: [],
        repoPath: repo,
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
        designsDir: "designs",
        hostCss: [],
        libraryDirs: [],
        repoPath: repo,
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
        const info = yield* waitFor(
          client["project.info"](),
          (opened) => opened.configured
        );
        assert.strictEqual(info?.setup, "detected");
        assert.strictEqual(info?.designsDir, "designs");
        assert.strictEqual(info?.repoPath, repo);

        // Applying them makes them the saved ones: the editor is told, and the project that runs
        // them stays open.
        yield* client["documents.apply"]({
          edits: [
            {
              doc: "home.page.json",
              ops: [{ id: "heading", op: "update", set: { name: "Title" } }],
            },
          ],
          label: "Name the title",
        });
        const settings = yield* client["settings.get"]();
        assert.isNotNull(settings);
        if (settings) {
          const { event, result } = yield* nextEvent(
            client["events.project"]().pipe(
              Stream.filter((told) => told.setup === "saved")
            ),
            client["settings.set"](settings)
          );
          assert.isTrue(result.ok);
          assert.isTrue(Option.isSome(event));
        }
        // Reopening would have started a new undo history.
        assert.strictEqual(
          (yield* client["edit.state"]()).undoLabel,
          "Name the title"
        );
        assert.strictEqual((yield* client["project.info"]()).setup, "saved");
      })
    );
  }
);
