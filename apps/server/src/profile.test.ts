import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Context, Effect, FileSystem, Layer } from "effect";
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

  it.effect(
    "keeps the editor's preferences across servers, each one apart from the others (ADR 0093)",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const user = yield* fs.makeTempDirectoryScoped();
        yield* Effect.scoped(
          ProfileService.use((profile) =>
            Effect.gen(function* () {
              yield* profile.set({ displayName: "Ada" });
              yield* profile.set({ preferences: { theme: "dark" } });
              yield* profile.set({ preferences: { accent: "teal" } });
            })
          ).pipe(Effect.provide(profileOf(user)))
        );
        // The next project's server, on another port, reads them from the person's folder.
        const read = yield* Effect.scoped(
          ProfileService.use((profile) => profile.get).pipe(
            Effect.provide(profileOf(user))
          )
        );
        assert.deepStrictEqual(read, {
          displayName: "Ada",
          preferences: { accent: "teal", theme: "dark" },
        });
      }).pipe(Effect.provide(NodeServices.layer))
  );
});

describe("the user's profile, saved by two servers at once (ADR 0106)", () => {
  it.effect(
    "keeps what another server saved since this one read the profile",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const user = yield* fs.makeTempDirectoryScoped();
        // Two projects' servers, both started before either saved.
        const saved = yield* Effect.scoped(
          Effect.gen(function* () {
            const a = yield* Layer.build(profileOf(user));
            const b = yield* Layer.build(profileOf(user));
            const one = Context.get(a, ProfileService);
            const other = Context.get(b, ProfileService);
            yield* one.set({ preferences: { "ignoredProblems:/a": ["x"] } });
            yield* other.set({ preferences: { "ignoredProblems:/b": ["y"] } });
            return yield* one.get;
          })
        );
        assert.deepStrictEqual(saved.preferences, {
          "ignoredProblems:/a": ["x"],
          "ignoredProblems:/b": ["y"],
        });
      }).pipe(Effect.provide(NodeServices.layer))
  );
});
