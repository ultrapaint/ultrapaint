import path from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { childrenOf } from "@ultrapaint/design-document/tree";
import { Effect, FileSystem } from "effect";
import { OpenProject, type ProjectServices } from "./project.ts";
import { DocumentService } from "./services/documents.ts";
import { EditService } from "./services/edit.ts";
import { PagesService } from "./services/pages.ts";
import { ProjectFixture, ProjectTest } from "./testing/project.ts";

/** Runs against the open project. */
const project = <A, E>(effect: Effect.Effect<A, E, ProjectServices>) =>
  Effect.flatMap(OpenProject, (manager) => manager.use(effect));

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

describe("an app component's instance on a page (ADR 0114)", () => {
  const PROMO = `${JSON.stringify({
    name: "Promo",
    origin: "app",
    properties: [
      {
        default: "Sale",
        kind: "text",
        name: "title",
        targets: [{ node: "title" }],
      },
    ],
    slots: [],
    tree: {
      children: [{ id: "title", role: "heading", text: "Sale", type: "text" }],
      id: "root",
      type: "column",
    },
    version: 1,
  })}\n`;
  const PAGE = `${JSON.stringify({
    root: {
      children: [
        { component: "Promo", from: "#app", id: "promo", type: "instance" },
      ],
      id: "page",
      type: "page",
    },
    version: 1,
  })}\n`;

  /** The page with an override of the title made before the title became a property. */
  const PAGE_HELD = `${JSON.stringify({
    root: {
      children: [
        {
          component: "Promo",
          from: "#app",
          id: "promo",
          overrides: { title: { text: "Old" } },
          props: { title: "Spring" },
          type: "instance",
        },
      ],
      id: "page",
      type: "page",
    },
    version: 1,
  })}\n`;

  it.effect(
    "gives back an instance override held from before its field became a property, the property's value kept",
    () =>
      Effect.gen(function* () {
        yield* project(
          Effect.flatMap(DocumentService, (d) =>
            d.apply({
              edits: [
                {
                  doc: "promo.page.json",
                  ops: [
                    {
                      id: "promo/title",
                      op: "update",
                      set: { text: null },
                    },
                  ],
                },
              ],
            })
          )
        );
        const page = yield* project(
          Effect.flatMap(DocumentService, (d) => d.get("promo.page.json"))
        );
        const [promo] = page.root ? childrenOf(page.root) : [];
        assert.deepInclude(promo ?? {}, { props: { title: "Spring" } });
        assert.notProperty(promo ?? {}, "overrides");
      }).pipe(
        Effect.provide(
          ProjectTest({
            files: {
              "designs/components/Promo.component.json": PROMO,
              "designs/promo.page.json": PAGE_HELD,
            },
          })
        ),
        Effect.scoped
      )
  );

  it.effect(
    "sets a layer's field that a property sets as the property, whoever edits it",
    () =>
      Effect.gen(function* () {
        const applied = yield* project(
          Effect.flatMap(DocumentService, (d) =>
            d.apply({
              edits: [
                {
                  doc: "promo.page.json",
                  ops: [
                    {
                      id: "promo/title",
                      op: "update",
                      set: { color: "red", text: "Spring" },
                    },
                  ],
                },
              ],
            })
          )
        );
        const page = yield* project(
          Effect.flatMap(DocumentService, (d) => d.get("promo.page.json"))
        );
        assert.isDefined(applied);
        assert.deepInclude(page.root ? childrenOf(page.root)[0] : {}, {
          overrides: { title: { color: "red" } },
          props: { title: "Spring" },
        });
      }).pipe(
        Effect.provide(
          ProjectTest({
            files: {
              "designs/components/Promo.component.json": PROMO,
              "designs/promo.page.json": PAGE,
            },
          })
        ),
        Effect.scoped
      )
  );
});
