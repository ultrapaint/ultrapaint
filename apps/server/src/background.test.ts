import path from "node:path";
import { assert, describe, it as test } from "@effect/vitest";
import { isWholeDocument } from "@ultrapaint/contracts/document";
import { Effect, FileSystem, Stream } from "effect";
import { OpenProject } from "./project.ts";
import { DesignSystemSyncService } from "./services/design-system-sync.ts";
import { FigmaImportService } from "./services/figma-import.ts";
import { nextEvent, TestEnv, TestServer } from "./testing/harness.ts";
import { ProjectFixture, ProjectTest } from "./testing/project.ts";

const PAGE = `${JSON.stringify({
  root: { children: [], id: "root", type: "page" },
  version: 1,
})}\n`;

describe("the server's background work", () => {
  // A server of its own, on a fixture of its own: what it writes is new to it, run after run. The
  // real clock: the watcher of the designs is real I/O, and gives a writer a moment to finish.
  test.live(
    "goes on watching the designs after a file that cannot be read",
    () =>
      Effect.gen(function* () {
        const { client, repo, settings } = yield* TestEnv;
        const fs = yield* FileSystem.FileSystem;
        yield* client["settings.set"](settings);
        const designs = path.join(repo, "designs");
        // A canvas.json and a page that are directories: reading either is an I/O error. The
        // watchers have seen all of it once the list they send has the page.
        const seen = yield* nextEvent(
          client["events.pages"]().pipe(
            Stream.filter((list) =>
              list.pages.some((p) => p.id === "broken/a.page.json")
            )
          ),
          Effect.gen(function* () {
            yield* fs.makeDirectory(path.join(designs, "broken/canvas.json"), {
              recursive: true,
            });
            yield* fs.writeFileString(
              path.join(designs, "broken/a.page.json"),
              PAGE
            );
            yield* fs.makeDirectory(path.join(designs, "odd.page.json"));
          })
        );
        assert.isTrue(seen.event._tag === "Some");

        const listed = yield* client["pages.list"]();
        assert.include(
          listed.pages.map((p) => p.id),
          "broken/a.page.json"
        );

        const { event: pages } = yield* nextEvent(
          client["events.pages"](),
          fs.writeFileString(path.join(designs, "later.page.json"), PAGE)
        );
        assert.include(
          pages._tag === "Some" ? pages.value.pages.map((p) => p.id) : [],
          "later.page.json"
        );

        const { event: document } = yield* nextEvent(
          client["events.document"]().pipe(
            Stream.filter((d) => d.doc === "home.page.json")
          ),
          fs.writeFileString(path.join(designs, "home.page.json"), PAGE)
        );
        // The first state of a page is told whole.
        const told = document._tag === "Some" ? document.value : null;
        assert.deepStrictEqual(
          told && isWholeDocument(told) ? told.root : null,
          { children: [], id: "root", type: "page" }
        );
      }).pipe(Effect.provide(TestServer), Effect.scoped),
    30_000
  );
});

describe("the sync plan", () => {
  test.effect(
    "is worked out again after a package.json that does not read",
    () =>
      Effect.gen(function* () {
        const { reopen, repo } = yield* ProjectFixture;
        const fs = yield* FileSystem.FileSystem;
        const sync = yield* DesignSystemSyncService;
        assert.isFalse((yield* sync.plan).facts.app);
        yield* fs.writeFileString(
          path.join(repo, "designs/package.json"),
          '{ "name": "designs", "dependencies": { "react": "19" } }\n'
        );
        yield* reopen({ libraryDirs: ["ui"] });
        assert.isTrue((yield* sync.plan).facts.app);
      }).pipe(
        Effect.provide(
          ProjectTest({
            files: { "designs/package.json": '{ "name": "designs", ' },
          })
        ),
        Effect.scoped
      )
  );
});

describe("the Figma imports", () => {
  test.effect("are listed when one of them does not read", () =>
    Effect.gen(function* () {
      const project = yield* OpenProject;
      const listed = yield* project.use(
        Effect.flatMap(FigmaImportService, (figma) => figma.list)
      );
      assert.notInclude(
        listed.map((i) => i.id),
        "fig_broken"
      );
      // Nor does it stop the sync, which reads the newest import.
      yield* (yield* DesignSystemSyncService).plan;
    }).pipe(
      Effect.provide(
        ProjectTest({ state: { "imports/fig_broken/import.json": "{ nope" } })
      ),
      Effect.scoped
    )
  );
});
