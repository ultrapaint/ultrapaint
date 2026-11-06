import path from "node:path";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it, layer } from "@effect/vitest";
import type {
  NewDesignOptions,
  NewDesignProgress,
} from "@ultrapaint/contracts/new-design";
import { ProjectConfig } from "@ultrapaint/contracts/settings";
import { Effect, FileSystem, Layer, Option, Schema } from "effect";
import { runCommand } from "./process.ts";
import { readRunFile } from "./run-file.ts";
import { NewDesignService } from "./services/new-design.ts";
import { SetupService } from "./services/setup.ts";
import { resolveStorage } from "./storage-resolve.ts";
import { makeTestServer, TestEnv } from "./testing/harness.ts";

// Git knows no one but the one named here, whatever this machine's configuration says.
process.env.GIT_CONFIG_GLOBAL = "/dev/null";
process.env.GIT_CONFIG_NOSYSTEM = "1";
process.env.GIT_AUTHOR_NAME = "Test";
process.env.GIT_AUTHOR_EMAIL = "test@example.com";
process.env.GIT_COMMITTER_NAME = "Test";
process.env.GIT_COMMITTER_EMAIL = "test@example.com";

const Live = NewDesignService.layer.pipe(
  Layer.provide(SetupService.layer),
  Layer.provideMerge(NodeServices.layer)
);

const decodeConfig = Schema.decodeUnknownEffect(
  Schema.fromJsonString(ProjectConfig)
);

/** A package manager that does what it is told: fail with a message, or install nothing. */
const fakePackageManager = Effect.fnUntraced(function* (
  dir: string,
  outcome: "fails" | "works"
) {
  const fs = yield* FileSystem.FileSystem;
  const script = path.join(dir, `pm-${outcome}`);
  yield* fs.writeFileString(
    script,
    outcome === "fails"
      ? '#!/bin/sh\necho "ERR_FAKE_FETCH no registry here" >&2\nexit 1\n'
      : "#!/bin/sh\nmkdir -p node_modules\nexit 0\n"
  );
  yield* fs.chmod(script, 0o755);
  return script;
});

/** Writes a new design, keeping each step it reports. */
const create = Effect.fnUntraced(function* (
  options: Partial<NewDesignOptions> & { readonly folder: string }
) {
  const service = yield* NewDesignService;
  const steps: NewDesignProgress[] = [];
  const result = yield* service
    .create(
      {
        code: "app",
        git: false,
        install: false,
        name: "Acme",
        template: "blank",
        ...options,
      },
      (progress) => Effect.sync(() => steps.push(progress))
    )
    .pipe(Effect.result);
  return { result, steps };
});

/** Each step as it ended: `write:done`. */
const ends = (steps: readonly NewDesignProgress[]) =>
  steps.filter((s) => s.state !== "active").map((s) => `${s.step}:${s.state}`);

const tempDir = Effect.flatMap(FileSystem.FileSystem, (fs) =>
  Effect.flatMap(fs.makeTempDirectoryScoped(), (dir) => fs.realPath(dir))
);

describe("a new design", () => {
  it.effect(
    "starts blank with its code in app/, and a configuration the server finds from inside it",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const folder = path.join(yield* tempDir, "Ultrapaint", "Acme");
        const { result, steps } = yield* create({ folder });
        assert.isTrue(result._tag === "Success");
        assert.deepStrictEqual(ends(steps), [
          "folder:done",
          "write:done",
          "install:skipped",
        ]);
        const config = yield* decodeConfig(
          yield* fs.readFileString(path.join(folder, "ultrapaint.config.json"))
        );
        assert.deepStrictEqual(config, {
          designsDir: "designs",
          hostCss: ["../../app/src/index.css"],
          libraryDirs: ["app/src/components"],
          resolveFrom: "app",
        });
        assert.isTrue(yield* fs.exists(path.join(folder, "designs")));
        assert.isTrue(yield* fs.exists(path.join(folder, "app/package.json")));
        assert.isTrue(
          yield* fs.exists(path.join(folder, "app/src/components"))
        );
        assert.isFalse(
          yield* fs.exists(path.join(folder, "app/src/components/ui"))
        );
        assert.isFalse(yield* fs.exists(path.join(folder, ".git")));
        // Started anywhere in it, the server finds the configuration: a project, not a session.
        const { storage } = yield* resolveStorage({
          config: undefined,
          cwd: path.join(folder, "app", "src"),
          ephemeral: false,
          home: undefined,
          userHome: folder,
        });
        assert.deepStrictEqual(storage, {
          configPath: path.join(folder, "ultrapaint.config.json"),
          mode: "file",
          stateDir: path.join(folder, ".ultrapaint"),
        });
      }).pipe(Effect.scoped, Effect.provide(Live)),
    30_000
  );

  it.effect(
    "writes designs only, with nothing to install, the application left for the first implementation",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const folder = yield* tempDir;
        const { result, steps } = yield* create({
          code: "none",
          folder,
          install: true,
        });
        assert.isTrue(result._tag === "Success");
        assert.deepStrictEqual(ends(steps), [
          "folder:done",
          "write:done",
          "install:skipped",
        ]);
        assert.isFalse(yield* fs.exists(path.join(folder, "package.json")));
        assert.isTrue(yield* fs.exists(path.join(folder, "designs")));
        const config = yield* decodeConfig(
          yield* fs.readFileString(path.join(folder, "ultrapaint.config.json"))
        );
        assert.strictEqual(config.designsDir, "designs");
        assert.deepStrictEqual(config.hostCss ?? [], []);
      }).pipe(Effect.scoped, Effect.provide(Live))
  );

  it.effect("writes the starter's components at the folder's root", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const folder = yield* tempDir;
      const { result } = yield* create({
        code: "root",
        folder,
        template: "starter",
      });
      assert.isTrue(result._tag === "Success");
      assert.isTrue(yield* fs.exists(path.join(folder, "package.json")));
      assert.isTrue(
        yield* fs.exists(path.join(folder, "src/components/ui/button.tsx"))
      );
      const config = yield* decodeConfig(
        yield* fs.readFileString(path.join(folder, "ultrapaint.config.json"))
      );
      assert.deepStrictEqual(config.hostCss, ["../../src/index.css"]);
      assert.deepStrictEqual(config.libraryDirs, ["src/components"]);
      assert.strictEqual(config.resolveFrom, ".");
    }).pipe(Effect.scoped, Effect.provide(Live))
  );

  it.effect(
    "commits itself when the git integration is on, and turns the setting on",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const folder = yield* tempDir;
        const { result, steps } = yield* create({ folder, git: true });
        assert.isTrue(result._tag === "Success");
        assert.deepStrictEqual(ends(steps), [
          "folder:done",
          "write:done",
          "install:skipped",
          "git:done",
        ]);
        const log = yield* runCommand("git", ["log", "--format=%s"], {
          cwd: folder,
        });
        assert.strictEqual(log.stdout.trim(), "Start Acme");
        const status = yield* runCommand("git", ["status", "--porcelain"], {
          cwd: folder,
        });
        assert.strictEqual(status.stdout, "");
        const config = yield* decodeConfig(
          yield* fs.readFileString(path.join(folder, "ultrapaint.config.json"))
        );
        assert.strictEqual(config.git, "on");
      }).pipe(Effect.scoped, Effect.provide(Live)),
    30_000
  );

  it.effect(
    "makes the first commit in a repository with none, as an earlier run whose commit failed left it",
    () =>
      Effect.gen(function* () {
        const folder = yield* tempDir;
        yield* runCommand("git", ["init", "--quiet"], { cwd: folder });
        const { result, steps } = yield* create({ folder, git: true });
        assert.isTrue(result._tag === "Success");
        assert.strictEqual(ends(steps).at(-1), "git:done");
        const log = yield* runCommand("git", ["log", "--format=%s"], {
          cwd: folder,
        });
        assert.strictEqual(log.stdout.trim(), "Start Acme");
        // A repository with commits is left as it is.
        const again = yield* create({ folder, git: true });
        assert.strictEqual(ends(again.steps).at(-1), "git:skipped");
      }).pipe(Effect.scoped, Effect.provide(Live)),
    30_000
  );

  it.effect(
    "stops at an install that fails, saying why, and a second run finishes it",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const tools = yield* tempDir;
        const folder = path.join(yield* tempDir, "Acme");
        const failing = yield* create({
          folder,
          git: true,
          install: true,
          packageManager: yield* fakePackageManager(tools, "fails"),
        });
        assert.isTrue(failing.result._tag === "Failure");
        if (failing.result._tag === "Failure") {
          assert.strictEqual(failing.result.failure.step, "install");
          assert.include(
            failing.result.failure.message,
            "ERR_FAKE_FETCH no registry here"
          );
        }
        // Git waits for the install: the first commit is of a project that works.
        assert.deepStrictEqual(ends(failing.steps), [
          "folder:done",
          "write:done",
          "install:failed",
        ]);
        assert.isFalse(yield* fs.exists(path.join(folder, ".git")));
        // What it wrote stays: the folder opens as a project.
        assert.isTrue(
          yield* fs.exists(path.join(folder, "ultrapaint.config.json"))
        );

        const again = yield* create({
          folder,
          git: true,
          install: true,
          packageManager: yield* fakePackageManager(tools, "works"),
        });
        assert.isTrue(again.result._tag === "Success");
        assert.deepStrictEqual(ends(again.steps), [
          "folder:done",
          "write:skipped",
          "install:done",
          "git:done",
        ]);
        assert.isTrue(yield* fs.exists(path.join(folder, "app/node_modules")));
      }).pipe(Effect.scoped, Effect.provide(Live)),
    30_000
  );

  it.effect("starts in an empty folder, and writes nothing into another", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const folder = yield* tempDir;
      yield* fs.writeFileString(path.join(folder, "notes.txt"), "mine\n");
      const { result, steps } = yield* create({ folder });
      assert.isTrue(result._tag === "Failure");
      assert.deepStrictEqual(ends(steps), ["folder:done", "write:failed"]);
      assert.include(steps.at(-1)?.detail ?? "", "is not empty (notes.txt)");
      assert.deepStrictEqual(yield* fs.readDirectory(folder), ["notes.txt"]);
    }).pipe(Effect.scoped, Effect.provide(Live))
  );
});

/** The server on a new design, found by its configuration, as the desktop app starts it. */
const OnNewDesign = makeTestServer(({ home }) =>
  Effect.gen(function* () {
    const folder = path.join(home, "Acme");
    yield* create({ folder });
    const { storage } = yield* resolveStorage({
      config: undefined,
      cwd: folder,
      ephemeral: false,
      home: undefined,
      userHome: folder,
    });
    return storage;
  }).pipe(Effect.provide(Live), Effect.orDie)
);

layer(OnNewDesign, { excludeTestServices: true, timeout: "60 seconds" })(
  "a server on a new design",
  (test) => {
    test.effect(
      "runs on its configuration and leaves its run file in the design's state directory",
      () =>
        Effect.gen(function* () {
          const { client, port } = yield* TestEnv;
          const { settings } = yield* client["project.info"]();
          if (settings === undefined) {
            return assert.fail("the server has no settings");
          }
          const folder = settings.repoPath;
          assert.strictEqual(path.basename(folder), "Acme");
          const validation = yield* client["settings.set"](settings);
          assert.deepStrictEqual(validation.problems, []);
          // What a second start, the command's or the desktop app's, finds and attaches to.
          const run = yield* readRunFile(path.join(folder, ".ultrapaint"));
          assert.strictEqual(Option.getOrThrow(run).port, port);
        })
    );
  }
);
