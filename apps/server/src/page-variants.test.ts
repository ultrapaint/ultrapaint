/**
 * Page variants from before ADR 0098 folded into variations: a project whose settings are saved
 * folds them as it opens, an unsaved session reads them as variations and folds them with its
 * first change (ADR 0092), and a state's `@name` file is left as it is.
 */
import path from "node:path";
import { assert, it } from "@effect/vitest";
import type { DesignNode } from "@ultrapaint/contracts/document";
import { findNode } from "@ultrapaint/design-document/tree";
import { Effect, FileSystem } from "effect";
import { OpenProject, ProjectManager } from "./project.ts";
import { EditService } from "./services/edit.ts";
import { PagesService } from "./services/pages.ts";
import { VariationsService } from "./services/variations.ts";
import { ProjectFixture, ProjectTest } from "./testing/project.ts";

/** A page whose heading says `words`. */
const pageSaying = (words: string) =>
  `${JSON.stringify(
    {
      root: {
        children: [
          { id: "heading", role: "heading", text: words, type: "text" },
        ],
        id: "root",
        type: "page",
      },
      version: 1,
    },
    null,
    2
  )}\n`;

const frame = (y: number) => ({
  height: 900,
  preset: "desktop",
  width: 1440,
  x: 0,
  y,
});

/** The designs' own canvas, with Home's bold variant listed and framed, and an empty state. */
const CANVAS = `${JSON.stringify({
  frames: {
    "home.page.json": frame(0),
    "home@bold.page.json": frame(1000),
  },
  states: ["empty"],
  variants: ["bold"],
  version: 1,
})}\n`;

const VARIANTS: Record<string, string> = {
  "designs/canvas.json": CANVAS,
  "designs/home@bold.page.json": pageSaying("HELLO"),
  "designs/home@empty.page.json": pageSaying("Nothing here yet"),
};

const textOf = (root: DesignNode | null | undefined, id: string) => {
  const node = findNode(root ?? null, id);
  return node?.type === "text" ? node.text : undefined;
};

/** What the project says now: Home's variations by name, the pages, and the files left. */
const lookAround = Effect.gen(function* () {
  const project = yield* OpenProject;
  const fs = yield* FileSystem.FileSystem;
  const { repo } = yield* ProjectFixture;
  const sets = yield* project.use(
    Effect.flatMap(VariationsService, (v) => v.sets("home.page.json"))
  );
  const { canvases, pages } = yield* project.use(
    Effect.flatMap(PagesService, (p) => p.list)
  );
  const designs = (file: string) => path.join(repo, "designs", file);
  return {
    bold: textOf(
      sets.root?.variations.find((v) => v.id === "bold")?.tree,
      "heading"
    ),
    canvas: JSON.parse(
      yield* fs.readFileString(designs("canvas.json"))
    ) as Record<string, unknown>,
    canvases,
    pages: pages.map((p) => p.id),
    variantFile: yield* fs.exists(designs("home@bold.page.json")),
    variations: sets.root?.variations.map((v) => [v.id, v.name]),
  };
});

it.effect(
  "a project whose settings are saved folds its page variants into variations as it opens, in one undo step",
  () =>
    Effect.gen(function* () {
      const seen = yield* lookAround;
      assert.deepStrictEqual(seen.variations, [
        ["original", "Original"],
        ["bold", "Bold"],
      ]);
      assert.strictEqual(seen.bold, "HELLO");
      assert.isFalse(seen.variantFile);
      // The variant's frame and the list of variants are gone; the state's file stays a page.
      assert.deepStrictEqual(Object.keys(seen.canvas.frames as object), [
        "home.page.json",
      ]);
      assert.notProperty(seen.canvas, "variants");
      assert.deepStrictEqual(seen.pages, [
        "home.page.json",
        "home@empty.page.json",
      ]);
      const undo = yield* Effect.flatMap(OpenProject, (project) =>
        project.use(Effect.flatMap(EditService, (e) => e.state))
      );
      assert.strictEqual(undo.undoLabel, "Fold page variants into variations");
    }).pipe(Effect.provide(ProjectTest({ files: VARIANTS })), Effect.scoped)
);

/** An unsaved session on the variants: a folder detected as an application's, saved on a change. */
const unsaved = ProjectTest({
  files: {
    ...VARIANTS,
    "designs/package.json": `${JSON.stringify({
      dependencies: { react: "^19.0.0" },
      name: "designs",
    })}\n`,
  },
  storage: "saveOnChange",
});

it.effect(
  "an unsaved session reads its page variants as variations, and writes nothing",
  () =>
    Effect.gen(function* () {
      const seen = yield* lookAround;
      assert.deepStrictEqual(seen.variations, [
        ["original", "Original"],
        ["bold", "Bold"],
      ]);
      assert.isTrue(seen.variantFile);
      assert.deepStrictEqual(seen.pages, [
        "home.page.json",
        "home@empty.page.json",
      ]);
    }).pipe(Effect.provide(unsaved), Effect.scoped)
);

it.effect(
  "an unsaved session folds its page variants with the first change that saves its settings",
  () =>
    Effect.gen(function* () {
      const manager = yield* ProjectManager;
      const { repo } = yield* ProjectFixture;
      yield* manager.adoptDetected(repo);
      yield* manager.changed;
      const after = yield* lookAround;
      assert.isFalse(after.variantFile);
      assert.deepStrictEqual(after.variations, [
        ["original", "Original"],
        ["bold", "Bold"],
      ]);
      assert.strictEqual(after.bold, "HELLO");
    }).pipe(Effect.provide(unsaved), Effect.scoped)
);

it.effect(
  "a page variant without its page becomes the page, its drawing the original named after the variant",
  () =>
    Effect.gen(function* () {
      const project = yield* OpenProject;
      const sets = yield* project.use(
        Effect.flatMap(VariationsService, (v) => v.sets("pricing.page.json"))
      );
      const { pages } = yield* project.use(
        Effect.flatMap(PagesService, (p) => p.list)
      );
      assert.include(
        pages.map((p) => p.id),
        "pricing.page.json"
      );
      assert.notInclude(
        pages.map((p) => p.id),
        "pricing@bold.page.json"
      );
      assert.deepStrictEqual(
        sets.root?.variations.map((v) => v.name),
        ["Bold"]
      );
    }).pipe(
      Effect.provide(
        ProjectTest({
          files: { "designs/pricing@bold.page.json": pageSaying("Plans") },
        })
      ),
      Effect.scoped
    )
);

it.effect(
  "a page variant whose page does not read is left as it is, not lost",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { repo } = yield* ProjectFixture;
      const seen = yield* lookAround;
      assert.strictEqual(seen.bold, "HELLO");
      assert.isTrue(
        yield* fs.exists(path.join(repo, "designs/home@torn.page.json"))
      );
      // Its frame stays with it, for the person to find it.
      assert.property(seen.canvas.frames as object, "home@torn.page.json");
    }).pipe(
      Effect.provide(
        ProjectTest({
          files: {
            "designs/canvas.json": `${JSON.stringify({
              frames: {
                "home.page.json": frame(0),
                "home@torn.page.json": frame(2000),
              },
              version: 1,
            })}\n`,
            "designs/home@bold.page.json": pageSaying("HELLO"),
            "designs/home@torn.page.json": "{ half a page",
          },
        })
      ),
      Effect.scoped
    )
);

it.effect(
  "a canvas whose layout does not read has nothing folded: its states are not known",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { repo } = yield* ProjectFixture;
      for (const file of ["home@bold.page.json", "home@empty.page.json"]) {
        assert.isTrue(yield* fs.exists(path.join(repo, "designs", file)));
      }
    }).pipe(
      Effect.provide(
        ProjectTest({
          files: { ...VARIANTS, "designs/canvas.json": "{ torn" },
        })
      ),
      Effect.scoped
    )
);

it.effect(
  "a page variant named as a variation of the page's own may be is folded under an id of its own",
  () =>
    Effect.gen(function* () {
      const seen = yield* lookAround;
      assert.deepStrictEqual(seen.variations, [
        ["original", "Original"],
        ["variant-v2", "V2"],
      ]);
    }).pipe(
      Effect.provide(
        ProjectTest({
          files: { "designs/home@v2.page.json": pageSaying("Two") },
        })
      ),
      Effect.scoped
    )
);

it.effect("the comments on a page variant follow it onto its page", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const { repo } = yield* ProjectFixture;
    const list = JSON.parse(
      yield* fs.readFileString(path.join(repo, "designs/comments.json"))
    ) as { comments: { page: string | null }[] };
    assert.deepStrictEqual(
      list.comments.map((c) => c.page),
      ["home.page.json"]
    );
  }).pipe(
    Effect.provide(
      ProjectTest({
        files: {
          ...VARIANTS,
          "designs/comments.json": `${JSON.stringify({
            comments: [
              {
                author: null,
                createdAt: 1,
                element: null,
                id: "k1",
                page: "home@bold.page.json",
                resolved: false,
                text: "Louder",
                updatedAt: 1,
                x: 10,
                y: 10,
              },
            ],
            version: 1,
          })}\n`,
        },
      })
    ),
    Effect.scoped
  )
);

it.effect(
  "a layout that still lists page variants loses the list though no variant's file is left",
  () =>
    Effect.gen(function* () {
      const seen = yield* lookAround;
      assert.notProperty(seen.canvas, "variants");
    }).pipe(
      Effect.provide(
        ProjectTest({
          files: {
            "designs/canvas.json": `${JSON.stringify({
              frames: { "home.page.json": frame(0) },
              variants: ["bold"],
              version: 1,
            })}\n`,
          },
        })
      ),
      Effect.scoped
    )
);
