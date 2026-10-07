import { NodeServices } from "@effect/platform-node";
import { assert, describe, it, layer } from "@effect/vitest";
import { Conflict } from "@ultrapaint/contracts/errors";
import { Effect, FileSystem, Layer, Path } from "effect";
import { EventBus } from "./events.ts";
import { EditService, withinLimits } from "./services/edit.ts";
import { RepoPaths } from "./services/repo-paths.ts";
import { TestEnv, TestServer } from "./testing/harness.ts";

layer(TestServer, { excludeTestServices: true, timeout: "60 seconds" })(
  "undo with comments",
  (test) => {
    test.effect(
      "undoes a rename after a comment was added, and the comment stays",
      () =>
        Effect.gen(function* () {
          const { client, settings } = yield* TestEnv;
          yield* client["settings.set"](settings);
          const page = yield* client["pages.create"]({
            canvas: "",
            name: "Notes",
          });
          const pinned = (text: string, on: string) =>
            client["comments.create"]({
              canvas: "",
              element: null,
              nodeId: null,
              page: on,
              text,
              x: 1,
              y: 2,
            });
          const first = yield* pinned("Before the rename", page.id);
          const renamed = yield* client["pages.rename"]({
            id: page.id,
            name: "Memo",
          });
          // A comment is no undo step: it is written outside the history, and must not make
          // the rename's step look changed behind the editor's back.
          const second = yield* pinned("After the rename", renamed.id);

          const undone = yield* client["edit.undo"]();
          assert.strictEqual(undone?.label.startsWith("Rename"), true);
          const pages = yield* client["pages.list"]();
          assert.include(
            pages.pages.map((p) => p.id),
            page.id
          );
          // Both are on the page under the name it has again, the later one too.
          const { comments } = yield* client["comments.list"]({ canvas: "" });
          assert.deepStrictEqual(
            comments.map((c) => [c.id, c.page]),
            [
              [first.id, page.id],
              [second.id, page.id],
            ]
          );

          // One added while the rename is undone goes forward with it.
          yield* pinned("While undone", page.id);

          // And forward again, with every comment on the page's new name.
          yield* client["edit.redo"]();
          const again = yield* client["comments.list"]({ canvas: "" });
          assert.deepStrictEqual(
            again.comments.map((c) => c.page),
            [renamed.id, renamed.id, renamed.id]
          );
        }),
      30_000
    );

    test.effect(
      "fills in the ids a page leaves out without writing over an edit made meanwhile",
      () =>
        Effect.gen(function* () {
          const { client, repo, settings } = yield* TestEnv;
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          yield* client["settings.set"](settings);
          const file = path.join(repo, "designs/handmade.page.json");
          for (let round = 0; round < 10; round += 1) {
            // Written by hand: the paragraph has no id yet.
            yield* fs.writeFileString(
              file,
              JSON.stringify({
                root: {
                  children: [{ role: "paragraph", text: "Old", type: "text" }],
                  id: "root",
                  type: "page",
                },
                version: 1,
              })
            );
            yield* Effect.all(
              [
                client["documents.apply"]({
                  edits: [
                    {
                      doc: "handmade.page.json",
                      ops: [
                        {
                          node: {
                            id: `new_${round}`,
                            role: "paragraph",
                            text: "New",
                            type: "text",
                          },
                          op: "insert",
                          parent: "root",
                        },
                      ],
                    },
                  ],
                }),
                ...Array.from({ length: 4 }, () =>
                  client["documents.get"]({ doc: "handmade.page.json" })
                ),
              ],
              { concurrency: "unbounded" }
            );
            const saved = JSON.parse(yield* fs.readFileString(file));
            const texts = saved.root.children.map(
              (c: { id?: string; text: string }) => [typeof c.id, c.text]
            );
            assert.deepStrictEqual(texts, [
              ["string", "Old"],
              ["string", "New"],
            ]);
          }
          yield* fs.remove(file);
        }),
      30_000
    );
  }
);

describe("the edit journal", () => {
  it.effect(
    "puts back every file it can when an action fails, past one it cannot",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const repo = yield* fs.realPath(yield* fs.makeTempDirectoryScoped());
        const designs = path.join(repo, "designs");
        yield* fs.makeDirectory(path.join(designs, "sub"), {
          recursive: true,
        });
        yield* fs.writeFileString(path.join(designs, "a.json"), "A1");
        yield* fs.writeFileString(path.join(designs, "sub/b.json"), "B1");
        const services = EditService.layer.pipe(
          Layer.provide(
            Layer.mergeAll(
              RepoPaths.layer({
                componentPackages: [],
                designsDir: "designs",
                hostCss: [],
                libraryDirs: [],
                repoPath: repo,
                theme: "light",
              }),
              EventBus.layer
            )
          ),
          Layer.provide(NodeServices.layer)
        );
        const failed = yield* Effect.flatMap(EditService, (edit) =>
          edit.transaction("Two files", (tx) =>
            Effect.gen(function* () {
              yield* tx.write("designs/a.json", "A2");
              yield* tx.write("designs/sub/b.json", "B2");
              // Its directory is gone, and a file stands where it was: b cannot be put back.
              yield* fs.remove(path.join(designs, "sub"), { recursive: true });
              yield* fs.writeFileString(path.join(designs, "sub"), "");
              return yield* new Conflict({ message: "the action failed" });
            })
          )
        ).pipe(Effect.provide(services), Effect.flip);
        assert.strictEqual(failed.message, "the action failed");
        assert.strictEqual(
          yield* fs.readFileString(path.join(designs, "a.json")),
          "A1"
        );
      }).pipe(Effect.provide(NodeServices.layer))
  );
});

describe("the undo journal", () => {
  it("keeps the newest steps that fit, and always the newest", () => {
    const step = (label: string, chars: number) => ({
      changes: [{ after: "x".repeat(chars), before: null, file: "a.json" }],
      label,
    });
    const many = Array.from({ length: 250 }, (_, i) => step(`${i}`, 1));
    const kept = withinLimits(many);
    assert.strictEqual(kept.length, 200);
    assert.strictEqual(kept.at(-1)?.label, "249");
    // Large copies push the old steps out long before two hundred.
    const large = withinLimits([
      step("old", 20 * 1024 * 1024),
      step("older", 1),
      step("new", 20 * 1024 * 1024),
    ]);
    assert.deepStrictEqual(
      large.map((e) => e.label),
      ["older", "new"]
    );
    const huge = withinLimits([step("only", 64 * 1024 * 1024)]);
    assert.deepStrictEqual(
      huge.map((e) => e.label),
      ["only"]
    );
  });
});
