import { NodeHttpServer, NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Path } from "effect";
import { HttpRouter } from "effect/http";
import { editorBuild } from "./editor-build.ts";

/** A build of the editor in a directory of its own, and the router serving it. */
const served = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const dir = yield* fs.makeTempDirectoryScoped();
  yield* fs.makeDirectory(path.join(dir, "assets"));
  yield* fs.writeFileString(
    path.join(dir, "index.html"),
    "<html>editor</html>"
  );
  yield* fs.writeFileString(
    path.join(dir, "assets", "index-AbC123.js"),
    "run()"
  );
  const { dispose, handler } = HttpRouter.toWebHandler(
    editorBuild(dir).pipe(
      Layer.provide(NodeHttpServer.layerHttpServices),
      Layer.provide(NodeServices.layer)
    ),
    { disableLogger: true }
  );
  yield* Effect.addFinalizer(() => Effect.promise(dispose));
  return (url: string) =>
    Effect.promise(async () => {
      const response = await handler(new Request(`http://127.0.0.1${url}`));
      return {
        body: await response.text(),
        cache: response.headers.get("cache-control"),
        status: response.status,
      };
    });
});

describe("the built editor", () => {
  it.effect("keeps its assets for good, and asks for its pages each time", () =>
    Effect.gen(function* () {
      const get = yield* served;
      assert.deepStrictEqual(yield* get("/assets/index-AbC123.js"), {
        body: "run()",
        cache: "public, max-age=31536000, immutable",
        status: 200,
      });
      assert.deepStrictEqual(yield* get("/"), {
        body: "<html>editor</html>",
        cache: "no-cache",
        status: 200,
      });
      // An asset of another build is not there: no page in its place, which would run as code.
      assert.strictEqual((yield* get("/assets/index-Old999.js")).status, 404);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );
});
