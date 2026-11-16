import { assert, it } from "@effect/vitest";
import type { DesignNode } from "@ultrapaint/contracts/document";
import {
  VARIATIONS_EXTENSION,
  type VariationSet,
} from "@ultrapaint/contracts/variations";
import { findNode } from "@ultrapaint/design-document/tree";
import { Effect, FileSystem, type Layer, type Scope } from "effect";
import { nextEvent, TestEnv } from "./testing/harness.ts";
import { heardOf, inAProject, type ProjectRpc } from "./testing/project.ts";

const HOME = "home.page.json";

/** A test of a thing's variations, as the editor asks for them, on a project of its own. */
const inProject = <A, E>(
  name: string,
  body: () => Effect.Effect<
    A,
    E,
    Layer.Success<ReturnType<typeof ProjectRpc>> | Scope.Scope
  >
) => it.effect(name, () => inAProject()(body()));

/** The set's variations as rows: name, whether it is in use, and the words of a text's tree. */
const rows = (set: VariationSet | undefined) =>
  (set?.variations ?? []).map((v) => [
    v.name,
    v.id === set?.inUse ? "in use" : "",
    v.tree?.type === "text" ? v.tree.text : null,
  ]);

const textOf = (root: DesignNode | null, id: string) => {
  const node = findNode(root, id);
  return node?.type === "text" ? node.text : undefined;
};

const childIds = (node: DesignNode | null | undefined) =>
  node && "children" in node ? (node.children ?? []).map((c) => c.id) : [];

inProject(
  "a new variation made by hand copies the one in use and is put in use, as one undo step",
  () =>
    Effect.gen(function* () {
      const { client } = yield* TestEnv;
      const made = yield* client["variations.add"]({
        doc: HOME,
        node: "heading",
      });
      // The original keeps the heading as it was; the new one is the tree in the page.
      assert.deepStrictEqual(rows(made.sets.heading), [
        ["Original", "", "Hello"],
        ["Variation 2", "in use", null],
      ]);
      const page = yield* client["documents.get"]({ doc: HOME });
      assert.strictEqual(textOf(page.root, "heading"), "Hello");

      const undone = yield* client["edit.undo"]();
      assert.strictEqual(undone?.label, "New variation");
      const { documents } = yield* client["variations.list"]({ canvas: "" });
      assert.deepStrictEqual(documents, []);
    })
);

inProject(
  "Use this puts a variation in use as one undo step, and each keeps its own edits",
  () =>
    Effect.gen(function* () {
      const { client } = yield* TestEnv;
      yield* client["variations.add"]({ doc: HOME, node: "heading" });
      const retitle = (text: string) =>
        client["documents.apply"]({
          edits: [
            {
              doc: HOME,
              ops: [{ id: "heading", op: "update", set: { text } }],
            },
          ],
        });
      // The edit lands on Variation 2, the one in use.
      yield* retitle("Hi there");
      const heading = () =>
        Effect.map(client["documents.get"]({ doc: HOME }), (page) =>
          textOf(page.root, "heading")
        );

      const back = yield* client["variations.use"]({
        doc: HOME,
        node: "heading",
        variation: "original",
      });
      assert.strictEqual(yield* heading(), "Hello");
      assert.deepStrictEqual(rows(back.sets.heading), [
        ["Original", "in use", null],
        ["Variation 2", "", "Hi there"],
      ]);

      yield* client["variations.use"]({
        doc: HOME,
        node: "heading",
        variation: "v2",
      });
      assert.strictEqual(yield* heading(), "Hi there");

      // Undone, the original is in use again, its file and its page as they were.
      const undone = yield* client["edit.undo"]();
      assert.strictEqual(undone?.label, "Use a variation");
      assert.strictEqual(yield* heading(), "Hello");
      const { documents } = yield* client["variations.list"]({ canvas: "" });
      assert.deepStrictEqual(rows(documents[0]?.sets.heading), [
        ["Original", "in use", null],
        ["Variation 2", "", "Hi there"],
      ]);
    })
);

inProject(
  "a page's variation in use is its whole page, its node ids kept",
  () =>
    Effect.gen(function* () {
      const { client } = yield* TestEnv;
      yield* client["variations.add"]({ doc: HOME, node: "root" });
      yield* client["documents.apply"]({
        edits: [
          {
            doc: HOME,
            ops: [
              { id: "root", op: "update", set: { padding: 48 } },
              {
                node: {
                  id: "lede",
                  role: "paragraph",
                  text: "A calmer page",
                  type: "text",
                },
                op: "insert",
                parent: "root",
              },
            ],
          },
        ],
      });

      yield* client["variations.use"]({
        doc: HOME,
        node: "root",
        variation: "original",
      });
      const original = (yield* client["documents.get"]({ doc: HOME })).root;
      assert.deepStrictEqual(
        [original?.type === "page" && original.padding, childIds(original)],
        [16, ["heading"]]
      );

      yield* client["variations.use"]({
        doc: HOME,
        node: "root",
        variation: "v2",
      });
      const calmer = (yield* client["documents.get"]({ doc: HOME })).root;
      assert.deepStrictEqual(
        [calmer?.type === "page" && calmer.padding, childIds(calmer)],
        [48, ["heading", "lede"]]
      );
    })
);

inProject(
  "a variation is renamed or deleted, the original stays, and a set is cleared",
  () =>
    Effect.gen(function* () {
      const { client } = yield* TestEnv;
      const heading = { doc: HOME, node: "heading" };
      yield* client["variations.add"](heading);
      yield* client["variations.add"](heading);
      const renamed = yield* client["variations.rename"]({
        ...heading,
        name: "Bold",
        variation: "v2",
      });
      assert.deepStrictEqual(
        renamed.sets.heading?.variations.map((v) => v.name),
        ["Original", "Bold", "Variation 3"]
      );

      const refused = yield* Effect.flip(
        client["variations.remove"]({ ...heading, variation: "original" })
      );
      assert.strictEqual(refused._tag, "BadRequest");

      // The one in use deleted, the heading stays as it is drawn, and none is in use.
      const left = yield* client["variations.remove"]({
        ...heading,
        variation: "v3",
      });
      assert.deepStrictEqual(rows(left.sets.heading), [
        ["Original", "", "Hello"],
        ["Bold", "", "Hello"],
      ]);

      // Cleared, the heading is as it is drawn now, and no set is left.
      const cleared = yield* client["variations.clear"](heading);
      assert.deepStrictEqual(cleared.sets, {});
      const { documents } = yield* client["variations.list"]({ canvas: "" });
      assert.deepStrictEqual(documents, []);
    })
);

inProject(
  "deleting a thing takes its variations in the same undo step, and undoing brings both back",
  () =>
    Effect.gen(function* () {
      const { client } = yield* TestEnv;
      yield* client["variations.add"]({ doc: HOME, node: "heading" });
      yield* client["documents.apply"]({
        edits: [{ doc: HOME, ops: [{ id: "heading", op: "remove" }] }],
      });
      const gone = yield* client["variations.list"]({ canvas: "" });
      assert.deepStrictEqual(gone.documents, []);

      yield* client["edit.undo"]();
      const back = yield* client["variations.list"]({ canvas: "" });
      assert.deepStrictEqual(rows(back.documents[0]?.sets.heading), [
        ["Original", "", "Hello"],
        ["Variation 2", "in use", null],
      ]);
    })
);

inProject(
  "a part's set is kept while its thing is drawn by a variation not in use",
  () =>
    Effect.gen(function* () {
      const { client } = yield* TestEnv;
      // The page's original holds the heading; the heading has variations of its own.
      yield* client["variations.add"]({ doc: HOME, node: "root" });
      yield* client["documents.apply"]({
        edits: [{ doc: HOME, ops: [{ id: "heading", op: "remove" }] }],
      });
      yield* client["variations.use"]({
        doc: HOME,
        node: "root",
        variation: "original",
      });
      yield* client["variations.add"]({ doc: HOME, node: "heading" });

      // Variation 2 has no heading: put in use, the heading's set waits in the original.
      const page = yield* client["variations.use"]({
        doc: HOME,
        node: "root",
        variation: "v2",
      });
      assert.deepStrictEqual(Object.keys(page.sets).sort(), [
        "heading",
        "root",
      ]);
    })
);

inProject(
  "a page's variations follow it when it is renamed, moved, copied or deleted",
  () =>
    Effect.gen(function* () {
      const { client } = yield* TestEnv;
      yield* client["variations.add"]({ doc: HOME, node: "heading" });
      const docsIn = (canvas: string) =>
        Effect.map(client["variations.list"]({ canvas }), ({ documents }) =>
          documents.map((d) => d.doc)
        );

      const renamed = yield* client["pages.rename"]({ id: HOME, name: "Memo" });
      assert.deepStrictEqual(yield* docsIn(""), [renamed.id]);

      const [copy] = yield* client["pages.copyTo"]({
        ids: [renamed.id],
        move: false,
        target: { name: "Archive" },
      });
      assert.deepStrictEqual(yield* docsIn("archive"), [copy?.id]);

      yield* client["pages.copyTo"]({
        ids: [renamed.id],
        move: true,
        target: { name: "Checkout" },
      });
      assert.deepStrictEqual(yield* docsIn(""), []);
      assert.deepStrictEqual(yield* docsIn("checkout"), [
        "checkout/memo.page.json",
      ]);

      yield* client["pages.delete"]({ ids: ["checkout/memo.page.json"] });
      assert.deepStrictEqual(yield* docsIn("checkout"), []);
      yield* client["edit.undo"]();
      assert.deepStrictEqual(yield* docsIn("checkout"), [
        "checkout/memo.page.json",
      ]);
    })
);

inProject(
  "a node beside the pages keeps its variations in its canvas, a component in its own, each going with it",
  () =>
    Effect.gen(function* () {
      const { client, repo } = yield* TestEnv;
      const canvas = yield* client["canvases.create"]({ name: "Wireframes" });
      const doc = `canvas:${canvas.id}`;
      yield* client["documents.apply"]({
        edits: [
          {
            doc,
            ops: [
              {
                node: {
                  id: "note",
                  role: "paragraph",
                  text: "Loose",
                  type: "text",
                },
                op: "insert",
                parent: null,
              },
            ],
          },
        ],
      });
      yield* client["variations.add"]({ doc, node: "note" });
      yield* client["components.makeApp"]({
        id: HOME,
        name: "Title",
        nodeIds: ["heading"],
      });
      const component = "component:Title";
      const { root } = yield* client["documents.get"]({ doc: component });
      yield* client["variations.add"]({ doc: component, node: root?.id ?? "" });
      const docsIn = (id: string) =>
        Effect.map(client["variations.list"]({ canvas: id }), ({ documents }) =>
          documents.map((d) => d.doc).sort()
        );
      assert.deepStrictEqual(yield* docsIn(canvas.id), [doc, component]);

      yield* client["components.remove"]({ name: "Title" });
      assert.deepStrictEqual(yield* docsIn(canvas.id), [doc]);
      // Deleted with its canvas, they come back with it.
      yield* client["canvases.delete"]({ id: canvas.id });
      const fs = yield* FileSystem.FileSystem;
      assert.isFalse(
        yield* fs.exists(
          `${repo}/designs/${canvas.id}/canvas${VARIATIONS_EXTENSION}`
        )
      );
      yield* client["edit.undo"]();
      assert.deepStrictEqual(yield* docsIn(canvas.id), [doc]);
    })
);

inProject(
  "a teammate's variations, pulled into the folder, are told to the editor",
  () =>
    Effect.gen(function* () {
      const { client, repo } = yield* TestEnv;
      const fs = yield* FileSystem.FileSystem;
      const file = `designs/home${VARIATIONS_EXTENSION}`;
      const theirs = {
        heading: {
          inUse: "original",
          variations: [
            { id: "original", name: "Original" },
            {
              id: "v2",
              name: "Shorter",
              tree: {
                id: "heading",
                level: 1,
                role: "heading",
                text: "Hi",
                type: "text",
              },
            },
          ],
        },
      };
      yield* fs.writeFileString(
        `${repo}/${file}`,
        JSON.stringify({ sets: theirs, version: 1 })
      );
      const { event } = yield* nextEvent(
        client["events.variations"](),
        heardOf(file)
      );
      assert.strictEqual(event._tag, "Some");
      if (event._tag === "Some") {
        assert.deepStrictEqual(
          [event.value.doc, rows(event.value.sets.heading)],
          [
            HOME,
            [
              ["Original", "in use", null],
              ["Shorter", "", "Hi"],
            ],
          ]
        );
      }
    })
);

inProject(
  "a variations file that does not read, a merge left half done, blocks no edit of its page",
  () =>
    Effect.gen(function* () {
      const { client, repo } = yield* TestEnv;
      const fs = yield* FileSystem.FileSystem;
      yield* fs.writeFileString(
        `${repo}/designs/home${VARIATIONS_EXTENSION}`,
        "<<<<<<< HEAD\n{}\n=======\n{}\n>>>>>>> theirs\n"
      );
      yield* client["documents.apply"]({
        edits: [
          {
            doc: HOME,
            ops: [{ id: "heading", op: "update", set: { text: "Hi" } }],
          },
        ],
      });
      const page = yield* client["documents.get"]({ doc: HOME });
      assert.strictEqual(textOf(page.root, "heading"), "Hi");
    })
);

inProject(
  "restoring an earlier point of the history brings back the variation in use then",
  () =>
    Effect.gen(function* () {
      const { client } = yield* TestEnv;
      yield* client["variations.add"]({ doc: HOME, node: "heading" });
      yield* client["documents.apply"]({
        edits: [
          {
            doc: HOME,
            ops: [{ id: "heading", op: "update", set: { text: "Hi" } }],
          },
        ],
      });
      const point = yield* client["history.save"]({ name: "Variation 2" });
      yield* client["variations.use"]({
        doc: HOME,
        node: "heading",
        variation: "original",
      });

      yield* client["history.restore"]({ id: point.id });
      const page = yield* client["documents.get"]({ doc: HOME });
      assert.strictEqual(textOf(page.root, "heading"), "Hi");
      const { documents } = yield* client["variations.list"]({ canvas: "" });
      assert.deepStrictEqual(rows(documents[0]?.sets.heading), [
        ["Original", "", "Hello"],
        ["Variation 2", "in use", null],
      ]);
    })
);

inProject(
  "variations deleted, even the one in use, leave the thing as the one chosen drew it",
  () =>
    Effect.gen(function* () {
      const { client } = yield* TestEnv;
      const heading = { doc: HOME, node: "heading" };
      const retitle = (text: string) =>
        client["documents.apply"]({
          edits: [
            {
              doc: HOME,
              ops: [{ id: "heading", op: "update", set: { text } }],
            },
          ],
        });
      // Three takes, the second chosen.
      for (const text of ["One", "Two", "Three"]) {
        yield* client["variations.add"](heading);
        yield* retitle(text);
      }
      yield* client["variations.use"]({ ...heading, variation: "v3" });
      for (const variation of ["v2", "v3", "v4"]) {
        yield* client["variations.remove"]({ ...heading, variation });
      }
      const page = yield* client["documents.get"]({ doc: HOME });
      assert.strictEqual(textOf(page.root, "heading"), "Two");
      // The original is kept, a take still to go back to; nothing is in use.
      const { documents } = yield* client["variations.list"]({ canvas: "" });
      assert.deepStrictEqual(rows(documents[0]?.sets.heading), [
        ["Original", "", "Hello"],
      ]);

      // Used again, the original is put in, the look chosen not kept: nothing held it.
      yield* client["variations.use"]({ ...heading, variation: "original" });
      const back = yield* client["documents.get"]({ doc: HOME });
      assert.strictEqual(textOf(back.root, "heading"), "Hello");
    })
);

inProject(
  "a thing taken out and put back in one request keeps its variations",
  () =>
    Effect.gen(function* () {
      const { client } = yield* TestEnv;
      yield* client["variations.add"]({ doc: HOME, node: "heading" });
      const heading = {
        id: "heading",
        level: 1,
        role: "heading",
        text: "Hello",
        type: "text",
      } as const;
      yield* client["documents.apply"]({
        edits: [
          { doc: HOME, ops: [{ id: "heading", op: "remove" }] },
          {
            doc: HOME,
            ops: [{ node: heading, op: "insert", parent: "root" }],
          },
        ],
      });
      const { documents } = yield* client["variations.list"]({ canvas: "" });
      assert.deepStrictEqual(Object.keys(documents[0]?.sets ?? {}), [
        "heading",
      ]);
    })
);

inProject(
  "a component's root takes the kind of container its variation drew",
  () =>
    Effect.gen(function* () {
      const { client } = yield* TestEnv;
      yield* client["documents.apply"]({
        edits: [
          {
            doc: HOME,
            ops: [
              {
                node: {
                  id: "lede",
                  role: "paragraph",
                  text: "More",
                  type: "text",
                },
                op: "insert",
                parent: "root",
              },
            ],
          },
        ],
      });
      yield* client["components.makeApp"]({
        id: HOME,
        name: "Intro",
        nodeIds: ["heading", "lede"],
      });
      const doc = "component:Intro";
      const before = (yield* client["documents.get"]({ doc })).root;
      const id = before?.id ?? "";
      yield* client["variations.add"]({ doc, node: id });
      const other = before?.type === "row" ? "column" : "row";
      yield* client["documents.apply"]({
        edits: [{ doc, ops: [{ id, op: "update", set: { type: other } }] }],
      });
      yield* client["variations.use"]({ doc, node: id, variation: "original" });
      const after = (yield* client["documents.get"]({ doc })).root;
      assert.strictEqual(after?.type, before?.type);
    })
);

inProject(
  "a variation whose tree is another node's is refused, and nothing changes",
  () =>
    Effect.gen(function* () {
      const { client, repo } = yield* TestEnv;
      const fs = yield* FileSystem.FileSystem;
      const file = `designs/home${VARIATIONS_EXTENSION}`;
      yield* fs.writeFileString(
        `${repo}/${file}`,
        JSON.stringify({
          sets: {
            heading: {
              inUse: "original",
              variations: [
                { id: "original", name: "Original" },
                {
                  id: "v2",
                  name: "Wrong",
                  tree: { children: [], id: "root", padding: 0, type: "page" },
                },
              ],
            },
          },
          version: 1,
        })
      );
      const refused = yield* Effect.flip(
        client["variations.use"]({
          doc: HOME,
          node: "heading",
          variation: "v2",
        })
      );
      assert.strictEqual(refused._tag, "BadRequest");
      const page = yield* client["documents.get"]({ doc: HOME });
      assert.strictEqual(textOf(page.root, "heading"), "Hello");
    })
);

inProject("a page is never named so its variations would be its canvas's", () =>
  Effect.gen(function* () {
    const { client } = yield* TestEnv;
    const page = yield* client["pages.create"]({ canvas: "", name: "Canvas" });
    assert.notStrictEqual(page.id, "canvas.page.json");
  })
);
