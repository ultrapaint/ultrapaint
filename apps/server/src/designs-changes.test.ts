import path from "node:path";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Fiber, FileSystem, Layer, Ref, Stream } from "effect";
import { TestClock } from "effect/testing";
import { EventBus } from "./events.ts";
import { OpenProject, ProjectManager } from "./project.ts";
import {
  type DesignChange,
  DesignFiles,
  kindOf,
} from "./services/design-files.ts";
import { RepoPaths } from "./services/repo-paths.ts";
import { ProjectFixture, ProjectTest } from "./testing/project.ts";
import { waitFor } from "./testing/wait-for.ts";

describe("a file of the designs", () => {
  it("is classified once, by what it is", () => {
    assert.deepStrictEqual(
      [
        "home.page.json",
        "wireframes/pricing@bold.page.json",
        "wireframes/canvas.json",
        "canvases.json",
        "wireframes/comments.json",
        "components/Banner.component.json",
        "design-system.json",
        "design.tokens.json",
        "DESIGN.md",
        "skills/layout.md",
        "implementation.json",
        "notes.md",
        "node_modules/x/home.page.json",
        "wireframes/design.tokens.json",
      ].map(kindOf),
      [
        "page",
        "page",
        "canvas",
        "canvases",
        "comments",
        "component",
        "designSystem",
        "tokens",
        "notes",
        // The designs hold no skills (ADR 0094).
        null,
        "implementation",
        null,
        null,
        null,
      ]
    );
  });
});

/** The in-memory adapter alone, over a repository of its own whose designs are in `designs/`. */
const toldOnly = Layer.unwrap(
  Effect.map(
    Effect.flatMap(FileSystem.FileSystem, (fs) => fs.makeTempDirectoryScoped()),
    (repo) =>
      DesignFiles.layerTest.pipe(
        Layer.provideMerge(
          Layer.mergeAll(
            RepoPaths.layer({
              designsDir: "designs",
              hostCss: [],
              libraryDirs: [],
              repoPath: repo,
            }),
            EventBus.layer
          )
        )
      )
  )
).pipe(Layer.provideMerge(NodeServices.layer));

describe("the designs' changes", () => {
  it.effect(
    "are told once per content: the watcher's echo of a write the journal told of is no change",
    () =>
      Effect.gen(function* () {
        const designFiles = yield* DesignFiles;
        const events = yield* EventBus;
        const typed = yield* designFiles
          .changes(["component"])
          .pipe(Stream.take(2), Stream.runCollect, Effect.forkScoped);
        const wire = yield* events
          .subscribe("file.changed")
          .pipe(Stream.take(3), Stream.runCollect, Effect.forkScoped);
        yield* Effect.yieldNow;
        const file = "designs/components/Banner.component.json";
        yield* designFiles.report(file, "one");
        yield* designFiles.report(file, "one");
        // A file of no kind the modules own reaches the editors only.
        yield* designFiles.report("src/app.css", "body {}");
        yield* designFiles.report(file, null);
        const changes: readonly DesignChange[] = yield* Fiber.join(typed);
        assert.deepStrictEqual(
          changes.map((c) => [c.kind, c.hash === ""]),
          [
            ["component", false],
            ["component", true],
          ]
        );
        assert.deepStrictEqual(
          (yield* Fiber.join(wire)).map((c) => c.file),
          [file, "src/app.css", file]
        );
      }).pipe(Effect.provide(toldOnly))
  );

  it.effect(
    "of design.tokens.json, told, reach the editor as the design system",
    () =>
      Effect.gen(function* () {
        const { repo } = yield* ProjectFixture;
        const events = yield* EventBus;
        const fs = yield* FileSystem.FileSystem;
        const project = yield* OpenProject;
        const told = yield* events
          .subscribe("designSystem")
          .pipe(Stream.runHead, Effect.forkScoped);
        yield* Effect.yieldNow;
        const text = `${JSON.stringify({ color: { brand: { $type: "color", $value: "#00ff00" } } }, null, 2)}\n`;
        yield* fs.writeFileString(
          path.join(repo, "designs/design.tokens.json"),
          text
        );
        yield* project.use(
          Effect.flatMap(DesignFiles, (files) =>
            files.report("designs/design.tokens.json", text)
          )
        );
        yield* TestClock.adjust("100 millis");
        assert.strictEqual((yield* Fiber.join(told))._tag, "Some");
      }).pipe(Effect.provide(ProjectTest()), Effect.scoped)
  );
});

describe("a change to the designs from outside the editor", () => {
  // real clock: the real watcher, as what is under test is that a file written by hand is seen,
  // which only the file system can say.
  it.live(
    "of design.tokens.json reaches the editor as the design system",
    () =>
      Effect.gen(function* () {
        const { repo } = yield* ProjectFixture;
        const events = yield* EventBus;
        const fs = yield* FileSystem.FileSystem;
        const told = yield* Ref.make(0);
        yield* events.subscribe("designSystem").pipe(
          Stream.runForEach(() => Ref.update(told, (n) => n + 1)),
          Effect.forkScoped
        );
        const file = path.join(repo, "designs/design.tokens.json");
        let written = 0;
        // Written again until the watcher, which starts with the project, has seen one.
        yield* waitFor(
          Effect.gen(function* () {
            written += 1;
            yield* fs.writeFileString(
              file,
              `${JSON.stringify({ color: { brand: { $type: "color", $value: `#00000${written % 10}` } } }, null, 2)}\n`
            );
            return yield* Ref.get(told);
          }),
          (n) => n > 0,
          { every: "200 millis", within: "10 seconds" }
        );
        assert.isAbove(yield* Ref.get(told), 0);
      }).pipe(Effect.provide(ProjectTest({ watch: true })), Effect.scoped),
    15_000
  );

  // real clock: the real watcher, and the real wait for a directory that is not there yet.
  it.live(
    "in a designs directory made after the folder opened is seen once the directory is there",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const events = yield* EventBus;
        // A folder opened for the first time has no designs directory (ADR 0092).
        const folder = yield* fs.realPath(yield* fs.makeTempDirectoryScoped());
        yield* (yield* ProjectManager).adoptDetected(folder);
        assert.isFalse(yield* fs.exists(path.join(folder, "docs")));
        const told = yield* Ref.make(0);
        yield* events.subscribe("designSystem").pipe(
          Stream.runForEach(() => Ref.update(told, (n) => n + 1)),
          Effect.forkScoped
        );
        // An agent's shell makes it, with a file in it before anything watches it.
        yield* fs.makeDirectory(path.join(folder, "docs/designs"), {
          recursive: true,
        });
        yield* fs.writeFileString(
          path.join(folder, "docs/designs/design.tokens.json"),
          `${JSON.stringify({ color: { brand: { $type: "color", $value: "#000001" } } }, null, 2)}\n`
        );
        yield* waitFor(Ref.get(told), (n) => n > 0, {
          every: "100 millis",
          within: "10 seconds",
        });
        assert.isAbove(yield* Ref.get(told), 0);
      }).pipe(
        Effect.provide(ProjectTest({ storage: "saveOnChange", watch: true })),
        Effect.scoped
      ),
    15_000
  );
});
