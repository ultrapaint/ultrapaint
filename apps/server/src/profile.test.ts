import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Context, Effect, FileSystem, Layer, PlatformError } from "effect";
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
    "keeps the sandbox turned off, and forgets it once turned back on (ADR 0119)",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const user = yield* fs.makeTempDirectoryScoped();
        const kept = yield* Effect.scoped(
          ProfileService.use((profile) =>
            Effect.gen(function* () {
              yield* profile.set({ sandbox: false });
              yield* profile.set({ displayName: "Ada" });
              return yield* profile.get;
            })
          ).pipe(Effect.provide(profileOf(user)))
        );
        assert.deepStrictEqual(kept, { displayName: "Ada", sandbox: false });
        const on = yield* Effect.scoped(
          ProfileService.use((profile) =>
            Effect.gen(function* () {
              yield* profile.set({ sandbox: true });
              return yield* profile.get;
            })
          ).pipe(Effect.provide(profileOf(user)))
        );
        assert.deepStrictEqual(on, { displayName: "Ada" });
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

describe("the user's profile, unreadable for a moment (ADR 0106)", () => {
  it.effect("saves on what the server last had, never on nothing", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const user = yield* fs.makeTempDirectoryScoped();
      const saved = yield* Effect.scoped(
        Effect.gen(function* () {
          const built = yield* Layer.build(profileOf(user));
          const profile = Context.get(built, ProfileService);
          yield* profile.set({ displayName: "Ada" });
          // Half written by something else, as the next save reads it.
          yield* fs.writeFileString(`${user}/profile.json`, '{"displayName": ');
          return yield* profile.set({ preferences: { theme: "dark" } });
        })
      );
      assert.deepStrictEqual(saved, {
        displayName: "Ada",
        preferences: { theme: "dark" },
      });
    }).pipe(Effect.provide(NodeServices.layer))
  );
});

describe("the user's profile, unreadable from the start (ADR 0106)", () => {
  it.effect("keeps the file it can't read beside the one it saves", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const user = yield* fs.makeTempDirectoryScoped();
      const broken = '{"displayName": "Ada", ';
      yield* fs.writeFileString(`${user}/profile.json`, broken);
      const saved = yield* Effect.scoped(
        ProfileService.use((profile) =>
          profile.set({ preferences: { theme: "dark" } })
        ).pipe(Effect.provide(profileOf(user)))
      );
      assert.deepStrictEqual(saved, { preferences: { theme: "dark" } });
      const [aside] = (yield* fs.readDirectory(user)).filter((name) =>
        name.startsWith("profile.json.unreadable-")
      );
      assert.strictEqual(yield* fs.readFileString(`${user}/${aside}`), broken);
    }).pipe(Effect.provide(NodeServices.layer))
  );

  it.effect("never replaces an earlier one kept at the same time", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const user = yield* fs.makeTempDirectoryScoped();
      // The test clock stands at 0: an earlier one was kept at that time too.
      yield* fs.writeFileString(`${user}/profile.json.unreadable-0`, "earlier");
      yield* fs.writeFileString(`${user}/profile.json`, '{"displayName": ');
      yield* Effect.scoped(
        ProfileService.use((profile) =>
          profile.set({ preferences: { theme: "dark" } })
        ).pipe(Effect.provide(profileOf(user)))
      );
      assert.strictEqual(
        yield* fs.readFileString(`${user}/profile.json.unreadable-0`),
        "earlier"
      );
      assert.strictEqual(
        yield* fs.readFileString(`${user}/profile.json.unreadable-0-1`),
        '{"displayName": '
      );
    }).pipe(Effect.provide(NodeServices.layer))
  );

  it.effect(
    "refuses the save when the file it can't read can't be kept aside",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const user = yield* fs.makeTempDirectoryScoped();
        const broken = '{"displayName": "Ada", ';
        yield* fs.writeFileString(`${user}/profile.json`, broken);
        const refused = yield* Effect.scoped(
          ProfileService.use((profile) =>
            Effect.flip(profile.set({ preferences: { theme: "dark" } }))
          ).pipe(
            Effect.provide(
              profileOf(user).pipe(
                Layer.provide(
                  Layer.effect(
                    FileSystem.FileSystem,
                    Effect.map(FileSystem.FileSystem, (real) => ({
                      ...real,
                      link: (from: string) =>
                        Effect.fail(
                          new PlatformError.PlatformError(
                            new PlatformError.SystemError({
                              _tag: "PermissionDenied",
                              method: "link",
                              module: "FileSystem",
                              pathOrDescriptor: from,
                            })
                          )
                        ),
                    }))
                  )
                )
              )
            )
          )
        );
        assert.strictEqual(refused._tag, "BadRequest");
        assert.strictEqual(
          yield* fs.readFileString(`${user}/profile.json`),
          broken
        );
      }).pipe(Effect.provide(NodeServices.layer))
  );
});
