import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Path } from "effect";
import { COLLECT_EVERY, SnapshotStore } from "./services/snapshot-store.ts";
import { Storage } from "./services/storage.ts";

const SNAPSHOT_ID_RE = /^[0-9a-f]{64}$/;

/** The store in a state directory of its own, for a folder of the test's own. */
const withStore = <A, E>(
  body: (dirs: {
    readonly root: string;
    readonly stateDir: string;
  }) => Effect.Effect<A, E, SnapshotStore | FileSystem.FileSystem | Path.Path>
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const root = yield* fs.realPath(yield* fs.makeTempDirectoryScoped());
    const stateDir = yield* fs.realPath(yield* fs.makeTempDirectoryScoped());
    const storage = Layer.succeed(
      Storage,
      Storage.of({
        info: Effect.succeed({ mode: "ephemeral" }),
        promote: () => Effect.void,
        rename: () => Effect.void,
        stateDir: Effect.succeed(stateDir),
        target: Effect.succeed({ mode: "ephemeral" }),
      })
    );
    return yield* body({ root, stateDir }).pipe(
      Effect.provide(SnapshotStore.layer.pipe(Layer.provide(storage)))
    );
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

/** Names of refs no namespace has, to let go of: a release that counts and frees nothing. */
const fillers = (n: number) =>
  Array.from({ length: n }, (_, i) => `filler_${i}`);

/** Every file under a directory, relative to it. */
const filesUnder = (dir: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const names = yield* fs.readDirectory(dir, { recursive: true });
    const files: string[] = [];
    for (const name of names) {
      if ((yield* fs.stat(path.join(dir, name))).type === "File") {
        files.push(name);
      }
    }
    return files.sort();
  });

describe("SnapshotStore", () => {
  it.effect("records files, reads them back and says what changed", () =>
    withStore(({ root }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const store = yield* SnapshotStore;
        const write = (rel: string, text: string) =>
          Effect.andThen(
            fs.makeDirectory(path.dirname(path.join(root, rel)), {
              recursive: true,
            }),
            fs.writeFileString(path.join(root, rel), text)
          );
        yield* write("src/a.ts", "a");
        yield* write("src/b.ts", "b");
        yield* write("designs/home.page.json", "{}");
        const files = ["designs/home.page.json", "src/a.ts", "src/b.ts"];
        const first = yield* store.record("test", root, files);
        assert.match(first, SNAPSHOT_ID_RE);
        const manifest = yield* store.read(first);
        assert.deepStrictEqual(Object.keys(manifest.files), files);
        const a = manifest.files["src/a.ts"] ?? "";
        assert.strictEqual(
          new TextDecoder().decode(yield* store.readFile(a)),
          "a"
        );

        yield* write("src/a.ts", "a changed");
        yield* fs.remove(path.join(root, "src/b.ts"));
        yield* write("src/c.ts", "c");
        const second = yield* store.record("test", root, [
          "designs/home.page.json",
          "src/a.ts",
          "src/b.ts",
          "src/c.ts",
        ]);
        assert.deepStrictEqual(yield* store.changedBetween(first, second), [
          { path: "src/a.ts", status: "M" },
          { path: "src/b.ts", status: "D" },
          { path: "src/c.ts", status: "A" },
        ]);
        assert.deepStrictEqual(yield* store.changedBetween(second, second), []);

        const missing = yield* Effect.flip(store.read("0".repeat(64)));
        assert.strictEqual(missing._tag, "SnapshotMissing");
      })
    )
  );

  it.effect(
    "keeps the same contents once, and the same files as one snapshot",
    () =>
      withStore(({ root, stateDir }) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const store = yield* SnapshotStore;
          yield* fs.writeFileString(path.join(root, "one.txt"), "same");
          yield* fs.writeFileString(path.join(root, "two.txt"), "same");
          const files = ["one.txt", "two.txt"];
          const first = yield* store.record("test", root, files);
          const again = yield* store.record("test", root, files);
          assert.strictEqual(again, first);
          const objects = yield* filesUnder(
            path.join(stateDir, "store/objects")
          );
          assert.lengthOf(objects, 1);
          const manifests = yield* filesUnder(
            path.join(stateDir, "store/manifests")
          );
          assert.deepStrictEqual(manifests, [`${first}.json`]);
        })
      )
  );

  it.effect(
    "puts files back as a snapshot has them, keeping their permissions",
    () =>
      withStore(({ root }) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const store = yield* SnapshotStore;
          const file = (rel: string) => path.join(root, rel);
          yield* fs.writeFileString(file("run.sh"), "echo one\n");
          yield* fs.chmod(file("run.sh"), 0o755);
          yield* fs.writeFileString(file("gone.txt"), "back\n");
          const base = yield* store.record("test", root, [
            "gone.txt",
            "run.sh",
          ]);

          yield* fs.writeFileString(file("run.sh"), "echo two\n");
          yield* fs.remove(file("gone.txt"));
          yield* fs.writeFileString(file("new.txt"), "added\n");
          yield* store.restore(base, root, [
            { action: "restore", path: "run.sh" },
            { action: "restore", path: "gone.txt" },
            { action: "delete", path: "new.txt" },
          ]);
          assert.strictEqual(
            yield* fs.readFileString(file("run.sh")),
            "echo one\n"
          );
          assert.strictEqual(
            (yield* fs.stat(file("run.sh"))).mode % 0o1000,
            0o755
          );
          assert.strictEqual(
            yield* fs.readFileString(file("gone.txt")),
            "back\n"
          );
          assert.isFalse(yield* fs.exists(file("new.txt")));

          const outside = yield* Effect.flip(
            store.restore(base, root, [{ action: "restore", path: "new.txt" }])
          );
          assert.strictEqual(outside._tag, "SnapshotMissing");
        })
      )
  );

  it.effect(
    "removes what no namespace keeps, and only the contents nothing else names",
    () =>
      withStore(({ root, stateDir }) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const store = yield* SnapshotStore;
          yield* fs.writeFileString(path.join(root, "shared.txt"), "shared");
          yield* fs.writeFileString(path.join(root, "only.txt"), "first");
          const first = yield* store.record("one", root, [
            "only.txt",
            "shared.txt",
          ]);
          yield* fs.writeFileString(path.join(root, "only.txt"), "second");
          const second = yield* store.record("two/sub", root, [
            "only.txt",
            "shared.txt",
          ]);
          const objects = path.join(stateDir, "store/objects");
          assert.lengthOf(yield* filesUnder(objects), 3);

          // The first release of a run collects what an earlier one left.
          yield* store.release("one", [first]);
          assert.strictEqual(
            (yield* Effect.flip(store.read(first)))._tag,
            "SnapshotMissing"
          );
          const kept = yield* store.read(second);
          assert.lengthOf(yield* filesUnder(objects), 2);
          for (const hash of Object.values(kept.files)) {
            assert.isTrue((yield* store.readFile(hash)).length > 0);
          }
        })
      )
  );

  it.effect(
    "keeps given contents under names of a namespace's own, let go of apart",
    () =>
      withStore(({ stateDir }) =>
        Effect.gen(function* () {
          const path = yield* Path.Path;
          const store = yield* SnapshotStore;
          const files = {
            "designs/a.txt": "a",
            "designs/home.page.json": "{}",
          };
          const one = yield* store.recordContents("named", files, {
            name: "sn_one",
            note: "first",
          });
          const two = yield* store.recordContents("named", files, {
            name: "sn_two",
            note: "second",
          });
          assert.strictEqual(two, one);
          // An unnamed ref of the same namespace is not one of its names.
          yield* store.recordContents("named", { "b.txt": "b" });
          assert.deepStrictEqual(
            [...(yield* store.named("named"))].sort((a, b) =>
              a.name.localeCompare(b.name)
            ),
            [
              { id: one, name: "sn_one", note: "first" },
              { id: one, name: "sn_two", note: "second" },
            ]
          );
          assert.deepStrictEqual(
            yield* store.changedFrom(one, {
              "designs/a.txt": "a changed",
              "designs/new.txt": new TextEncoder().encode("new"),
            }),
            [
              { path: "designs/a.txt", status: "M" },
              { path: "designs/home.page.json", status: "D" },
              { path: "designs/new.txt", status: "A" },
            ]
          );
          const refused = yield* Effect.flip(
            store.recordContents("named", files, { name: "../out", note: "" })
          );
          assert.strictEqual(refused._tag, "SnapshotStoreFailed");

          yield* store.release("named", ["sn_one"]);
          const kept = yield* store.read(one);
          assert.lengthOf(Object.keys(kept.files), 2);
          yield* store.release("named", ["sn_two"]);
          // Collected with the next ones let go of.
          yield* store.release("named", fillers(COLLECT_EVERY));
          assert.strictEqual(
            (yield* Effect.flip(store.read(one)))._tag,
            "SnapshotMissing"
          );
          assert.lengthOf(
            yield* filesUnder(path.join(stateDir, "store/objects")),
            1
          );
        })
      )
  );

  it.effect(
    "collects once every so many refs let go of, keeping what another ref names",
    () =>
      withStore(({ stateDir }) =>
        Effect.gen(function* () {
          const path = yield* Path.Path;
          const store = yield* SnapshotStore;
          const objects = path.join(stateDir, "store/objects");
          const gone = (id: string) => Effect.isFailure(store.read(id));
          // A snapshot of the designs keeps the content one of the turns had too.
          const kept = yield* store.recordContents(
            "designs",
            { "a.txt": "turn 0" },
            { name: "sn_kept", note: "" }
          );
          const turns: string[] = [];
          for (let i = 0; i <= COLLECT_EVERY; i += 1) {
            turns.push(
              yield* store.recordContents(
                "checkpoints",
                { "a.txt": `turn ${i}`, "b.txt": "shared" },
                { name: `cp_${i}`, note: "" }
              )
            );
          }
          // The first release of a run collects: what an earlier run left is gone.
          yield* store.release("checkpoints", ["cp_0"]);
          assert.isTrue(yield* gone(turns[0] ?? ""));
          assert.lengthOf(yield* filesUnder(objects), COLLECT_EVERY + 2);
          // The next ones are let go of one at a time, and nothing is looked for in between.
          for (let i = 1; i < COLLECT_EVERY; i += 1) {
            yield* store.release("checkpoints", [`cp_${i}`]);
            assert.isFalse(yield* gone(turns[i] ?? ""));
          }
          yield* store.release("checkpoints", [`cp_${COLLECT_EVERY}`]);
          for (const id of turns) {
            assert.isTrue(yield* gone(id));
          }
          // Only the snapshot's content is left, which the turn it shares with did not take.
          const { files } = yield* store.read(kept);
          assert.lengthOf(yield* filesUnder(objects), 1);
          assert.strictEqual(
            new TextDecoder().decode(
              yield* store.readFile(files["a.txt"] ?? "")
            ),
            "turn 0"
          );
        })
      )
  );
});
