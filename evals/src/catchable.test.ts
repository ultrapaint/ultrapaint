import path from "node:path";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import {
  catchable,
  catchableReport,
  countsOf,
  type Sorted,
  type ToSort,
} from "./catchable.ts";
import { EvalsConfig } from "./config.ts";
import { writeText } from "./layout.ts";
import { type Asked, Models } from "./models.ts";
import { readData, TestData } from "./test-data.ts";

const finding = (id: string, source: string): ToSort => ({
  id,
  source,
  text: `${id} is wrong.`,
  title: `Finding ${id}`,
});

const sorted = (id: string, kind: Sorted["catch"], check = ""): Sorted => ({
  catch: kind,
  check,
  how: `How ${id}.`,
  id,
});

describe("catchable", () => {
  it("counts each kind of catch", () => {
    expect(
      countsOf([sorted("a", "code"), sorted("b", "code"), sorted("c", "eye")])
    ).toEqual({ code: 2, eye: 1, outline: 0 });
  });

  it("reports each source's shares, the checks by how much they'd catch, and what wasn't sorted", () => {
    const findings = [
      finding("g01", "gaps"),
      finding("g02", "gaps"),
      finding("h1", "rated"),
      finding("h2", "rated"),
    ];
    const report = catchableReport(
      "c",
      findings,
      new Map([
        ["g01", sorted("g01", "code", "Target size")],
        ["g02", sorted("g02", "outline")],
        ["h1", sorted("h1", "code", "target size")],
      ]),
      "gpt-6.1-sol"
    );
    expect(report).toContain("| gaps | 2 | 1 (50%) | 1 (50%) | 0 (0%) |");
    expect(report).toContain("| rated | 1 | 1 (100%) | 0 (0%) | 0 (0%) |");
    expect(report).toContain("| target size | 2 |");
    expect(report).toContain("| `h2` Finding h2 | not sorted |  |");
  });

  const ID_RE = /^- `([^`]+)`/gm;

  /** A gap a person saw, as its file. */
  const aGap = Effect.fnUntraced(function* (id: string) {
    const { gaps } = yield* EvalsConfig;
    yield* writeText(
      path.join(gaps, `${id}-a-gap.md`),
      `---\nid: ${id}\ntitle: Gap ${id}\nkind: missing\nstatus: open\nfound: 2026-11-04\nsource: a test\nskill: [SKILL.md]\nsections: []\n---\n\n**What happened.** ${id} went wrong.\n\n**Result.**\n`
    );
  });

  it.effect(
    "keeps a batch while it holds the same findings, and sorts it again once a new finding has moved the others",
    () => {
      const asked: Asked[] = [];
      const options = {
        batch: 1,
        concurrency: 1,
        decks: [],
        effort: "medium",
        model: "gpt-6.1-sol",
        name: "c",
        panels: [],
      };
      return Effect.gen(function* () {
        yield* aGap("g02");
        yield* aGap("g03");
        yield* catchable(options);
        expect(asked.length).toBe(2);
        yield* catchable(options);
        expect(asked.length).toBe(2);

        // A gap listed before them: each batch now holds the finding before the one it sorted.
        yield* aGap("g01");
        yield* catchable(options);
        const report = yield* readData("runs/c/report.md");
        expect(report).toContain("| gaps | 3 | 3 (100%) | 0 (0%) | 0 (0%) |");
        expect(report).not.toContain("not sorted");
      }).pipe(
        Effect.provide(
          Layer.merge(
            TestData,
            Models.layerTest((question) => {
              asked.push(question);
              return {
                items: [...question.prompt.matchAll(ID_RE)].map((m) => ({
                  catch: "code",
                  check: "A check",
                  how: "A program reads it.",
                  id: m[1],
                })),
              };
            })
          )
        )
      );
    }
  );
});
