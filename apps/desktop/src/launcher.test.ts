import { execFileSync, spawnSync } from "node:child_process";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Path } from "effect";
import { launcherScript, shippedLauncherScript } from "./launcher.ts";

/** A stand-in for the server's bundle: says what it was given, and which app it is. */
const echo = (app: string) =>
  `console.log(JSON.stringify({ app: ${JSON.stringify(app)}, args: process.argv.slice(2), serve: process.env.ULTRAPAINT_SERVE, web: process.env.ULTRAPAINT_WEB_DIST }));`;

/**
 * A macOS app bundle as the release packages it, at `<dir>/<name>`: Node stands in for
 * Electron's binary (both run the server as Node), and `app` names the copy.
 */
const bundle = Effect.fn("bundle")(function* (at: string, app: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const contents = path.join(at, "Contents");
  const resources = path.join(contents, "Resources");
  yield* fs.makeDirectory(path.join(contents, "MacOS"), { recursive: true });
  yield* fs.symlink(
    process.execPath,
    path.join(contents, "MacOS", "Ultrapaint")
  );
  yield* fs.makeDirectory(path.join(resources, "app", "server"), {
    recursive: true,
  });
  yield* fs.writeFileString(
    path.join(resources, "app", "server", "bin.mjs"),
    echo(app)
  );
  yield* fs.makeDirectory(path.join(resources, "bin"));
  const launcher = path.join(resources, "bin", "ultrapaint");
  yield* fs.writeFileString(launcher, shippedLauncherScript("Ultrapaint"));
  yield* fs.chmod(launcher, 0o755);
  return { launcher, resources: yield* fs.realPath(resources) };
});

const run = (command: string, args: readonly string[] = ["mcp"]) =>
  JSON.parse(execFileSync(command, args, { encoding: "utf8" })) as {
    app: string;
    args: readonly string[];
    serve: string;
    web: string;
  };

describe("the ultrapaint command the macOS app ships (ADR 0088)", () => {
  it.effect(
    "finds the app from where it is, through the links that lead to it",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fs.makeTempDirectoryScoped();
        // A folder with a space and quotes, which the server's JSON keeps.
        const apps = path.join(root, `My "Apps" it's`);
        yield* fs.makeDirectory(apps);
        const { launcher, resources } = yield* bundle(
          path.join(apps, "Ultrapaint.app"),
          "one"
        );
        const expected = {
          app: "one",
          args: ["mcp", "it's here"],
          serve: JSON.stringify([path.join(resources, "bin", "ultrapaint")]),
          web: path.join(resources, "app", "web"),
        };
        assert.deepStrictEqual(run(launcher, ["mcp", "it's here"]), expected);

        // As Homebrew links it, by its absolute path.
        const prefix = path.join(root, "prefix", "bin");
        yield* fs.makeDirectory(prefix, { recursive: true });
        yield* fs.symlink(launcher, path.join(prefix, "ultrapaint"));
        assert.deepStrictEqual(
          run(path.join(prefix, "ultrapaint"), ["mcp", "it's here"]),
          expected
        );

        // A relative link to that link.
        const other = path.join(root, "other");
        yield* fs.makeDirectory(other);
        yield* fs.symlink(
          "../prefix/bin/ultrapaint",
          path.join(other, "ultrapaint")
        );
        assert.deepStrictEqual(
          run(path.join(other, "ultrapaint"), ["mcp", "it's here"]),
          expected
        );
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.effect(
    "runs the new app once an update has put it where the old one was",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fs.makeTempDirectoryScoped();
        const at = path.join(root, "Ultrapaint.app");
        const { launcher } = yield* bundle(at, "old");
        const link = path.join(root, "ultrapaint");
        yield* fs.symlink(launcher, link);
        assert.strictEqual(run(link).app, "old");

        // As the update swaps it (ADR 0078): the old bundle aside, the new one in its place.
        yield* fs.rename(at, `${at}.old`);
        yield* bundle(at, "new");
        yield* fs.remove(`${at}.old`, { recursive: true });
        assert.strictEqual(run(link).app, "new");
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.effect("says so when the app it runs is gone", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped();
      const { launcher } = yield* bundle(
        path.join(root, "Ultrapaint.app"),
        "x"
      );
      yield* fs.remove(path.join(root, "Ultrapaint.app", "Contents", "MacOS"), {
        recursive: true,
      });
      const result = spawnSync(launcher, ["mcp"], { encoding: "utf8" });
      assert.strictEqual(result.status, 127);
      assert.include(result.stderr, "Ultrapaint has moved or been removed");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );
});

describe("the ultrapaint command the app writes (ADR 0083)", () => {
  it.effect(
    "says how to install it again when the app it names has moved",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const dir = yield* fs.makeTempDirectoryScoped();
        const launcher = path.join(dir, "ultrapaint");
        yield* fs.writeFileString(
          launcher,
          launcherScript(
            {
              _tag: "Bundle",
              executable: path.join(dir, "Moved.app", "Contents", "MacOS", "x"),
              serverBin: "/app/server/bin.mjs",
              webDist: "/app/web",
            },
            launcher
          )
        );
        yield* fs.chmod(launcher, 0o755);
        const result = spawnSync(launcher, ["mcp"], { encoding: "utf8" });
        assert.strictEqual(result.status, 127);
        assert.include(result.stderr, "install the command again");
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );
});
