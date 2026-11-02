import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Path } from "effect";
import { RepoPaths } from "./services/repo-paths.ts";
import { Storage } from "./services/storage.ts";
import { WorkingTree } from "./services/working-tree.ts";
import { makeTreeWalk } from "./tree-walk.ts";

/** A folder with the files given, written as they are; no git. */
const folderWith = (files: Record<string, string>) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = yield* fs.realPath(yield* fs.makeTempDirectoryScoped());
    for (const [rel, text] of Object.entries(files)) {
      yield* fs.makeDirectory(path.dirname(path.join(root, rel)), {
        recursive: true,
      });
      yield* fs.writeFileString(path.join(root, rel), text);
    }
    return root;
  });

describe("the tree walk", () => {
  it.effect("leaves out what .gitignore files ignore, as git does", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* folderWith({
        ".gitignore": "*.log\n/build/\n!keep.log\n",
        ".ultrapaint/threads/t.json": "{}",
        "app/.gitignore": "generated/\n",
        "app/generated/x.ts": "",
        "app/keep.log": "",
        "app/src/debug.log": "",
        "app/src/main.ts": "",
        "build/out.js": "",
        "designs/home.page.json": "{}",
        "dist/bundle.js": "",
        "node_modules/pkg/index.js": "",
        "packages/ui/dist/index.js": "",
      });
      const walk = makeTreeWalk(fs, path);
      const files = (yield* walk(root, {
        skip: [path.join(root, ".ultrapaint")],
      })).map((e) => e.path);
      assert.deepStrictEqual(files, [
        ".gitignore",
        "app/.gitignore",
        "app/keep.log",
        "app/src/main.ts",
        "designs/home.page.json",
      ]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );
});

describe("WorkingTree", () => {
  const treeOf = (root: string, stateDir: string) =>
    WorkingTree.layer.pipe(
      Layer.provide(
        RepoPaths.layer({
          designsDir: "designs",
          hostCss: [],
          libraryDirs: [],
          repoPath: root,
        })
      ),
      Layer.provide(
        Layer.succeed(
          Storage,
          Storage.of({
            info: Effect.succeed({ mode: "ephemeral" }),
            promote: () => Effect.void,
            rename: () => Effect.void,
            stateDir: Effect.succeed(stateDir),
            target: Effect.succeed({ mode: "ephemeral" }),
          })
        )
      )
    );

  it.effect(
    "tells which files changed, and a file only touched from one changed",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* folderWith({
          "designs/home.page.json": "{}",
          "src/a.ts": "one",
          "src/gone.ts": "",
        });
        const stateDir = path.join(root, ".ultrapaint");
        yield* fs.makeDirectory(stateDir);
        const at = (seconds: number) => new Date(1_700_000_000_000 + seconds);
        const write = (rel: string, text: string, seconds: number) =>
          Effect.andThen(
            fs.writeFileString(path.join(root, rel), text),
            fs.utimes(path.join(root, rel), at(seconds), at(seconds))
          );
        yield* Effect.gen(function* () {
          const tree = yield* WorkingTree;
          const first = yield* tree.stamp;
          yield* write("src/a.ts", "two", 1000);
          yield* write("src/new.ts", "", 1000);
          yield* fs.remove(path.join(root, "src/gone.ts"));
          // The tool's own state is not the project's files.
          yield* fs.writeFileString(path.join(stateDir, "run.json"), "{}");
          assert.deepStrictEqual(yield* tree.changedSince(first), [
            "src/a.ts",
            "src/gone.ts",
            "src/new.ts",
          ]);

          // Written again as it was: the time moved, the content did not.
          const second = yield* tree.stamp;
          yield* write("src/a.ts", "two", 2000);
          assert.deepStrictEqual(yield* tree.changedSince(second), []);

          // The same size, other content.
          const third = yield* tree.stamp;
          yield* write("src/a.ts", "six", 3000);
          assert.deepStrictEqual(yield* tree.changedSince(third), ["src/a.ts"]);
          assert.deepStrictEqual(yield* tree.files, [
            "designs/home.page.json",
            "src/a.ts",
            "src/new.ts",
          ]);
        }).pipe(Effect.provide(treeOf(root, stateDir)));
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );
});
