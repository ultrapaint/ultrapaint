import { homedir } from "node:os";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Path } from "effect";
import { ServerConfig } from "./config.ts";
import { PNG_DATA_URL } from "./png-text.ts";
import { Storage } from "./services/storage.ts";
import { Thumbnails } from "./services/thumbnails.ts";

/** The thumbnails of a server whose state is in `home`: one start of it. */
const thumbnailsIn = (home: string) =>
  Thumbnails.layer.pipe(
    Layer.provide(Storage.layer),
    Layer.provide(
      ServerConfig.layerTest({
        cwd: home,
        machine: { home: homedir() },
        storage: { home, mode: "managed" },
        userDir: home,
      })
    )
  );

/** What a server started on `home` does with its thumbnails, until it stops. */
const started = <A, E>(
  home: string,
  use: (thumbnails: Thumbnails["Service"]) => Effect.Effect<A, E>
) =>
  Effect.flatMap(Thumbnails, use).pipe(
    Effect.provide(thumbnailsIn(home)),
    Effect.scoped
  );

const PICTURE = `${PNG_DATA_URL}${Buffer.from("a picture").toString("base64")}`;

/** The names in a directory of the state, in order; none when it is not there. */
const namesIn = (...dir: string[]) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const names = yield* Effect.orElseSucceed(
      fs.readDirectory(path.join(...dir)),
      (): string[] => []
    );
    return names.toSorted();
  });

/** A file of the state as an earlier start left it, written at `at` seconds. */
const left = (home: string, file: string, at = 0) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const abs = path.join(home, file);
    yield* fs.makeDirectory(path.dirname(abs), { recursive: true });
    yield* fs.writeFileString(abs, "left");
    yield* fs.utimes(abs, at, at);
  });

describe("thumbnails", () => {
  it.effect(
    "keep a thread's last picture, and none of a thread that is gone",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const home = yield* fs.makeTempDirectoryScoped();
        yield* left(home, "threads/thread_a_00001.json");
        yield* left(home, "thumbnails/threads/thread_a_00001__h1-page.png", 1);
        yield* left(home, "thumbnails/threads/thread_a_00001__h3-page.png", 3);
        yield* left(home, "thumbnails/threads/thread_a_00001__h2-page.png", 2);
        yield* left(home, "thumbnails/threads/thread_b_00001__h1-page.png", 1);
        // Not named as a thread's picture is: nothing says it is one too many.
        yield* left(home, "thumbnails/threads/logo.png", 1);
        const given = yield* started(home, (t) => t.get("threads"));
        assert.sameMembers(Object.keys(given), [
          "logo",
          "thread_a_00001__h3-page",
        ]);
        assert.deepStrictEqual(yield* namesIn(home, "thumbnails", "threads"), [
          "logo.png",
          "thread_a_00001__h3-page.png",
        ]);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.effect(
    "let go of a thread's earlier picture when a later one is put",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const home = yield* fs.makeTempDirectoryScoped();
        yield* started(home, (t) =>
          Effect.gen(function* () {
            yield* t.put("threads", "thread_a_00001__h1-page", PICTURE);
            yield* t.put("threads", "thread_b_00001__h1-page", PICTURE);
            yield* t.put("threads", "thread_a_00001__h2-page", PICTURE);
          })
        );
        assert.deepStrictEqual(yield* namesIn(home, "thumbnails", "threads"), [
          "thread_a_00001__h2-page.png",
          "thread_b_00001__h1-page.png",
        ]);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.effect(
    "keep every state asked for since the server started, and let go of those from before",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const home = yield* fs.makeTempDirectoryScoped();
        yield* started(home, (t) =>
          Effect.gen(function* () {
            yield* t.put("state1", "Button", PICTURE);
            yield* t.put("state2", "Button", PICTURE);
            yield* t.put("threads", "thread_a_00001__h1-page", PICTURE);
            // Back in the first: the second is still there to go back to.
            assert.deepStrictEqual(Object.keys(yield* t.get("state1")), [
              "Button",
            ]);
          })
        );
        assert.deepStrictEqual(yield* namesIn(home, "thumbnails"), [
          "state1",
          "state2",
          "threads",
        ]);

        const again = yield* started(home, (t) => t.get("state2"));
        assert.deepStrictEqual(Object.keys(again), ["Button"]);
        assert.deepStrictEqual(yield* namesIn(home, "thumbnails"), [
          "state2",
          "threads",
        ]);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );
});
