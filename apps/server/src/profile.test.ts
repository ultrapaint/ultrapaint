import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Layer } from "effect";
import { AppLog } from "./app-log.ts";
import { ServerConfig } from "./config.ts";
import { EventBus } from "./events.ts";
import { ProfileService } from "./services/profile.ts";

/** The profile of the user whose directory is `userDir`. */
const profileOf = (userDir: string) =>
  ProfileService.layer.pipe(
    Layer.provide(AppLog.layer),
    Layer.provide(EventBus.layer),
    Layer.provide(ServerConfig.layerTest({ userDir }))
  );

describe("the user's profile", () => {
  it.effect(
    "keeps what a save leaves out: the name and keeping findings are set apart (ADR 0066)",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const user = yield* fs.makeTempDirectoryScoped();
        const saved = yield* Effect.scoped(
          ProfileService.use((profile) =>
            Effect.gen(function* () {
              yield* profile.set({ keepFindings: true });
              yield* profile.set({ displayName: "Ada" });
              return yield* profile.get;
            })
          ).pipe(Effect.provide(profileOf(user)))
        );
        assert.deepStrictEqual(saved, {
          displayName: "Ada",
          keepFindings: true,
        });
        // Read again from the user's directory, as the next server does.
        const read = yield* Effect.scoped(
          ProfileService.use((profile) =>
            Effect.gen(function* () {
              yield* profile.set({ keepFindings: false });
              return yield* profile.get;
            })
          ).pipe(Effect.provide(profileOf(user)))
        );
        assert.deepStrictEqual(read, { displayName: "Ada" });
      }).pipe(Effect.provide(NodeServices.layer))
  );
});
