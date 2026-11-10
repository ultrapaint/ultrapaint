import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { Models } from "./models.ts";
import {
  approves,
  coverageOf,
  coverageShare,
  keepText,
  reviewerRounds,
  reviewSections,
  type SectionReview,
} from "./section-review.ts";
import { TestData } from "./test-data.ts";

const finding = (
  category: "spacing" | "states",
  severity: "blocker" | "major" | "minor" | "nit"
) => ({
  category,
  fix: "Fix it.",
  problem: "It breaks a rule.",
  rule: "",
  severity,
  title: "A problem",
  where: "the element",
});

const review = (more: Partial<SectionReview>): SectionReview => ({
  costUsd: 0,
  findings: [],
  reached: [],
  reviewer: "opus",
  seconds: 1,
  section: "Header",
  signOff: { done: true, left: "" },
  systemNotes: [],
  tokens: 0,
  ...more,
});

describe("a section's review", () => {
  it("answers for every concern the section has: findings where it gives some, not reviewed where it gave no row", () => {
    const rows = coverageOf({
      coverage: [
        { category: "hierarchy", note: "", verdict: "passed" },
        { category: "color", note: "no dark picture", verdict: "not reviewed" },
        // It says findings and gives none: looked at, nothing to show.
        { category: "layout", note: "", verdict: "findings" },
        { category: "spacing", note: "", verdict: "passed" },
      ],
      findings: [finding("spacing", "minor")],
      reached: ["states"],
    });
    assert.deepStrictEqual(
      rows.map((r) => `${r.category}: ${r.verdict}`),
      [
        "hierarchy: passed",
        "restraint: not reviewed",
        "layout: passed",
        "spacing: findings",
        "typography: not reviewed",
        "color: not reviewed",
        "states: not reviewed",
      ]
    );
    assert.strictEqual(
      rows.find((r) => r.category === "color")?.note,
      "no dark picture"
    );
    assert.deepStrictEqual(coverageShare([review({ coverage: rows })]), {
      concerns: 7,
      reviewed: 3,
    });
  });

  it("takes approval from the findings: a sign-off over a major of its own is none", () => {
    const signed = { done: true, left: "" };
    assert.isTrue(
      approves({ findings: [finding("spacing", "minor")], signOff: signed })
    );
    assert.isFalse(
      approves({ findings: [finding("spacing", "major")], signOff: signed })
    );
    assert.isFalse(
      approves({ findings: [], signOff: { done: false, left: "The header." } })
    );
    const rounds = reviewerRounds(
      ["opus"],
      [
        review({}),
        review({ findings: [finding("states", "blocker")], section: "List" }),
      ]
    );
    assert.deepStrictEqual(
      Object.values(rounds).map((r) => r.signedOff),
      [false]
    );
  });

  it("tells the designer what the reviews found well made, each once", () => {
    assert.strictEqual(keepText([review({})]), "");
    const text = keepText([
      review({ keep: "The quiet header." }),
      review({ keep: "The quiet header.", reviewer: "gpt-6.1-sol" }),
      review({ keep: "Rows that breathe.", section: "List" }),
    ]);
    assert.include(
      text,
      "- Header: The quiet header.\n- List: Rows that breathe."
    );
    assert.strictEqual(text.split("The quiet header.").length, 2);
  });

  it.effect(
    "gives no review of a picture it can't judge: no findings, no score, no approval",
    () =>
      Effect.gen(function* () {
        const [blank] = yield* reviewSections(
          [
            {
              name: "Header",
              picture: "/tmp/shots/header.png",
              where: "The page's header.",
            },
          ],
          ["opus"],
          {
            concurrency: 1,
            effort: "high",
            judgeModel: "opus",
            tree: "/tmp/skill",
          }
        );
        assert.include(
          blank?.failed ?? "",
          "could not judge the picture: the capture is blank"
        );
        assert.deepStrictEqual(blank?.findings, []);
        assert.deepStrictEqual(
          Object.values(reviewerRounds(["opus"], blank ? [blank] : [])).map(
            (r) => r.signedOff
          ),
          [false]
        );
      }).pipe(
        Effect.provide(
          Layer.merge(
            TestData,
            Models.layerTest(() => ({
              findings: [finding("spacing", "major")],
              picture: { judged: false, why: "the capture is blank" },
              reached: [],
              signOff: { done: true, left: "" },
              systemNotes: [],
            }))
          )
        )
      )
  );
});
