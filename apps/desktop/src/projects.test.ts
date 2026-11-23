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
  it.effect(
    "keeps each step's time of a project's opening, the editor's over the shell's, across a restart",
    () =>
      inTemp((dir) =>
        Effect.gen(function* () {
          const store = yield* ProjectStore;
          const a = yield* store.add("/work/a");
          yield* store.timed(a.id, { canvas: 900, server: 400 });
          yield* store.timed(a.id, { canvas: 300, project: 200 });
          const reread = yield* Effect.provide(
            ProjectStore.use((s) => s.get(a.id)),
            ProjectStore.layer(dir)
          );
          assert.deepStrictEqual(reread.lastOpening, {
            canvas: 300,
            project: 200,
            server: 400,
          });
        })
      )
  );

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

  it.effect(
    "takes a project off the list and leaves the others; one not there changes nothing",
    () =>
      inTemp((dir) =>
        Effect.gen(function* () {
          const store = yield* ProjectStore;
          const fs = yield* FileSystem.FileSystem;
          const shop = yield* store.add("/work/shop");
          const site = yield* store.addRemote({
            host: "devbox",
            path: "~/site",
          });
          yield* store.remove(shop.id);
          const file = path.join(dir, PROJECTS_FILE);
          const written = yield* fs.readFileString(file);
          yield* store.remove(shop.id);
          yield* store.remove("nope");
          assert.strictEqual(yield* fs.readFileString(file), written);
          // Read again from the file, as the next start of the app does.
          const reread = yield* Effect.provide(
            ProjectStore.use((s) => s.list),
            ProjectStore.layer(dir)
          );
          assert.deepStrictEqual(
            reread.map((p) => p.id),
            [site.id]
          );
          const gone = yield* Effect.flip(store.get(shop.id));
          assert.strictEqual(gone._tag, "UnknownProject");
        })
      )
  );

  it.effect(
    "keeps the open tabs and the one shown across a restart, without a project gone from the list",
    () =>
      inTemp((dir) =>
        Effect.gen(function* () {
          const store = yield* ProjectStore;
          const a = yield* store.add("/work/a");
          const b = yield* store.add("/work/b");
          const c = yield* store.add("/work/c");
          yield* store.setTabs({ open: [c.id, a.id, b.id], shown: a.id });
          // Taken off the list, its tab goes too, and Home is shown in its place.
          yield* store.remove(a.id);
          const reread = yield* Effect.provide(
            ProjectStore.use((s) => s.tabs),
            ProjectStore.layer(dir)
          );
          assert.deepStrictEqual(reread, { open: [c.id, b.id], shown: null });
          // Projects added since leave the tabs as they were.
          yield* store.add("/work/d");
          assert.deepStrictEqual((yield* store.tabs).open, [c.id, b.id]);
        })
      )
  );

  it.effect(
    "reads a list of before the tabs as its project opened last in the one tab, shown",
    () =>
      inTemp(() =>
        Effect.gen(function* () {
          const store = yield* ProjectStore;
          assert.deepStrictEqual(yield* store.tabs, { open: [], shown: null });
          const a = yield* store.add("/work/a");
          yield* store.add("/work/b");
          yield* store.opened(a.id);
          assert.deepStrictEqual(yield* store.tabs, {
            open: [a.id],
            shown: a.id,
          });
        })
      )
  );

  it.effect(
    "keeps the name and icon a project's server shows, as the list then has them",
    () =>
      inTemp(() =>
        Effect.gen(function* () {
          const store = yield* ProjectStore;
          const shop = yield* store.add("/work/shop");
          const icon = { color: "teal", kind: "icon", name: "server" } as const;
          yield* store.describe(shop.id, { icon, name: "Shop admin" });
          const kept = yield* store.get(shop.id);
          assert.strictEqual(kept.name, "Shop admin");
          assert.deepStrictEqual(kept.icon, icon);
          // Back to the default: no icon of its own.
          yield* store.describe(shop.id, { name: "shop" });
          assert.isUndefined((yield* store.get(shop.id)).icon);
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

describe("ProjectStore's first list (Ultrapaint Dev)", () => {
  /** Two data folders: the release's, which the first start copies from, and this app's own. */
  const inTwo = <A, E>(
    body: (dirs: {
      readonly own: string;
      readonly release: string;
    }) => Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>
  ) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const own = yield* fs.makeTempDirectoryScoped();
      const release = yield* fs.makeTempDirectoryScoped();
      return yield* body({ own, release });
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

  it.effect(
    "starts with the release's projects, local and over SSH, none of them open",
    () =>
      inTwo(({ own, release }) =>
        Effect.gen(function* () {
          const [a, remote] = yield* Effect.gen(function* () {
            const store = yield* ProjectStore;
            const added = yield* store.add("/work/a");
            const ssh = yield* store.addRemote({
              host: "box",
              path: "~/b",
            });
            yield* store.setTabs({ open: [added.id, ssh.id], shown: ssh.id });
            return [added, ssh] as const;
          }).pipe(Effect.provide(ProjectStore.layer(release)));
          const store = yield* Effect.provide(
            ProjectStore,
            ProjectStore.layer(own, { firstFrom: release })
          );
          assert.deepStrictEqual(
            (yield* store.list).map((p) => p.id).sort(),
            [a.id, remote.id].sort()
          );
          assert.deepStrictEqual(yield* store.tabs, { open: [], shown: null });
        })
      )
  );

  it.effect("copies nothing once it has a list of its own", () =>
    inTwo(({ own, release }) =>
      Effect.gen(function* () {
        yield* ProjectStore.use((s) => s.add("/work/mine")).pipe(
          Effect.provide(ProjectStore.layer(own))
        );
        yield* ProjectStore.use((s) => s.add("/work/theirs")).pipe(
          Effect.provide(ProjectStore.layer(release))
        );
        const names = yield* ProjectStore.use((s) => s.list).pipe(
          Effect.provide(ProjectStore.layer(own, { firstFrom: release })),
          Effect.map((projects) => projects.map((p) => p.name))
        );
        assert.deepStrictEqual(names, ["mine"]);
      })
    )
  );

  it.effect("starts empty where the release has no list", () =>
    inTwo(({ own, release }) =>
      Effect.gen(function* () {
        const listed = yield* ProjectStore.use((s) => s.list).pipe(
          Effect.provide(ProjectStore.layer(own, { firstFrom: release }))
        );
        assert.deepStrictEqual(listed, []);
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
