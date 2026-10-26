import path from "node:path";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Option, type Path } from "effect";
import { TestClock } from "effect/testing";
import { PROJECTS_FILE, ProjectStore } from "./projects.ts";

const inTemp = <A, E>(
  body: (
    dir: string
  ) => Effect.Effect<A, E, ProjectStore | FileSystem.FileSystem | Path.Path>
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const dir = yield* fs.makeTempDirectoryScoped();
    return yield* body(dir).pipe(Effect.provide(ProjectStore.layer(dir)));
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

describe("ProjectStore", () => {
  it.effect("starts empty, with no file until a project is added", () =>
    inTemp((dir) =>
      Effect.gen(function* () {
        const store = yield* ProjectStore;
        const fs = yield* FileSystem.FileSystem;
        assert.deepStrictEqual(yield* store.list, []);
        assert.isTrue(Option.isNone(yield* store.last));
        assert.isFalse(yield* fs.exists(path.join(dir, PROJECTS_FILE)));
      })
    )
  );

  it.effect("adds a folder once, named after it, and lists by name", () =>
    inTemp(() =>
      Effect.gen(function* () {
        const store = yield* ProjectStore;
        const shop = yield* store.add("/work/shop");
        assert.strictEqual(shop.name, "shop");
        assert.strictEqual(shop.kind, "local");
        assert.strictEqual(shop.path, "/work/shop");
        yield* store.add("/work/atlas");
        // The same folder again is the same project.
        const again = yield* store.add("/work/shop/");
        assert.strictEqual(again.id, shop.id);
        assert.deepStrictEqual(
          (yield* store.list).map((p) => p.name),
          ["atlas", "shop"]
        );
      })
    )
  );

  it.effect("remembers which was opened last, across a restart", () =>
    inTemp((dir) =>
      Effect.gen(function* () {
        const store = yield* ProjectStore;
        const a = yield* store.add("/work/a");
        const b = yield* store.add("/work/b");
        yield* TestClock.adjust("1 second");
        yield* store.opened(b.id);
        yield* TestClock.adjust("1 second");
        yield* store.opened(a.id);
        // Read again from the file, as the next start of the app does.
        const reread = yield* Effect.provide(
          ProjectStore.use((s) => s.last),
          ProjectStore.layer(dir)
        );
        assert.strictEqual(Option.getOrThrow(reread).id, a.id);
        const unknown = yield* Effect.flip(store.get("nope"));
        assert.strictEqual(unknown._tag, "UnknownProject");
      })
    )
  );

  it.effect("does not replace a list it cannot read with an empty one", () =>
    inTemp((dir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const file = path.join(dir, PROJECTS_FILE);
        yield* fs.writeFileString(file, "{ broken");
        const store = yield* ProjectStore;
        const error = yield* Effect.flip(store.add("/work/c"));
        assert.strictEqual(error._tag, "StoreError");
        assert.strictEqual(yield* fs.readFileString(file), "{ broken");
      })
    )
  );
});
