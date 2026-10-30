import path from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { childrenOf } from "@ultrapaint/design-document/tree";
import { Effect, FileSystem } from "effect";
import { ProjectManager, type ProjectServices } from "./project.ts";
import { DocumentService } from "./services/documents.ts";
import { EditService } from "./services/edit.ts";
import { PagesService } from "./services/pages.ts";
import { ProjectFixture, ProjectTest } from "./testing/project.ts";

/** Runs against the open project. */
const project = <A, E>(effect: Effect.Effect<A, E, ProjectServices>) =>
  Effect.flatMap(ProjectManager, (manager) => manager.use(effect));

/** A canvas.json as a hand writes it: keys in its own order, a list left empty, a node without an id. */
const HAND_WRITTEN = `${JSON.stringify(
  {
    frames: {},
    nodes: [{ role: "paragraph", text: "Note", type: "text", x: 0, y: 0 }],
    variants: [],
    version: 1,
  },
  null,
  2
)}\n`;

describe("a canvas's file", () => {
  it.effect(
    "is written in one format whoever writes it: the ids filled in, then a frame moved",
    () =>
      Effect.gen(function* () {
        const { repo } = yield* ProjectFixture;
        const fs = yield* FileSystem.FileSystem;
        const file = path.join(repo, "designs/canvas.json");
        const canvas = yield* project(
          Effect.flatMap(DocumentService, (d) => d.get("canvas:"))
        );
        const filled = yield* fs.readFileString(file);
        assert.notInclude(filled, '"variants"');
        // Arranging the canvas as it is changes nothing, so nothing is there to undo.
        yield* project(
          Effect.flatMap(PagesService, (p) => p.writeFrames("", {}))
        );
        assert.strictEqual(yield* fs.readFileString(file), filled);
        assert.isFalse(
          (yield* project(Effect.flatMap(EditService, (e) => e.state))).canUndo
        );
        assert.strictEqual(canvas.root ? childrenOf(canvas.root).length : 0, 1);
      }).pipe(
        Effect.provide(
          ProjectTest({ files: { "designs/canvas.json": HAND_WRITTEN } })
        ),
        Effect.scoped
      )
  );
});
