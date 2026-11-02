import { assert, describe, it } from "@effect/vitest";
import type { CanvasLayout } from "@ultrapaint/contracts/pages";
import { Context, Effect, Layer } from "effect";
import { CanvasFiles, canvasText } from "./services/canvas-files.ts";

/** The canvas files of a project of the test's own, as each open project builds them. */
const openProject = Effect.map(
  Layer.build(Layer.fresh(CanvasFiles.layer)),
  (context) => Context.get(context, CanvasFiles)
);

/** A canvas's text with one loose note on it, its text `note`. */
const withNote = (note: string) =>
  canvasText({
    frames: {},
    nodes: [
      { id: "t_note", role: "paragraph", text: note, type: "text", x: 0, y: 0 },
    ],
    version: 1,
  } as CanvasLayout);

describe("a project's canvas files", () => {
  it.effect(
    "read the same text of a canvas once, as a layout no caller can change",
    () =>
      Effect.gen(function* () {
        const canvases = yield* openProject;
        const text = withNote("Hello");
        const first = yield* canvases.read("designs/canvas.json", text);
        const again = yield* canvases.read("designs/canvas.json", text);
        assert.strictEqual(again.layout, first.layout);
        assert.isTrue(Object.isFrozen(first.layout));
        assert.isTrue(Object.isFrozen(first.layout.nodes?.[0]));
        assert.throws(() => {
          (first.layout.frames as Record<string, unknown>).home = {};
        });
      }).pipe(Effect.scoped)
  );

  it.effect("are not shared between two projects", () =>
    Effect.gen(function* () {
      const one = yield* openProject;
      const other = yield* openProject;
      const text = withNote("Hello");
      const inOne = yield* one.read("designs/canvas.json", text);
      const inOther = yield* other.read("designs/canvas.json", text);
      assert.notStrictEqual(inOther.layout, inOne.layout);
      assert.deepStrictEqual(inOther.layout, inOne.layout);
    }).pipe(Effect.scoped)
  );

  it.effect(
    "keep one text per canvas, however many versions of it are read",
    () =>
      Effect.gen(function* () {
        const canvases = yield* openProject;
        const other = yield* canvases.read(
          "designs/b/canvas.json",
          withNote("B")
        );
        const first = yield* canvases.read(
          "designs/canvas.json",
          withNote("0")
        );
        for (let n = 1; n <= 40; n += 1) {
          yield* canvases.read("designs/canvas.json", withNote(String(n)));
        }
        // The first version was let go when the next was read: reading it again parses it anew.
        const reread = yield* canvases.read(
          "designs/canvas.json",
          withNote("0")
        );
        assert.notStrictEqual(reread.layout, first.layout);
        assert.deepStrictEqual(reread.layout, first.layout);
        // Another canvas's text is kept beside it.
        const otherAgain = yield* canvases.read(
          "designs/b/canvas.json",
          withNote("B")
        );
        assert.strictEqual(otherAgain.layout, other.layout);
      }).pipe(Effect.scoped)
  );

  it.effect(
    "read what a step wrote as the layout it wrote, and the caller's layout stays its own",
    () =>
      Effect.gen(function* () {
        const canvases = yield* openProject;
        const codec = canvases.codec("designs/canvas.json");
        const nodes = [
          {
            id: "t_note",
            role: "paragraph",
            text: "Hi",
            type: "text",
            x: 0,
            y: 0,
          },
        ];
        const layout = { frames: {}, nodes, version: 1 } as CanvasLayout;
        const text = codec.encode(layout);
        const read = yield* codec.decode(text);
        assert.deepStrictEqual(read, layout);
        assert.isTrue(Object.isFrozen(read));
        assert.isFalse(Object.isFrozen(nodes));
        assert.strictEqual(
          (yield* canvases.read("designs/canvas.json", text)).layout,
          read
        );
      }).pipe(Effect.scoped)
  );
});
