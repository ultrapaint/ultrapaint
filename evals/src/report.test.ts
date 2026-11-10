import path from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Schema } from "effect";
import { EvalsConfig } from "./config.ts";
import { type Asked, Models } from "./models.ts";
import { report } from "./report.ts";
import { judgement, readData, TestData, writeData } from "./test-data.ts";

const ROUND = {
  agent: "claude-code",
  commit: "abc1234",
  host: "blank",
  name: "r",
  references: ["home", "pricing"],
  runs: 2,
  skills: "built-in",
  startedAt: "2026-11-03T10:00:00.000Z",
};

/** A finding of the judge's, at a level and an impact. */
const finding = (title: string, impact = "medium") => ({
  coverage: "not-covered",
  evidence: "desktop-01.jpg",
  generated: "what the run did",
  impact,
  level: "layout",
  reference: "what the reference does",
  rule: "a rule",
  skill: "design",
  title,
  viewport: "desktop",
});

/** A judged run of round `r`, its judgement's findings and anything else it holds. */
const judged = (
  reference: string,
  run: number,
  more: Readonly<Record<string, unknown>>
) => ({
  [`runs/r/${reference}/run-${run}/run.json`]: {},
  [`runs/r/${reference}/run-${run}/judge.json`]: judgement(
    { layout: 3, overall: 3 },
    more
  ),
});

/** A person's verdict on a card of round `r`. */
const verdict = (kind: string, choice: string, comment?: string) => ({
  at: "2026-11-03T11:00:00.000Z",
  choice,
  ...(comment && { comment }),
  kind,
  reference: "home",
  run: "run-1",
  subject: "1",
});

/** A gap as the model answers it, of the findings given. */
const gap = (
  findings: readonly string[],
  index: number,
  more: Readonly<Record<string, unknown>> = {}
) => ({
  findings,
  kind: "missing",
  level: "layout",
  now: "",
  proposal: "Say it.",
  skill: "design",
  summary: "",
  test: "Look for it.",
  title: `gap ${index + 1}`,
  ...more,
});

/** The synthesis the model answers with: a gap per list of findings. */
const synthesis = (gaps: readonly (readonly string[])[]) => ({
  gaps: gaps.map((findings, index) => gap(findings, index)),
  strengths: [],
});

const reported = (gaps: readonly (readonly string[])[] = []) =>
  report("r", { model: "opus" }).pipe(
    Effect.provide(Models.layerTest(() => synthesis(gaps)))
  );

const readJsonData = (file: string) =>
  Effect.flatMap(
    readData(file),
    Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))
  );

describe("report", () => {
  it.effect(
    "leaves out a finding the person rejected, and says of one they confirmed what they said",
    () =>
      Effect.gen(function* () {
        yield* writeData({
          "runs/r/round.json": ROUND,
          "runs/r/skills/design.md": "# Design\n",
          ...judged("home", 1, {
            findings: [finding("rejected"), finding("confirmed")],
          }),
          "runs/r/review.json": {
            "finding/r/home/run-1/1": verdict("finding", "left"),
            "finding/r/home/run-1/2": verdict("finding", "right", "So true"),
          },
        });
        yield* reported();
        const findings = yield* readJsonData("runs/r/findings.json");
        assert.deepStrictEqual(findings, [
          {
            id: "home/run-1#2",
            ...finding("confirmed"),
            person: "confirmed",
            personSaid: "So true",
          },
        ]);
      }).pipe(Effect.provide(TestData))
  );

  it.effect(
    "counts a text as unwanted by the person's word where they gave one, else the judge's",
    () =>
      Effect.gen(function* () {
        const added = (index: number, text: string) => ({
          index,
          node: `n${index}`,
          parent: "root",
          text,
          words: text.split(" ").length,
        });
        yield* writeData({
          "runs/r/round.json": ROUND,
          ...judged("home", 1, {
            addedText: [
              { index: 1, verdict: "noise", why: "" },
              { index: 2, verdict: "needed", why: "" },
              { index: 3, verdict: "invented", why: "" },
              { index: 4, verdict: "invented", why: "" },
            ],
          }),
          "runs/r/home/run-1/added-text.json": [
            added(1, "Overview of things"),
            added(2, "Your plan"),
            added(3, "Acme Inc"),
            added(4, "Jane Doe"),
          ],
          "runs/r/review.json": {
            "text/r/home/run-1/2": verdict("text", "left"),
            "text/r/home/run-1/3": verdict("text", "right"),
          },
        });
        yield* reported();
        assert.deepStrictEqual(
          yield* readJsonData("runs/r/unwanted-text.json"),
          [
            {
              kind: "noise",
              reference: "home",
              run: "run-1",
              text: "Overview of things",
              words: 3,
            },
            {
              kind: "noise",
              reference: "home",
              run: "run-1",
              text: "Your plan",
              words: 2,
            },
            {
              kind: "invented",
              reference: "home",
              run: "run-1",
              text: "Jane Doe",
              words: 2,
            },
          ]
        );
      }).pipe(Effect.provide(TestData))
  );

  it.effect("its cost is the judge's, run by run, and its own", () =>
    Effect.gen(function* () {
      const costing = (run: number, costUsd: number) => ({
        [`runs/r/home/run-${run}/run.json`]: {},
        [`runs/r/home/run-${run}/judge.json`]: {
          ...judgement({ overall: 3 }),
          costUsd,
        },
      });
      yield* writeData({
        "runs/r/round.json": ROUND,
        ...costing(1, 1.25),
        ...costing(2, 0.5),
      });
      yield* reported();
      assert.include(
        yield* readData("runs/r/report.md"),
        "- Judging and this report cost $1.75"
      );
    }).pipe(Effect.provide(TestData))
  );

  it.effect(
    "counts each gap in the runs of each reference, the ones seen most first",
    () =>
      Effect.gen(function* () {
        yield* writeData({
          "runs/r/round.json": ROUND,
          ...judged("home", 1, {
            findings: [finding("a"), finding("b", "high")],
          }),
          ...judged("home", 2, { findings: [finding("a")] }),
          ...judged("pricing", 1, { findings: [finding("b", "high")] }),
        });
        yield* reported([
          ["home/run-1#2"],
          ["home/run-1#2", "pricing/run-1#1"],
          ["home/run-1#1", "home/run-2#1"],
        ]);
        const gaps = yield* Schema.decodeUnknownEffect(
          Schema.Array(
            Schema.Struct({
              byReference: Schema.Array(Schema.Unknown),
              consistent: Schema.Boolean,
              high: Schema.Number,
              runsHit: Schema.Number,
              single: Schema.Boolean,
              title: Schema.String,
            })
          )
        )(yield* readJsonData("runs/r/gaps.json"));
        assert.deepStrictEqual(gaps, [
          {
            byReference: [
              { hit: 1, of: 2, reference: "home" },
              { hit: 1, of: 1, reference: "pricing" },
            ],
            consistent: false,
            high: 2,
            runsHit: 2,
            single: false,
            title: "gap 2",
          },
          {
            byReference: [{ hit: 2, of: 2, reference: "home" }],
            consistent: true,
            high: 0,
            runsHit: 2,
            single: false,
            title: "gap 3",
          },
          {
            byReference: [{ hit: 1, of: 2, reference: "home" }],
            consistent: false,
            high: 1,
            runsHit: 1,
            single: false,
            title: "gap 1",
          },
        ]);
      }).pipe(Effect.provide(TestData))
  );
  it.effect(
    "drafts a gap seen in two runs as a file for evals/gaps, with no id and none of the skill's text, and none for a gap seen once or the tool's",
    () =>
      Effect.gen(function* () {
        const { data } = yield* EvalsConfig;
        const fs = yield* FileSystem.FileSystem;
        yield* writeData({
          "runs/r/round.json": {
            ...ROUND,
            skillTree: {
              dir: "skills/shipped",
              files: { "references/layout.md": "1f", "SKILL.md": "2e" },
            },
          },
          ...judged("home", 1, {
            findings: [finding("a"), finding("b"), finding("c")],
          }),
          ...judged("home", 2, { findings: [finding("a"), finding("c")] }),
        });
        const asked: Asked[] = [];
        yield* report("r", { model: "opus" }).pipe(
          Effect.provide(
            Models.layerTest((question) => {
              asked.push(question);
              return {
                gaps: [
                  gap(["home/run-1#1", "home/run-2#1"], 0, {
                    kind: "ignored",
                    now: '`references/layout.md`: "Use the width."',
                    proposal:
                      "A row in its check table: a column under half the window.",
                    skill: "references/layout.md",
                    summary: "The page sits in a narrow column.",
                    title: "Wasted width",
                  }),
                  gap(["home/run-1#2"], 1),
                  gap(["home/run-1#3", "home/run-2#2"], 2, { kind: "tool" }),
                ],
                strengths: [],
              };
            })
          )
        );

        // The model is sent to the round's tree, from the round's directory.
        assert.include(asked[0]?.prompt, "in `skills/shipped`.");
        assert.deepStrictEqual(
          yield* fs.readDirectory(path.join(data.runs, "r", "proposals")),
          ["01-wasted-width.md"]
        );
        const draft = yield* readData("runs/r/proposals/01-wasted-width.md");
        assert.include(
          draft,
          "---\ntitle: Wasted width\nkind: missed\nstatus: open\nfound: 1970-01-01\nsource: round r, the judge's findings in 2 runs (home 2/2)\nskill: [references/layout.md]\nsections: []\n---\n"
        );
        assert.include(
          draft,
          '**The skill now.** `references/layout.md`: "Use the width."'
        );
        assert.include(
          draft,
          "**Proposed.** A row in its check table: a column under half the window."
        );
        assert.include(draft, "**Test.** Look for it.");
        const text = yield* readData("runs/r/report.md");
        assert.include(
          text,
          "- [Wasted width](proposals/01-wasted-width.md): references/layout.md, 2 runs"
        );
      }).pipe(Effect.provide(TestData))
  );
});
