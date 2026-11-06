import path from "node:path";
import { assert, describe, it } from "@effect/vitest";
import type { LoggedFinding } from "@ultrapaint/contracts/review";
import { Effect, FileSystem, Layer } from "effect";
import { EvalsConfig } from "./config.ts";
import { writeText } from "./layout.ts";
import { type Asked, Models } from "./models.ts";
import { TestData, writeData } from "./test-data.ts";
import {
  applyTriage,
  type Checked,
  evidenceOf,
  gapFile,
  groupsFrom,
  nextIds,
  parseLog,
  recurs,
  triage,
  verdictOf,
  withEvidence,
} from "./triage.ts";

const finding = (
  page: string,
  reviewer: string,
  over: Partial<LoggedFinding> = {}
): LoggedFinding => ({
  agreedBy: [],
  at: "2026-11-06T10:00:00.000Z",
  category: "spacing",
  designer: { did: "fixed" },
  fix: "Widen the gap between groups.",
  page,
  problem: "The gap between groups equals the gap within one.",
  project: "bike-shop",
  reviewer,
  round: 1,
  rule: "",
  section: "Settings list",
  severity: "major",
  skill: "abc123",
  title: "Groups as close as their rows",
  where: "the list",
  ...over,
});

const check = (over: Partial<Checked> = {}): Checked => ({
  gap: "",
  general: true,
  happened: "Groups sat as close as their rows.",
  kind: "missing",
  proposed: "The gap between groups is three times the gap within one.",
  real: true,
  rule: "",
  skill: ["references/spacing.md"],
  test: "Count lists whose groups are under three times apart.",
  title: "Groups as close as their rows",
  ...over,
});

describe("the findings log, read for triage", () => {
  it("reads a finding a line, and counts the lines that are none", () => {
    const line = JSON.stringify(finding("designs/a.page.json", "opus"));
    const read = parseLog(`${line}\nnot json\n\n${line}\n`);
    assert.strictEqual(read.findings.length, 2);
    assert.strictEqual(read.unreadable, 1);
  });

  it("counts a problem's designs, projects and models, the agreeing ones included", () => {
    const evidence = evidenceOf([
      finding("designs/a.page.json", "opus", { agreedBy: ["gpt-6.1-sol"] }),
      finding("designs/b.page.json", "opus", {
        designer: { did: "declined", reason: "the brief says so" },
      }),
    ]);
    assert.deepStrictEqual(evidence, {
      declined: 1,
      designs: [
        "bike-shop › designs/a.page.json",
        "bike-shop › designs/b.page.json",
      ],
      fixed: 1,
      models: ["gpt-6.1-sol", "opus"],
      projects: ["bike-shop"],
    });
  });

  it("recurs in enough designs or models, unless its designers mostly declined it", () => {
    const at = { minDesigns: 2, minModels: 2 };
    const one = finding("designs/a.page.json", "opus");
    assert.isFalse(recurs(evidenceOf([one]), at));
    assert.isTrue(
      recurs(evidenceOf([one, finding("designs/b.page.json", "opus")]), at)
    );
    assert.isTrue(
      recurs(evidenceOf([{ ...one, agreedBy: ["gpt-6.1-sol"] }]), at)
    );
    const declined = { did: "declined" as const, reason: "on purpose" };
    assert.isFalse(
      recurs(
        evidenceOf([
          { ...one, designer: declined },
          finding("designs/b.page.json", "opus", { designer: declined }),
        ]),
        at
      )
    );
  });

  it("keeps each finding in one group, a number given twice in its first and one left out alone", () => {
    const findings = [
      finding("designs/a.page.json", "opus"),
      finding("designs/b.page.json", "opus"),
      finding("designs/c.page.json", "opus", { title: "Hint says nothing" }),
    ];
    const groups = groupsFrom(findings, {
      groups: [
        { members: [0, 1], title: "Groups as close as rows" },
        { members: [1, 7], title: "Again" },
      ],
    });
    assert.deepStrictEqual(
      groups.map((g) => [g.title, g.findings.length]),
      [
        ["Groups as close as rows", 2],
        ["Hint says nothing", 1],
      ]
    );
  });
});

describe("what becomes of a checked problem", () => {
  const known = new Set(["g02"]);

  it("is a new gap when every model finds it real and general", () => {
    assert.deepStrictEqual(
      verdictOf({ checks: { "gpt-6.1-sol": check(), opus: check() } }, known),
      { check: check(), kind: "new" }
    );
  });

  it("is evidence for a gap there is that a model names, and nothing when a model is against", () => {
    assert.deepStrictEqual(
      verdictOf({ checks: { opus: check({ gap: "g02" }) } }, known),
      { gap: "g02", kind: "evidence" }
    );
    // A gap that is not there names nothing.
    assert.strictEqual(
      verdictOf({ checks: { opus: check({ gap: "g99" }) } }, known).kind,
      "new"
    );
    assert.strictEqual(
      verdictOf(
        { checks: { "gpt-6.1-sol": check({ general: false }), opus: check() } },
        known
      ).kind,
      "none"
    );
  });

  it("takes the next id of its kind: g for what designs show, p for how the skill is run", () => {
    const next = nextIds([{ id: "g51" }, { id: "p10" }, { id: "g09" }]);
    assert.strictEqual(next("missing"), "g52");
    assert.strictEqual(next("missed"), "g53");
    assert.strictEqual(next("process"), "p11");
  });

  it("is written as a gap the lab reads, and evidence under a gap's Result", () => {
    const findings = [
      finding("designs/a.page.json", "opus"),
      finding("designs/b.page.json", "gpt-6.1-sol"),
    ];
    const text = gapFile({
      check: check(),
      evidence: evidenceOf(findings),
      findings,
      found: "2026-11-06",
      id: "g52",
      run: "nov",
    });
    assert.include(
      text,
      "id: g52\ntitle: Groups as close as their rows\nkind: missing\nstatus: open"
    );
    assert.include(text, "skill: [references/spacing.md]");
    assert.include(text, "**Proposed.** The gap between groups");
    assert.isTrue(text.endsWith("**Result.**\n"));
    assert.strictEqual(
      withEvidence(
        "**Result.**\n\n- `recall`: caught\n",
        "- `triage nov`: seen again"
      ),
      "**Result.**\n\n- `recall`: caught\n- `triage nov`: seen again\n"
    );
  });
});

describe("a triage run", () => {
  /** Models that group every finding of a category as one problem and find it real and new. */
  const scripted = (asked: Asked) =>
    asked.prompt.includes("Group the findings")
      ? { groups: [{ members: [0, 1], title: "Groups as close as rows" }] }
      : check();

  it.effect(
    "drafts a recurring problem as a gap to keep, and writes it once the person keeps it",
    () =>
      Effect.gen(function* () {
        const { data, findings: logDir, gaps } = yield* EvalsConfig;
        const fs = yield* FileSystem.FileSystem;
        yield* writeText(
          path.join(gaps, "g51-colours.md"),
          "---\nid: g51\ntitle: Colours\nkind: missing\nstatus: open\nfound: 2026-11-06\nsource: a test\nskill: [references/color.md]\nsections: []\n---\n\n**Result.**\n"
        );
        yield* writeText(
          path.join(logDir, "bike-shop.jsonl"),
          `${[
            finding("designs/a.page.json", "opus"),
            finding("designs/b.page.json", "gpt-6.1-sol"),
          ]
            .map((f) => JSON.stringify(f))
            .join("\n")}\n`
        );
        yield* triage({
          all: false,
          concurrency: 1,
          effort: "high",
          grouper: "gpt-6.1-sol",
          minDesigns: 2,
          minModels: 2,
          models: ["opus", "gpt-6.1-sol"],
          name: "nov",
        });
        const deck = JSON.parse(
          yield* fs.readFileString(
            path.join(data.root, "decisions", "triage-nov.json")
          )
        ) as { cards: { id: string; title: string }[] };
        assert.deepStrictEqual(
          deck.cards.map((c) => c.title),
          ["Groups as close as their rows"]
        );

        yield* writeData({
          "decisions/triage-nov.answers.json": {
            [deck.cards[0]?.id ?? ""]: {
              at: "2026-11-06T12:00:00.000Z",
              choice: "keep",
              label: "Keep as a gap",
              title: "Groups as close as their rows",
            },
          },
        });
        yield* applyTriage("nov");
        const written = yield* fs.readFileString(
          path.join(gaps, "g52-groups-as-close-as-their-rows.md")
        );
        assert.include(written, "id: g52");
        assert.include(
          written,
          "source: findings log, triage nov: 2 findings in 2 designs of bike-shop"
        );

        // The next triage starts after them: nothing is left to read.
        yield* triage({
          all: false,
          concurrency: 1,
          effort: "high",
          grouper: "gpt-6.1-sol",
          minDesigns: 2,
          minModels: 2,
          models: ["opus"],
          name: "dec",
        });
        assert.isFalse(
          yield* fs.exists(
            path.join(data.root, "triage", "dec", "findings.json")
          )
        );
      }).pipe(Effect.provide(Layer.merge(TestData, Models.layerTest(scripted))))
  );
});
