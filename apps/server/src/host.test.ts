import { homedir, tmpdir } from "node:os";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import type { Framework, StyleSystem } from "@ultrapaint/framework-api/node";
import { Effect, Fiber, FileSystem, Layer, Path } from "effect";
import { TestClock } from "effect/testing";
import { AppLog } from "./app-log.ts";
import { ServerConfig } from "./config.ts";
import { ComponentRegistry } from "./services/component-registry.ts";
import { ProjectFramework } from "./services/framework.ts";
import { HostManager } from "./services/host.ts";
import { RepoPaths } from "./services/repo-paths.ts";
import { ProjectStyleSystem } from "./services/style-system.ts";

/** A preview that starts, says its pid, and never listens. */
const SILENT_PREVIEW = `import { writeFileSync } from "node:fs";
writeFileSync(process.argv[2], String(process.pid));
setInterval(() => undefined, 1 << 30);
`;

/** Real time, while the test clock holds the host's own timers. */
const wait = (ms: number) => TestClock.withLive(Effect.sleep(`${ms} millis`));

/** Whether the process is there: `kill -0` throws when it is not. */
const isAlive = (pid: number) =>
  Effect.try(() => process.kill(pid, 0)).pipe(
    Effect.as(true),
    Effect.orElseSucceed(() => false)
  );

/** The host of a fixture repository whose preview is `SILENT_PREVIEW`. */
const withHost = <A, E>(
  current: ComponentRegistry["Service"]["current"],
  use: (
    host: HostManager["Service"],
    pidFile: string
  ) => Effect.Effect<A, E, FileSystem.FileSystem>
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const repo = yield* fs.realPath(yield* fs.makeTempDirectoryScoped());
    yield* fs.makeDirectory(path.join(repo, "designs"));
    const script = path.join(repo, "preview.mjs");
    const pidFile = path.join(repo, "preview.pid");
    yield* fs.writeFileString(script, SILENT_PREVIEW);
    const framework = {
      preview: {
        generate: () =>
          Promise.resolve({ files: {}, serve: { args: [pidFile], script } }),
      },
    } as unknown as Framework;
    const services = Layer.mergeAll(
      RepoPaths.layer({
        componentPackages: [],
        designsDir: "designs",
        hostCss: [],
        libraryDirs: [],
        repoPath: repo,
        theme: "light",
      }),
      Layer.succeed(ProjectFramework, framework),
      Layer.succeed(ProjectStyleSystem, {
        previewCss: () => [],
      } as unknown as StyleSystem),
      Layer.succeed(ComponentRegistry, {
        current,
        sync: () => Effect.void,
      }),
      Layer.succeed(AppLog, {
        log: () => Effect.void,
        recent: () => Effect.succeed([]),
      }),
      Layer.succeed(ServerConfig, {
        allowedHosts: [],
        briefing: false,
        cwd: repo,
        discovery: false,
        host: "127.0.0.1",
        machine: {
          addresses: () => [],
          home: homedir(),
          node: process.execPath,
          path: process.env.PATH ?? "",
          tmpdir: tmpdir(),
          uid: process.getuid?.(),
        },
        mcp: false,
        port: 0,
        readyJson: false,
        storage: { mode: "ephemeral" },
        token: "test",
        userDir: repo,
        version: "test",
        webDist: undefined,
      })
    );
    return yield* Effect.flatMap(HostManager, (host) =>
      use(host, pidFile)
    ).pipe(
      Effect.provide(
        HostManager.layer.pipe(
          Layer.provide(services),
          Layer.provide(NodeServices.layer)
        )
      )
    );
  }).pipe(Effect.provide(NodeServices.layer));

describe("the preview host", () => {
  it.effect(
    "stops a preview that never listens, and starts it again on the next start",
    () =>
      withHost(Effect.succeed([]), (host, pidFile) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const first = yield* Effect.forkChild(host.start);
          // Up and probed: only the clock is left to run out.
          while (!(yield* fs.exists(pidFile))) {
            yield* wait(50);
          }
          yield* wait(300);
          const pid = Number(yield* fs.readFileString(pidFile));
          yield* TestClock.adjust("31 seconds");
          const status = yield* Fiber.join(first);
          assert.deepStrictEqual(status, {
            error: "vite did not start listening within 30 s",
            state: "error",
          });
          while (yield* isAlive(pid)) {
            yield* wait(50);
          }

          yield* fs.remove(pidFile);
          const second = yield* Effect.forkChild(host.start);
          while (!(yield* fs.exists(pidFile))) {
            yield* wait(50);
          }
          assert.strictEqual((yield* host.status).state, "starting");
          yield* TestClock.adjust("31 seconds");
          assert.strictEqual((yield* Fiber.join(second)).state, "error");
        })
      ),
    30_000
  );

  it.effect("reports a start that breaks as an error, not as starting", () =>
    withHost(Effect.die(new Error("the registry broke")), (host) =>
      Effect.gen(function* () {
        const status = yield* host.start;
        assert.deepStrictEqual(status, {
          error: "the preview could not be started: the registry broke",
          state: "error",
        });
        assert.deepStrictEqual(yield* host.status, status);
      })
    )
  );
});
