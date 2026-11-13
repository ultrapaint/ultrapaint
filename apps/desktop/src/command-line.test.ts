import { execFileSync } from "node:child_process";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Option, Path } from "effect";
import { CommandLine, commandApp } from "./command-line.ts";
import {
  type CommandApp,
  launcherScript,
  shippedLauncherScript,
} from "./launcher.ts";
import { LoginShell } from "./login-shell.ts";

/** A stand-in for the server's bundle: says what it was given. */
const ECHO =
  "console.log(JSON.stringify({ args: process.argv.slice(2), serve: process.env.ULTRAPAINT_SERVE, web: process.env.ULTRAPAINT_WEB_DIST }));";

const install = (home: string, pathVariable: string, app: CommandApp) =>
  Effect.provide(
    CommandLine,
    CommandLine.layer({ app, home, platform: "linux" }).pipe(
      Layer.provide(LoginShell.layerTest({ PATH: pathVariable }))
    )
  );

const BUNDLE: CommandApp = {
  _tag: "Bundle",
  executable: process.execPath,
  serverBin: "/app/server/bin.mjs",
  webDist: "/app/web",
};

describe("the ultrapaint command the app installs (ADR 0083)", () => {
  it.effect(
    "goes in ~/.local/bin when it is on the PATH, and is found there as the app's",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const home = yield* fs.makeTempDirectoryScoped();
        const bin = path.join(home, ".local", "bin");
        yield* fs.makeDirectory(bin, { recursive: true });
        const commandLine = yield* install(home, `/usr/bin:${bin}`, BUNDLE);
        assert.isNull(yield* commandLine.installed);
        const installed = yield* commandLine.install;
        const file = path.join(bin, "ultrapaint");
        assert.deepStrictEqual(installed, {
          onPath: true,
          ours: true,
          path: file,
          shipped: false,
        });
        assert.deepStrictEqual(yield* commandLine.installed, installed);
        const info = yield* fs.stat(file);
        assert.strictEqual(Number(info.mode) % 0o1000, 0o755);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.effect(
    "says when another ultrapaint comes first on the PATH, a checkout's",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const home = yield* fs.makeTempDirectoryScoped();
        const other = path.join(home, "checkout");
        yield* fs.makeDirectory(other);
        yield* fs.writeFileString(
          path.join(other, "ultrapaint"),
          "#!/bin/sh\n"
        );
        const commandLine = yield* install(home, other, BUNDLE);
        assert.deepStrictEqual(yield* commandLine.installed, {
          onPath: true,
          ours: false,
          path: path.join(other, "ultrapaint"),
          shipped: false,
        });
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.effect(
    "on Linux with no folder of the user's on the PATH, writes ~/.local/bin and says it is not on it",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const home = yield* fs.makeTempDirectoryScoped();
        const commandLine = yield* install(home, "/usr/bin", BUNDLE);
        assert.deepStrictEqual(yield* commandLine.install, {
          onPath: false,
          ours: true,
          path: path.join(home, ".local", "bin", "ultrapaint"),
          shipped: false,
        });
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.effect(
    "is Homebrew's link to the launcher the app ships, and writes none beside it (ADR 0088)",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const home = yield* fs.makeTempDirectoryScoped();
        const bin = path.join(home, ".local", "bin");
        yield* fs.makeDirectory(bin, { recursive: true });
        const shipped = path.join(
          home,
          "Ultrapaint.app",
          "Contents",
          "Resources",
          "bin"
        );
        yield* fs.makeDirectory(shipped, { recursive: true });
        yield* fs.writeFileString(
          path.join(shipped, "ultrapaint"),
          shippedLauncherScript("Ultrapaint")
        );
        const brew = path.join(home, "homebrew", "bin");
        yield* fs.makeDirectory(brew, { recursive: true });
        yield* fs.symlink(
          path.join(shipped, "ultrapaint"),
          path.join(brew, "ultrapaint")
        );
        const commandLine = yield* install(home, `${bin}:${brew}`, BUNDLE);
        const linked = {
          onPath: true,
          ours: true,
          path: path.join(brew, "ultrapaint"),
          shipped: true,
        };
        assert.deepStrictEqual(yield* commandLine.installed, linked);
        assert.deepStrictEqual(yield* commandLine.install, linked);
        assert.isFalse(yield* fs.exists(path.join(bin, "ultrapaint")));
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.effect("writes the launcher it wrote again, for an app that moved", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* fs.makeTempDirectoryScoped();
      const bin = path.join(home, ".local", "bin");
      yield* fs.makeDirectory(bin, { recursive: true });
      const file = path.join(bin, "ultrapaint");
      yield* fs.writeFileString(
        file,
        launcherScript({ ...BUNDLE, executable: "/moved/Ultrapaint" }, file)
      );
      const commandLine = yield* install(home, bin, BUNDLE);
      yield* commandLine.install;
      assert.include(yield* fs.readFileString(file), process.execPath);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.effect(
    "runs the app's server with its arguments, and names itself as the way to start one",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const dir = yield* fs.makeTempDirectoryScoped();
        const server = path.join(dir, "bin.mjs");
        yield* fs.writeFileString(server, ECHO);
        const launcher = path.join(dir, "ultrapaint");
        yield* fs.writeFileString(
          launcher,
          launcherScript({ ...BUNDLE, serverBin: server }, launcher)
        );
        yield* fs.chmod(launcher, 0o755);
        const said = JSON.parse(
          execFileSync(launcher, ["mcp", "it's here"], { encoding: "utf8" })
        );
        assert.deepStrictEqual(said, {
          args: ["mcp", "it's here"],
          serve: JSON.stringify([launcher]),
          web: "/app/web",
        });
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.effect(
    "in an AppImage, finds the server under the mount the AppImage names",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const mount = yield* fs.makeTempDirectoryScoped();
        yield* fs.makeDirectory(
          path.join(mount, "resources", "app", "server"),
          {
            recursive: true,
          }
        );
        yield* fs.writeFileString(
          path.join(mount, "resources", "app", "server", "bin.mjs"),
          ECHO
        );
        const app = commandApp({
          appDir: path.join(mount, "resources", "app"),
          // Node stands in for the AppImage: both run as Node here, with -e.
          appImage: Option.some({ dir: mount, file: process.execPath }),
          executable: "/unused",
        });
        const launcher = path.join(mount, "ultrapaint");
        yield* fs.writeFileString(launcher, launcherScript(app, launcher));
        yield* fs.chmod(launcher, 0o755);
        const said = JSON.parse(
          execFileSync(launcher, ["mcp"], {
            encoding: "utf8",
            env: { ...process.env, APPDIR: mount },
          })
        );
        assert.deepStrictEqual(said.args, ["mcp"]);
        assert.strictEqual(
          said.web,
          path.join(mount, "resources", "app", "web")
        );
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );
});
