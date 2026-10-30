import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Path, Ref, Stream } from "effect";
import { readPngText } from "./png-text.ts";
import { ProjectManager, type ProjectServices } from "./project.ts";
import { DocumentService } from "./services/documents.ts";
import { PagePngs } from "./services/page-pngs.ts";
import { PagesService } from "./services/pages.ts";
import { Screenshots } from "./services/screenshots.ts";
import { ProjectFixture, ProjectTest } from "./testing/project.ts";

/** A 1×1 PNG, as an editor would deliver it. */
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

/**
 * An editor open on the project, which draws every picture it is asked for: open once the
 * screenshots count it. Answers with the requests it was asked so far.
 */
const anEditor = Effect.gen(function* () {
  const screenshots = yield* Screenshots;
  const asked = yield* Ref.make(0);
  yield* screenshots.requests.pipe(
    Stream.runForEach((request) =>
      Effect.andThen(
        Ref.update(asked, (n) => n + 1),
        screenshots.deliver({
          dataUrl: `data:image/png;base64,${PNG}`,
          requestId: request.requestId,
        })
      )
    ),
    Effect.forkScoped
  );
  yield* Stream.runHead(Stream.filter(screenshots.editors, (n) => n > 0));
  return asked;
});

const project = <A, E>(effect: Effect.Effect<A, E, ProjectServices>) =>
  Effect.flatMap(ProjectManager, (manager) => manager.use(effect));

describe("page PNGs", () => {
  it.effect("are not drawn while the setting is off, whoever can draw", () =>
    Effect.gen(function* () {
      yield* anEditor;
      const pass = yield* project(Effect.flatMap(PagePngs, (p) => p.refresh));
      assert.deepStrictEqual(pass, { drawn: [], removed: [], stale: [] });
    }).pipe(Effect.provide(ProjectTest()), Effect.scoped)
  );

  it.effect(
    "draw every page beside its file, again only when it changes, and go with the page",
    () =>
      Effect.gen(function* () {
        const { repo } = yield* ProjectFixture;
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const designs = path.join(repo, "designs");
        const keyOf = (file: string) =>
          Effect.map(fs.readFile(path.join(designs, file)), (bytes) =>
            readPngText(bytes, "ultrapaint")
          );
        const refresh = project(Effect.flatMap(PagePngs, (p) => p.refresh));
        // A PNG someone else put here: it carries no key of ours, so it is never removed.
        yield* fs.writeFile(
          path.join(designs, "logo.page.png"),
          new Uint8Array(Buffer.from(PNG, "base64"))
        );
        const asked = yield* anEditor;

        const first = yield* refresh;
        assert.deepStrictEqual(first.drawn, ["designs/home.page.png"]);
        const key = yield* keyOf("home.page.png");
        assert.isNotNull(key);

        // A page added is drawn; the one that did not change is not drawn again.
        const other = yield* project(
          Effect.flatMap(PagesService, (p) =>
            p.create("", { name: "Other" }, "blank")
          )
        );
        const second = yield* refresh;
        assert.deepStrictEqual(second.drawn, ["designs/other.page.png"]);
        assert.strictEqual(yield* keyOf("home.page.png"), key);
        assert.strictEqual(yield* Ref.get(asked), 2);

        // The page changes: it is drawn again, with another key.
        yield* project(
          Effect.flatMap(DocumentService, (d) =>
            d.apply({
              edits: [
                {
                  doc: "home.page.json",
                  ops: [
                    { id: "heading", op: "update", set: { text: "Welcome" } },
                  ],
                },
              ],
            })
          )
        );
        const third = yield* refresh;
        assert.deepStrictEqual(third.drawn, ["designs/home.page.png"]);
        assert.notStrictEqual(yield* keyOf("home.page.png"), key);

        // The page goes: its PNG goes with it, and the one we did not write stays.
        yield* project(Effect.flatMap(PagesService, (p) => p.delete(other.id)));
        const fourth = yield* refresh;
        assert.deepStrictEqual(fourth.removed, ["designs/other.page.png"]);
        assert.isTrue(yield* fs.exists(path.join(designs, "logo.page.png")));
      }).pipe(
        Effect.provide(ProjectTest({ settings: { pagePngs: true } })),
        Effect.scoped
      )
  );
});
