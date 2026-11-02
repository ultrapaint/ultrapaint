import path from "node:path";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Option, type Path } from "effect";
import { TestClock } from "effect/testing";
import {
  PROJECTS_FILE,
  ProjectStore,
  projectDetail,
  remoteInputOf,
} from "./projects.ts";

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

  it.effect(
    "reads a list written before remote projects, and one with both",
    () =>
      inTemp((dir) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const file = path.join(dir, PROJECTS_FILE);
          yield* fs.writeFileString(
            file,
            JSON.stringify({
              projects: [
                { id: "a", kind: "local", name: "shop", path: "/work/shop" },
              ],
              version: 1,
            })
          );
          const store = yield* ProjectStore;
          assert.deepStrictEqual(yield* store.list, [
            { id: "a", kind: "local", name: "shop", path: "/work/shop" },
          ]);
          const remote = yield* store.addRemote({
            host: "devbox",
            path: "~/code/atlas/",
          });
          assert.deepStrictEqual(remote, {
            host: "devbox",
            id: remote.id,
            kind: "ssh",
            name: "atlas",
            path: "~/code/atlas",
          });
          // Read again from the file, as the next start of the app does.
          const reread = yield* Effect.provide(
            ProjectStore.use((s) => s.list),
            ProjectStore.layer(dir)
          );
          assert.deepStrictEqual(
            reread.map((p) => [p.kind, p.name]),
            [
              ["ssh", "atlas"],
              ["local", "shop"],
            ]
          );
          assert.strictEqual(projectDetail(remote), "devbox:~/code/atlas");
        })
      )
  );

  it.effect(
    "adds a remote folder once per host, port and path, and takes a new command",
    () =>
      inTemp(() =>
        Effect.gen(function* () {
          const store = yield* ProjectStore;
          const first = yield* store.addRemote({
            host: "me@box",
            path: "/srv/site",
            port: 2222,
          });
          assert.strictEqual(first.command, undefined);
          assert.strictEqual(projectDetail(first), "me@box:2222:/srv/site");
          const again = yield* store.addRemote({
            command: "node ~/ultrapaint/scripts/cli.ts",
            host: "me@box",
            path: "/srv/site/",
            port: 2222,
          });
          assert.strictEqual(again.id, first.id);
          assert.strictEqual(again.command, "node ~/ultrapaint/scripts/cli.ts");
          // Not given, it stays; given empty, the default is back.
          const kept = yield* store.addRemote({
            host: "me@box",
            path: "/srv/site",
            port: 2222,
          });
          assert.strictEqual(kept.command, "node ~/ultrapaint/scripts/cli.ts");
          const reset = yield* store.addRemote({
            command: " ",
            host: "me@box",
            path: "/srv/site",
            port: 2222,
          });
          assert.notProperty(reset, "command");
          // Another port is another machine, as far as the list knows.
          const other = yield* store.addRemote({
            host: "me@box",
            path: "/srv/site",
          });
          assert.notStrictEqual(other.id, first.id);
          // A local folder of the same path is a project of its own.
          const local = yield* store.add("/srv/site");
          assert.strictEqual(local.kind, "local");
          assert.strictEqual((yield* store.list).length, 3);
        })
      )
  );
});

describe("remoteInputOf", () => {
  it("splits the host's port off and keeps the path as typed", () => {
    assert.deepStrictEqual(
      remoteInputOf({ host: " me@box:2222 ", path: "~/code/shop/" }),
      {
        input: {
          command: undefined,
          host: "me@box",
          path: "~/code/shop",
          port: 2222,
        },
      }
    );
  });

  it("says what is wrong with a host or a path", () => {
    const host = remoteInputOf({ host: "two words", path: "/srv" });
    assert.include("problem" in host ? host.problem : "", "is not a host");
    const relative = remoteInputOf({ host: "box", path: "code/shop" });
    assert.include(
      "problem" in relative ? relative.problem : "",
      "not a folder's full path on box"
    );
  });
});
