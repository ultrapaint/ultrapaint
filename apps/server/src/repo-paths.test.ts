import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Path } from "effect";
import { RepoPaths } from "./services/repo-paths.ts";

describe("RepoPaths.resolve", () => {
  it.effect(
    "hands back where a linked directory leads, and refuses one that leads out",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const repo = yield* fs.realPath(yield* fs.makeTempDirectoryScoped());
        const outside = yield* fs.realPath(yield* fs.makeTempDirectoryScoped());
        yield* fs.makeDirectory(path.join(repo, "real"));
        yield* fs.symlink(path.join(repo, "real"), path.join(repo, "linked"));
        yield* fs.symlink(outside, path.join(repo, "away"));
        // A link as the last name stays a link: it is replaced or removed, not written through.
        yield* fs.writeFileString(path.join(repo, "real", "page.json"), "{}");
        yield* fs.symlink(
          path.join(repo, "real", "page.json"),
          path.join(repo, "alias.json")
        );
        yield* Effect.gen(function* () {
          const paths = yield* RepoPaths;
          assert.strictEqual(
            yield* paths.resolve("linked/new.json"),
            path.join(repo, "real", "new.json")
          );
          assert.strictEqual(
            yield* paths.resolve("alias.json"),
            path.join(repo, "alias.json")
          );
          const away = yield* Effect.flip(paths.resolve("away/secret"));
          assert.strictEqual(away._tag, "ForbiddenPath");
        }).pipe(
          Effect.provide(
            RepoPaths.layer({
              componentPackages: [],
              designsDir: "real",
              hostCss: [],
              libraryDirs: [],
              repoPath: repo,
              theme: "light",
            })
          )
        );
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );
});
