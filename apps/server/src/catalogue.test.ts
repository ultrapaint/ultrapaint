import { pathToFileURL } from "node:url";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Exit, FileSystem, Path } from "effect";
import { TestClock } from "effect/testing";
import { buildInWorker } from "./services/catalogue.ts";

describe("the catalogue worker", () => {
  it.effect("fails a build whose worker ends without a catalogue", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = yield* fs.makeTempDirectoryScoped();
      const script = path.join(dir, "silent-worker.mjs");
      // Ends at once, exit code 0, having sent nothing.
      yield* fs.writeFileString(script, "export {};\n");
      const exit = yield* buildInWorker(
        pathToFileURL(script),
        { componentPackages: [], libraryDirs: [], root: dir },
        []
      ).pipe(
        Effect.timeoutOption("3 seconds"),
        TestClock.withLive,
        Effect.exit
      );
      assert.isTrue(Exit.hasDies(exit));
    }).pipe(Effect.provide(NodeServices.layer))
  );
});
