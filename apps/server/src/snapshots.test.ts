import { assert, layer } from "@effect/vitest";
import { Effect, FileSystem, Path } from "effect";
import { makeTestServer, TestEnv } from "./testing/harness.ts";

const HOME = "home.page.json";
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

const HEADING_RE = /"text":"([^"]*)"/;

/** The text of the page's heading, as a document the server read has it. */
const headingOf = (root: unknown) =>
  JSON.stringify(root).match(HEADING_RE)?.[1];

/** Where snapshots were kept before the snapshot store, in the `--home` arrangement. */
const OLD_DIR = "snapshots";

/**
 * A server whose state directory has snapshots in the old format: one per JSON file, with the
 * text of every design file. One was taken in the fixture repository, one says nothing of where
 * it was taken, one was taken in another repository, and one does not read.
 */
const WithOldSnapshots = makeTestServer(({ home, repo }) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const dir = `${home}/${OLD_DIR}`;
    yield* fs.makeDirectory(dir, { recursive: true });
    const old = (
      id: string,
      name: string,
      at: number,
      text: string,
      where: { readonly repo?: string }
    ) =>
      fs.writeFileString(
        `${dir}/${id}.json`,
        JSON.stringify({
          files: {
            "designs/package.json": '{ "name": "designs" }\n',
            [HOME_FILE]: pageSaying(text),
          },
          ...where,
          snapshot: { at, files: 2, id, name },
        })
      );
    yield* old("sn_old_00001", "Shown to the client", 1000, "Before", {
      repo,
    });
    yield* old("sn_old_00002", "Kept long ago", 500, "Long ago", {});
    yield* old("sn_old_00003", "Elsewhere", 2000, "Elsewhere", {
      repo: `${repo}-other`,
    });
    yield* fs.writeFileString(`${dir}/sn_old_00004.json`, "{ not json");
    return { home, mode: "managed" };
  })
);

layer(WithOldSnapshots, { excludeTestServices: true, timeout: "60 seconds" })(
  "named snapshots",
  (test) => {
    test.effect(
      "moves the old format's snapshots into the store, keeping their names, ids and dates",
      () =>
        Effect.gen(function* () {
          const { client, home, settings } = yield* TestEnv;
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          yield* client["settings.set"](settings);

          // Newest first; the other repository's is not shown here.
          assert.deepStrictEqual(yield* client["snapshots.list"](), [
            {
              at: 1000,
              files: 2,
              id: "sn_old_00001",
              name: "Shown to the client",
            },
            { at: 500, files: 2, id: "sn_old_00002", name: "Kept long ago" },
          ]);
          const dir = path.join(home, OLD_DIR);
          // Each file moved is gone; the one that does not read stays, for someone to look at.
          assert.deepStrictEqual(yield* fs.readDirectory(dir), [
            "sn_old_00004.json",
          ]);
          for (const id of ["sn_old_00001", "sn_old_00002", "sn_old_00003"]) {
            assert.isTrue(
              yield* fs.exists(path.join(home, "store", "refs", "designs", id))
            );
          }

          const view = yield* client["snapshots.view"]({ id: "sn_old_00001" });
          assert.strictEqual(view.snapshot.name, "Shown to the client");
          assert.strictEqual(
            headingOf(view.documents.find((d) => d.doc === HOME)?.root),
            "Before"
          );
          const diffs = yield* client["snapshots.diff"]({ id: "sn_old_00001" });
          assert.deepStrictEqual(
            diffs.map((d) => d.path),
            [HOME_FILE]
          );
          assert.include(diffs[0]?.diff ?? "", "Before");

          yield* client["snapshots.restore"]({ id: "sn_old_00002" });
          const restored = yield* client["documents.get"]({ doc: HOME });
          assert.strictEqual(headingOf(restored.root), "Long ago");
          yield* client["edit.undo"]();
          const undone = yield* client["documents.get"]({ doc: HOME });
          assert.strictEqual(headingOf(undone.root), "Hello");
        })
    );

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
        })
    );
  }
);
