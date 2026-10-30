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
              designsDir: "real",
              hostCss: [],
              libraryDirs: [],
              repoPath: repo,
            })
          )
        );
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );
});

describe("a designs directory that is a link", () => {
  it.effect(
    "names what is in it under its own name, and still refuses a way out",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const repo = yield* fs.realPath(yield* fs.makeTempDirectoryScoped());
        const outside = yield* fs.realPath(yield* fs.makeTempDirectoryScoped());
        const real = path.join(repo, "packages/ui/designs");
        yield* fs.makeDirectory(real, { recursive: true });
        yield* fs.makeDirectory(path.join(repo, "docs"));
        yield* fs.symlink(real, path.join(repo, "docs/designs"));
        yield* fs.symlink(outside, path.join(real, "away"));
        yield* Effect.gen(function* () {
          const paths = yield* RepoPaths;
          const page = yield* paths.resolve("docs/designs/home.page.json");
          assert.strictEqual(
            page,
            path.join(repo, "docs/designs/home.page.json")
          );
          const rel = paths.relative(page);
          assert.strictEqual(rel, "docs/designs/home.page.json");
          assert.isTrue(paths.isEditable(rel));
          const nested = yield* paths.resolve("docs/designs/flows/a.page.json");
          assert.strictEqual(
            paths.relative(nested),
            "docs/designs/flows/a.page.json"
          );
          const away = yield* Effect.flip(
            paths.resolve("docs/designs/away/secret")
          );
          assert.strictEqual(away._tag, "ForbiddenPath");
        }).pipe(
          Effect.provide(
            RepoPaths.layer({
              designsDir: "docs/designs",
              hostCss: [],
              libraryDirs: [],
              repoPath: repo,
            })
          )
        );
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );
});
