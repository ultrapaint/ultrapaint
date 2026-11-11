import { assert } from "@effect/vitest";
import { Effect, FileSystem, Path } from "effect";
import { eachTest } from "./testing/each-test.ts";
import { TestEnv, TestServer } from "./testing/harness.ts";

const HOME_FILE = "designs/home.page.json";
const ABOUT_FILE = "designs/about.page.json";

/** A page with one heading saying `text`. */
const pageSaying = (text: string) =>
  `${JSON.stringify(
    {
      root: {
        children: [
          { id: "heading", level: 1, role: "heading", text, type: "text" },
        ],
        id: "root",
        padding: 16,
        type: "page",
      },
      version: 1,
    },
    null,
    2
  )}\n`;

// Each keeps, restores and deletes: a server and a state directory of its own.
eachTest(TestServer, {
  realClock: "the snapshots are asked for over the server's socket",
})("named snapshots", (test) => {
  test.effect(
    "keeps, compares, restores and deletes a snapshot, each apart from one of the same files",
    () =>
      Effect.gen(function* () {
        const { client, repo, settings } = yield* TestEnv;
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        yield* client["settings.set"](settings);
        const first = yield* client["snapshots.create"]({
          name: "  First  ",
        });
        const same = yield* client["snapshots.create"]({ name: " " });
        assert.strictEqual(first.name, "First");
        assert.strictEqual(same.name, "Snapshot");
        const ids = (yield* client["snapshots.list"]()).map((s) => s.id);
        assert.includeMembers(ids, [first.id, same.id]);

        yield* fs.writeFileString(
          path.join(repo, HOME_FILE),
          pageSaying("Now")
        );
        yield* fs.writeFileString(
          path.join(repo, ABOUT_FILE),
          pageSaying("About")
        );
        const diffs = yield* client["snapshots.diff"]({ id: first.id });
        assert.deepStrictEqual(
          diffs.map((d) => d.path),
          [ABOUT_FILE, HOME_FILE]
        );

        // Two snapshots of the same files: deleting one leaves the other whole.
        yield* client["snapshots.delete"]({ id: same.id });
        assert.notInclude(
          (yield* client["snapshots.list"]()).map((s) => s.id),
          same.id
        );
        const missing = yield* Effect.flip(
          client["snapshots.view"]({ id: same.id })
        );
        assert.strictEqual(missing._tag, "NotFound");

        yield* client["snapshots.restore"]({ id: first.id });
        assert.strictEqual(
          yield* fs.readFileString(path.join(repo, HOME_FILE)),
          pageSaying("Hello")
        );
        assert.isFalse(yield* fs.exists(path.join(repo, ABOUT_FILE)));
        assert.deepStrictEqual(
          yield* client["snapshots.diff"]({ id: first.id }),
          []
        );

        yield* client["snapshots.delete"]({ id: first.id });
        const gone = yield* Effect.flip(
          client["snapshots.restore"]({ id: first.id })
        );
        assert.strictEqual(gone._tag, "NotFound");
      }),
    30_000
  );

  test.effect(
    "brings a deleted snapshot back with its files, once",
    () =>
      Effect.gen(function* () {
        const { client, repo, settings } = yield* TestEnv;
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        yield* client["settings.set"](settings);
        const kept = yield* client["snapshots.create"]({ name: "Kept" });
        yield* client["snapshots.delete"]({ id: kept.id });
        // Another deleted after it: whatever the store let go of meanwhile, its files stay.
        const other = yield* client["snapshots.create"]({ name: "Other" });
        yield* client["snapshots.delete"]({ id: other.id });
        yield* fs.writeFileString(
          path.join(repo, HOME_FILE),
          pageSaying("Now")
        );

        yield* client["snapshots.undelete"]({ id: kept.id });
        assert.deepStrictEqual(yield* client["snapshots.list"](), [kept]);
        assert.deepStrictEqual(
          (yield* client["snapshots.diff"]({ id: kept.id })).map((d) => d.path),
          [HOME_FILE]
        );

        const twice = yield* Effect.flip(
          client["snapshots.undelete"]({ id: kept.id })
        );
        assert.strictEqual(twice._tag, "NotFound");
      }),
    30_000
  );
});
