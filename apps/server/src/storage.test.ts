import { homedir } from "node:os";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import {
  ConfigProvider,
  Effect,
  Fiber,
  FileSystem,
  Layer,
  Option,
  Path,
  Scope,
  Stream,
} from "effect";
import { Command } from "effect/cli";
import { AppLog } from "./app-log.ts";
import { ServerConfig, type StorageTarget } from "./config.ts";
import { EventBus } from "./events.ts";
import { ServerLive } from "./server.ts";
import { FigmaBaseline } from "./services/figma-baseline.ts";
import { RepoPaths } from "./services/repo-paths.ts";
import { SettingsService } from "./services/settings.ts";
import { Storage } from "./services/storage.ts";
import { resolveStorage, userDirFlag } from "./storage-resolve.ts";
import { eachTest } from "./testing/each-test.ts";
import {
  makeRepository,
  makeTestServer,
  nextEvent,
  subscribed,
  TestEnv,
} from "./testing/harness.ts";
import { waitFor } from "./testing/wait-for.ts";

/** Why a block runs on the real clock: what it waits for is the configuration file's watch. */
const CONFIG_WATCH =
  "a configuration file written by hand is heard by a real watch of its directory, polled with waitFor";

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

  it.effect(
    "saves nothing until the first change when no configuration is given or found, and never with --ephemeral (ADR 0092)",
    () =>
      Effect.gen(function* () {
        const cwd = yield* tempDir;
        const resolved = yield* resolveStorage({ ...flags, cwd });
        assert.deepStrictEqual(resolved.storage, {
          mode: "ephemeral",
          saveOnChange: true,
        });
        assert.strictEqual(resolved.userDir, "/users/someone/.ultrapaint");
        const asked = yield* resolveStorage({ ...flags, cwd, ephemeral: true });
        assert.deepStrictEqual(asked.storage, { mode: "ephemeral" });
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
        saveOnChange: true,
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

  it.effect(
    "keeps the person's folder as .ultrapaint in --user-dir, whatever the storage",
    () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const cwd = yield* tempDir;
        const unsaved = yield* resolveStorage({
          ...flags,
          cwd,
          userDir: "/sync",
        });
        assert.deepStrictEqual(unsaved, {
          storage: { mode: "ephemeral", saveOnChange: true },
          userDir: "/sync/.ultrapaint",
        });
        // Over --home's, which keeps the settings and state it had.
        const managed = yield* resolveStorage({
          ...flags,
          cwd,
          home: "/h",
          userDir: "/sync",
        });
        assert.deepStrictEqual(managed, {
          storage: { home: "/h", mode: "managed" },
          userDir: "/sync/.ultrapaint",
        });
        const relative = yield* resolveStorage({
          ...flags,
          cwd,
          userDir: "elsewhere",
        });
        assert.strictEqual(
          relative.userDir,
          path.join(cwd, "elsewhere", ".ultrapaint")
        );
      }).pipe(Effect.provide(NodeServices.layer))
  );
  it.effect(
    "finds the person's folder where the desktop app moved it, unless told otherwise (ADR 0091)",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* tempDir;
        const location = path.join(cwd, "user-folder.json");
        // Never moved: no file, and the folder is in the home folder.
        const never = yield* resolveStorage({
          ...flags,
          cwd,
          userFolderLocation: location,
        });
        assert.strictEqual(never.userDir, "/users/someone/.ultrapaint");
        yield* fs.writeFileString(
          location,
          JSON.stringify({ userDirIn: "/mnt/data", version: 1 })
        );
        const moved = yield* resolveStorage({
          ...flags,
          cwd,
          userFolderLocation: location,
        });
        assert.strictEqual(moved.userDir, "/mnt/data/.ultrapaint");
        // --user-dir, or ULTRAPAINT_USER_DIR, still wins.
        const given = yield* resolveStorage({
          ...flags,
          cwd,
          userDir: "/sync",
          userFolderLocation: location,
        });
        assert.strictEqual(given.userDir, "/sync/.ultrapaint");
        // A file that cannot be read is no move.
        yield* fs.writeFileString(location, "not json");
        const broken = yield* resolveStorage({
          ...flags,
          cwd,
          userFolderLocation: location,
        });
        assert.strictEqual(broken.userDir, "/users/someone/.ultrapaint");
      }).pipe(Effect.provide(NodeServices.layer))
  );
});

describe("--user-dir", () => {
  /** What the flag gives a command run with `args`, in an environment of `env`. */
  const given = (args: readonly string[], env: Record<string, string> = {}) =>
    Effect.gen(function* () {
      let seen: Option.Option<string> = Option.none();
      const command = Command.make(
        "ultrapaint",
        { userDir: userDirFlag },
        (c) =>
          Effect.sync(() => {
            seen = c.userDir;
          })
      );
      yield* Command.runWith(command, { version: "test" })(args).pipe(
        Effect.provideService(
          ConfigProvider.ConfigProvider,
          ConfigProvider.fromEnv({ env })
        )
      );
      return Option.getOrUndefined(seen);
    }).pipe(Effect.provide(NodeServices.layer));

  it.effect("is read from the flag, then from ULTRAPAINT_USER_DIR", () =>
    Effect.gen(function* () {
      assert.isUndefined(yield* given([]));
      assert.strictEqual(yield* given(["--user-dir", "/sync"]), "/sync");
      assert.strictEqual(
        yield* given([], { ULTRAPAINT_USER_DIR: "/env" }),
        "/env"
      );
      assert.strictEqual(
        yield* given(["--user-dir", "/sync"], { ULTRAPAINT_USER_DIR: "/env" }),
        "/sync"
      );
    })
  );
});

const Unsaved = makeTestServer(() => Effect.succeed({ mode: "ephemeral" }));

eachTest(Unsaved)("a session started without a configuration", (test) => {
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

  test.effect("saves the session to a file and keeps saving from then on", () =>
    Effect.gen(function* () {
      const { client, repo, settings } = yield* TestEnv;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      // A session with its project open, from memory.
      yield* client["settings.set"](settings);
      const thread = yield* client["threads.create"]({
        agentId: "fake",
        title: "before saving",
      });
      const version = yield* client["history.save"]({ name: "kept" });
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
      assert.deepStrictEqual(Object.keys(written), Object.keys(written).sort());
      assert.strictEqual(written.designsDir, "designs");

      // What the session had collected moved next to the file, out of git's sight.
      const state = path.join(repo, ".ultrapaint");
      assert.isTrue(
        yield* fs.exists(path.join(state, "threads", `${thread.id}.json`))
      );
      assert.isTrue(
        yield* fs.exists(
          path.join(state, "store", "refs", "history", version.id)
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

  // The command is copied into a shell: a directory with a space or a quote in its name is
  // still one word there.
  for (const [file, commandFor] of [
    [
      "ultrapaint.json",
      (dir: string) => `cd '${dir}/it'\\''s ours' && ultrapaint`,
    ],
    [
      "team.json",
      (dir: string) => `ultrapaint --config '${dir}/it'\\''s ours/team.json'`,
    ],
  ] as const) {
    test.effect(
      `says a command a shell reads, for ${file} in a directory with a space`,
      () =>
        Effect.gen(function* () {
          const { client, repo, settings } = yield* TestEnv;
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          yield* client["settings.set"](settings);
          const dir = path.join(repo, "it's ours");
          yield* fs.makeDirectory(dir);

          const result = yield* client["settings.persist"]({
            configPath: path.join(dir, file),
            settings,
          });

          assert.strictEqual(result.command, commandFor(repo));
        })
    );
  }
});

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

eachTest(Shared, { realClock: CONFIG_WATCH })(
  "a session started from a configuration file in the repository",
  (test) => {
    test.effect("resolves the repository from where the file is", () =>
      Effect.gen(function* () {
        const { client, repo } = yield* TestEnv;
        const { settings } = yield* client["project.info"]();
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
          // The same settings, written another way: an editor that reformats the file with tabs.
          const same = JSON.parse(yield* fs.readFileString(configPath));
          yield* fs.writeFileString(
            configPath,
            JSON.stringify(same, null, "\t")
          );
          yield* waitFor(client["logs.recent"](), (lines) =>
            lines.some((line) => line.text === `reloaded ${configPath}`)
          );
          yield* waitFor(client["project.info"](), (info) => info.configured);
          // Reopening would have started a new undo history.
          assert.strictEqual(
            (yield* client["edit.state"]()).undoLabel,
            "Name the title"
          );
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
          (yield* client["project.info"]()).settings?.designsDir,
          "screens"
        );
      })
    );
  }
);

const Appearing = makeTestServer(() => Effect.succeed({ mode: "ephemeral" }));

eachTest(Appearing, { realClock: CONFIG_WATCH })(
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
          const { settings } = yield* client["project.info"]();
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
          // Its news comes before that of the file written after it, which is read.
          yield* fs.writeFileString(
            legacy,
            JSON.stringify({ codeTokens: "auto", designsDir: "elsewhere" })
          );
          yield* fs.writeFileString(
            renamed,
            JSON.stringify({
              ...JSON.parse(yield* fs.readFileString(renamed)),
              codeTokens: "manual",
            })
          );
          const rewritten = yield* waitFor(
            client["project.info"](),
            (now) => now.settings?.codeTokens === "manual"
          );
          assert.strictEqual(rewritten.settings?.designsDir, "designs");
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

  it.effect(
    "takes the Figma baseline that waits for a design system along when it is saved",
    () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const repo = yield* makeRepository;
        const sessionDir = yield* tempDir;
        const baseline = { at: 5, code: {}, figma: {}, file: "brand.fig" };
        const waiting = yield* Effect.gen(function* () {
          const figma = yield* FigmaBaseline;
          yield* figma.wait(baseline);
          yield* (yield* Storage).promote(path.join(repo, "ultrapaint.json"));
          return yield* figma.pending;
        }).pipe(
          Effect.provide(
            FigmaBaseline.layer.pipe(
              Layer.provide(
                RepoPaths.layer({
                  designsDir: "designs",
                  hostCss: [],
                  libraryDirs: [],
                  repoPath: repo,
                })
              ),
              Layer.provideMerge(
                settingsOf(repo, { mode: "ephemeral", sessionDir })
              )
            )
          )
        );
        assert.deepStrictEqual(waiting, baseline);
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

eachTest(Detected, { realClock: CONFIG_WATCH })(
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
        const { settings } = yield* client["project.info"]();
        assert.isDefined(settings);
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
