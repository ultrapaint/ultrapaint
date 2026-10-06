import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Path } from "effect";
import { makeStampedCache } from "./file-stamp.ts";

describe("a stamped cache", () => {
  it.effect(
    "reads again only when a file it was read from changes, or when cleared",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const dir = yield* fs.makeTempDirectoryScoped();
        const file = path.join(dir, "tokens.css");
        yield* fs.writeFileString(file, "one");
        let reads = 0;
        const cache = makeStampedCache(
          fs,
          Effect.map(fs.readFileString(file), (value) => {
            reads += 1;
            return { files: [file], value };
          })
        );
        // The first reading names its files; the second is kept against them.
        assert.strictEqual(yield* cache.get, "one");
        assert.strictEqual(yield* cache.get, "one");
        assert.strictEqual(yield* cache.get, "one");
        assert.strictEqual(reads, 2);

        // Rewritten through a rename, as the server writes: another file.
        yield* fs.writeFileString(`${file}.tmp`, "two");
        yield* fs.rename(`${file}.tmp`, file);
        assert.strictEqual(yield* cache.get, "two");
        assert.strictEqual(yield* cache.get, "two");
        assert.strictEqual(reads, 3);

        // Gone is a change too.
        yield* fs.remove(file);
        const missing = yield* Effect.flip(cache.get);
        assert.strictEqual(missing._tag, "PlatformError");

        yield* fs.writeFileString(file, "three");
        assert.strictEqual(yield* cache.get, "three");
        yield* cache.clear;
        assert.strictEqual(yield* cache.get, "three");
        assert.strictEqual(reads, 5);
      }).pipe(Effect.provide(NodeServices.layer))
  );
});
