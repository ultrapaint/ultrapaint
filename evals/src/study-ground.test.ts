import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import {
  type Flat,
  flatten,
  groundOf,
  groundText,
  studyGround,
} from "./study-ground.ts";
import { readData, TestData, writeData } from "./test-data.ts";

const note = (i: number, craft: number, overrides = {}) => ({
  capture: "ok",
  color: { background: "#FFFFFF", theme: i % 4 === 0 ? "dark" : "light" },
  craft,
  domain: "technical",
  expression: "balanced",
  imagery: { kinds: i % 2 === 0 ? ["photography"] : [], treatment: "free" },
  pageKind: "landing",
  sections: [{ kind: "nav" }, { kind: "hero" }],
  type: { faceNames: ["A Face"], sizes: { body: 15 + (i % 3) } },
  words: { eyebrow: i % 5 === 0, voice: `voice ${i}` },
  ...overrides,
});

const flat = (notes: readonly Record<string, unknown>[]) =>
  notes.flatMap((n) => {
    const f = flatten(n);
    return f ? [f] : [];
  });

describe("study ground", () => {
  it("lays a note flat: its system's values and lists, no names, hexes or free text", () => {
    const f = flatten(note(2, 3)) as Flat;
    assert.strictEqual(f.fields.get("type.sizes.body"), 17);
    assert.strictEqual(f.fields.get("color.theme"), "light");
    assert.strictEqual(f.fields.get("sections.count"), 2);
    assert.isFalse(f.fields.has("color.background"));
    assert.isFalse(f.fields.has("imagery.treatment"));
    assert.isFalse([...f.present].some((p) => p.startsWith("type.faceNames")));
    assert.isTrue(f.present.has("imagery.kinds[]=photography"));
    assert.isTrue(f.present.has("sections.has=hero"));
    assert.isUndefined(flatten(note(1, 3, { capture: "broken" })));
  });

  it("counts every page, then each kind with enough pages, the well-made ones beside", () => {
    const pages = flat([
      ...Array.from({ length: 40 }, (_, i) => note(i, i < 20 ? 3 : 2)),
      ...Array.from({ length: 5 }, (_, i) =>
        note(i, 3, { pageKind: "portfolio" })
      ),
    ]);
    const groups = groundOf(pages);
    assert.deepStrictEqual(
      groups.map((g) => g.name),
      [
        "every page",
        "landing",
        "landing · balanced",
        "landing · technical character",
      ]
    );
    const [, landing] = groups;
    assert.strictEqual(landing?.pages, 40);
    assert.strictEqual(landing?.wellMade, 20);
    assert.deepStrictEqual(landing?.fields["type.sizes.body"]?.all, {
      kind: "number",
      median: 16,
      n: 40,
      p25: 15,
      p75: 17,
    });
    const theme = landing?.fields["color.theme"]?.all;
    assert.deepStrictEqual(theme?.kind === "values" && theme.shares, [
      ["light", 0.75],
      ["dark", 0.25],
    ]);
    assert.deepStrictEqual(landing?.present["imagery.kinds[]=photography"], {
      all: 0.5,
      wellMade: 0.5,
    });
    // Free text comes in as many values as pages: left out.
    assert.isUndefined(landing?.fields["words.voice"]);
    const text = groundText(groups);
    assert.include(
      text,
      "| color.theme | light 75%, dark 25% | light 75%, dark 25% |"
    );
    assert.include(text, "| words.eyebrow | yes 20% | yes 20% |");
  });

  it("keeps a list's value common in one group however rare across every page, and no hex in a list", () => {
    const pages = flat([
      ...Array.from({ length: 2000 }, (_, i) => note(i, 2)),
      ...Array.from({ length: 30 }, (_, i) =>
        note(i, 3, {
          imagery: { kinds: ["illustration", "#FF0000"] },
          pageKind: "portfolio",
        })
      ),
    ]);
    const groups = groundOf(pages);
    const portfolio = groups.find((g) => g.name === "portfolio");
    assert.deepStrictEqual(portfolio?.present["imagery.kinds[]=illustration"], {
      all: 1,
      wellMade: 1,
    });
    // Across every page it is rare: 30 of 2,030.
    assert.strictEqual(
      groups[0]?.present["imagery.kinds[]=illustration"]?.all,
      0.01
    );
    assert.isFalse(
      groups.some((g) => Object.keys(g.present).some((f) => f.includes("#")))
    );
  });

  it.effect("writes ground.md and ground.json beside the notes", () =>
    Effect.gen(function* () {
      yield* writeData(
        Object.fromEntries(
          Array.from({ length: 30 }, (_, i) => [
            `studies/opus-questions-5/notes/landing__p${i}.json`,
            JSON.stringify(note(i, 3)),
          ])
        )
      );
      yield* studyGround({ model: "opus" });
      const text = yield* readData("studies/opus-questions-5/ground.md");
      assert.include(text, "## landing\n\n30 pages, 30 well made.");
      assert.include(
        yield* readData("studies/opus-questions-5/ground.json"),
        '"name": "every page"'
      );
    }).pipe(Effect.provide(TestData))
  );
});
