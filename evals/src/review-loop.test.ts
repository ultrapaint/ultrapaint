import path from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { EvalsConfig } from "./config.ts";
import { type Asked, Models } from "./models.ts";
import {
  answersOf,
  goalFrom,
  markerOf,
  type ReviewIO,
  type ReviewOptions,
  type ReviewRecord,
  reviewLoop,
} from "./review-loop.ts";
import type { SectionToReview } from "./section-review.ts";
import type { Turn } from "./session.ts";
import { readData, TestData } from "./test-data.ts";

/** A turn in which the agent said `text` and spent `tokens`. */
const turnSaying = (text: string, tokens = 1000): Turn => ({
  items: [
    { at: 0, attachments: [], id: "u", kind: "user", text: "the prompt" },
    { at: 1, id: "a", kind: "agent", text },
    {
      at: 2,
      changedFiles: [],
      id: "e",
      kind: "turn_end",
      stopReason: "end_turn",
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: tokens },
    },
  ],
  seconds: 10,
});

const DIALOG_NOTE = {
  component: "Dialog",
  note: "Its close button sits 4px off the header's baseline.",
};

const finding = (
  title: string,
  severity: "blocker" | "major" | "minor" | "nit" = "major"
) => ({
  category: "spacing",
  fix: `Fix ${title}.`,
  problem: `${title} breaks a rule.`,
  rule: "references/spacing.md › groups sit apart",
  severity,
  title,
  where: "the element",
});

/** A reviewer's answer: these findings, no other category, signed off only when it found none. */
const answer = (
  findings: readonly ReturnType<typeof finding>[],
  systemNotes: readonly (typeof DIALOG_NOTE)[] = []
) => ({
  findings,
  reached: [],
  signOff:
    findings.length === 0
      ? { done: true, left: "" }
      : { done: false, left: "The spacing first." },
  systemNotes,
});

/**
 * A designer that answers each prompt with the next of `replies`, and a page that is cut into a
 * header and a footer, or pictures a node; `seen` counts the pictures taken, so a script can find
 * less on a later pass.
 */
const scriptedIO = (replies: readonly string[]) => {
  const sent: string[] = [];
  const seen = { nodes: [] as string[], pages: 0 };
  const io: ReviewIO = {
    nodeSection: (node, name, dir) =>
      Effect.sync(() => {
        seen.nodes.push(node);
        return {
          name,
          node,
          picture: path.join(dir, "node.png"),
          where: `Node ${node}.`,
        } satisfies SectionToReview;
      }),
    pageSections: (dir) =>
      Effect.sync(() => {
        seen.pages += 1;
        return ["Header", "Footer"].map((name) => ({
          name,
          picture: path.join(dir, `${name}.jpg`),
          where: `The page's ${name}.`,
        }));
      }),
    request: { brief: "Title: Share this workspace", pictures: [PICTURE] },
    thread: {
      send: (text) =>
        Effect.sync(() => {
          sent.push(text);
          return turnSaying(replies[sent.length - 1] ?? "");
        }),
    },
    tree: "/skill",
  };
  return { io, seen, sent };
};

const PICTURE = "/references/share/desktop-fold.jpg";
const isReview = (asked: Asked) => asked.prompt.startsWith("You review");
const isGrouping = (asked: Asked) =>
  asked.prompt.startsWith("Several reviewers");
const SECTION_NAME = /The section: ([^.]+)\./;
const sectionOf = (asked: Asked) => asked.prompt.match(SECTION_NAME)?.[1];
const LABEL_RE = /^(F\d+)\./gm;
const NEXT_SECTION = /^Go on with the next section/;
const TURN_CAP = /^3 turns and the page is not done/;

/** Every label in one problem, as a grouping model does with findings that are the same. */
const groupedAsOne = (asked: Asked) => ({
  problems: [
    {
      ...finding("Low contrast"),
      findings: [...asked.prompt.matchAll(LABEL_RE)].map((m) => m[1]),
    },
  ],
});

const options = (more: Partial<ReviewOptions>): ReviewOptions => ({
  concurrency: 2,
  effort: "high",
  goal: { maxRounds: 2 },
  judgeModel: "opus",
  mode: "end",
  reviewers: ["opus"],
  ...more,
});

const run = Effect.gen(function* () {
  const { data } = yield* EvalsConfig;
  return path.join(data.root, "run");
});

const readRecord = Effect.map(
  readData("run/review.json"),
  (text) => JSON.parse(text) as ReviewRecord
);

const withModels = (script: (asked: Asked) => unknown) =>
  Effect.provide(Layer.merge(TestData, Models.layerTest(script)));

describe("the review loop", () => {
  it("reads which section a turn built from its last line, past the markdown around it", () => {
    assert.deepStrictEqual(
      markerOf("Built the header.\n\nSection done: c_4 Header"),
      {
        kind: "section",
        name: "Header",
        node: "c_4",
      }
    );
    assert.deepStrictEqual(
      markerOf("**Section done:** `c_12` — Invite list."),
      { kind: "section", name: "Invite list.", node: "c_12" }
    );
    assert.deepStrictEqual(
      markerOf("Section done: c_1 A\n\nAll sections done"),
      {
        kind: "all-done",
      }
    );
    assert.deepStrictEqual(markerOf("I made the page."), { kind: "none" });
  });

  it("reads which findings the designer fixed and which it declined, with its reasons", () => {
    assert.deepStrictEqual(
      answersOf(
        "Changed the colours.\n\n**Fixed:** 1, 3\nDeclined 2: the reference shows it\n- Declined 4 — out of scope"
      ),
      {
        declined: [
          { number: 2, reason: "the reference shows it" },
          { number: 4, reason: "out of scope" },
        ],
        fixed: [1, 3],
      }
    );
    assert.deepStrictEqual(answersOf("Fixed: none"), {
      declined: [],
      fixed: [],
    });
  });

  it.effect(
    "at the end of the turn: merges the reviewers' findings per section, sends them, and stops when a pass finds nothing",
    () => {
      const { io, seen, sent } = scriptedIO([
        "Done.\nFixed: 1\nDeclined 2: the reference has it",
      ]);
      const asked: Asked[] = [];
      return Effect.gen(function* () {
        const { record, turns } = yield* reviewLoop(
          turnSaying("Made the page.", 5000),
          io,
          options({ reviewers: ["opus", "gpt-6.1-sol"] }),
          yield* run
        );
        assert.strictEqual(seen.pages, 2);
        assert.strictEqual(sent.length, 1);
        assert.include(sent[0], "### Header\n\n1. **Low contrast**");
        assert.include(sent[0], "### Footer\n\n2. **Cramped**");
        // What only the system's component would fix is told once, apart, and not numbered.
        assert.include(sent[0], "not yours to fix or answer");
        assert.include(sent[0], `- Footer, **Dialog**: ${DIALOG_NOTE.note}`);
        assert.strictEqual(sent[0]?.split(DIALOG_NOTE.note).length, 2);
        // The reviewers are told what the designer was asked, and shown its picture.
        const reviewed = asked.filter(isReview);
        for (const question of reviewed) {
          assert.include(
            question.prompt,
            "<brief>\nTitle: Share this workspace\n</brief>"
          );
          assert.include(question.prompt, "they decide the look");
          assert.include(question.prompt, "goes in `systemNotes`");
          assert.include(
            question.images ?? [],
            path.relative(question.cwd, PICTURE)
          );
        }
        assert.strictEqual(turns.length, 2);
        // Only the header has two reviewers' findings to group.
        assert.deepStrictEqual(asked.filter(isGrouping).map(sectionOf), [
          "Header",
        ]);
        const [first, second] = record.passes;
        assert.deepStrictEqual(
          first?.merged.map((m) => [m.section, m.title, m.reviewers]),
          [
            ["Header", "Low contrast", ["gpt-6.1-sol", "opus"]],
            ["Footer", "Cramped", ["opus"]],
          ]
        );
        assert.deepStrictEqual(first?.systemNotes, [
          { ...DIALOG_NOTE, reviewer: "opus", section: "Footer" },
        ]);
        assert.deepStrictEqual(first?.answered, {
          declined: [{ number: 2, reason: "the reference has it" }],
          fixed: [1],
        });
        assert.deepStrictEqual(second?.merged, []);
        assert.strictEqual(second?.reply, undefined);
        assert.strictEqual(second?.stopped?.reason, "signed-off");
        // Each reviewer is told with its score and what it has left.
        assert.include(sent[0], "- opus: ");
        assert.include(
          sent[0],
          "not signed off yet. Left: Header: The spacing first."
        );
        assert.deepStrictEqual(yield* readRecord, record);
        assert.deepStrictEqual(record.totals.design, {
          seconds: 10,
          tokens: 5000,
          turns: 1,
        });
        assert.deepStrictEqual(record.totals.answers, {
          seconds: 10,
          tokens: 1000,
          turns: 1,
        });
        assert.deepStrictEqual(record.totals.withoutReview, {
          seconds: 10,
          tokens: 5000,
        });
        assert.strictEqual(record.totals.withReview.tokens, 6000);
      }).pipe(
        withModels((question) => {
          asked.push(question);
          if (isGrouping(question)) {
            return groupedAsOne(question);
          }
          if (seen.pages > 1) {
            return answer([]);
          }
          const section = sectionOf(question);
          if (section === "Header") {
            return answer([finding("Low contrast")]);
          }
          return answer(
            question.model === "opus" ? [finding("Cramped")] : [],
            // Both reviewers note the same thing of the system's dialog: it is told once.
            [DIALOG_NOTE]
          );
        })
      );
    }
  );

  it.effect(
    "stops at the round cap when the reviewers never sign off, keeping its findings unsent",
    () => {
      const { io, seen, sent } = scriptedIO(["Fixed: 1, 2"]);
      return Effect.gen(function* () {
        const { record } = yield* reviewLoop(
          turnSaying("Made the page."),
          io,
          options({ goal: { maxRounds: 2 } }),
          yield* run
        );
        assert.strictEqual(seen.pages, 2);
        assert.strictEqual(sent.length, 1);
        assert.deepStrictEqual(
          record.passes.map((p) => [p.kind, p.pass, p.merged.length]),
          [
            ["page", 1, 2],
            ["page", 2, 2],
          ]
        );
        assert.deepStrictEqual(record.passes[1]?.stopped, {
          best: 2,
          reason: "max-rounds",
          unmet: ["opus hasn't signed off"],
        });
      }).pipe(
        withModels((question) =>
          isReview(question)
            ? answer([finding("Still wrong")])
            : groupedAsOne(question)
        )
      );
    }
  );

  it.effect(
    "stops once every reviewer reaches the goal's score, without sending what is left",
    () => {
      const { io, seen, sent } = scriptedIO(["Fixed: 1, 2"]);
      return Effect.gen(function* () {
        const { record } = yield* reviewLoop(
          turnSaying("Made the page."),
          io,
          options({ goal: { score: 90 } }),
          yield* run
        );
        assert.strictEqual(seen.pages, 2);
        assert.strictEqual(sent.length, 1);
        assert.include(sent[0], "- opus: 60 (goal 90)");
        const [first, second] = record.passes;
        assert.deepStrictEqual(first?.scores.opus?.score, {
          categories: {
            color: 100,
            hierarchy: 100,
            layout: 100,
            restraint: 100,
            spacing: 60,
            typography: 100,
          },
          kind: "scored",
          overall: 60,
        });
        assert.strictEqual(second?.merged.length, 2);
        assert.strictEqual(second?.stopped?.reason, "goal");
      }).pipe(
        withModels((question) => {
          if (!isReview(question)) {
            return groupedAsOne(question);
          }
          // A blocker first, caps each section at 60; a nit after, which the goal lets stand.
          return answer([
            finding("Overlap", seen.pages === 1 ? "blocker" : "nit"),
          ]);
        })
      );
    }
  );

  it.effect(
    "gives a reviewer that fails no score, and goes on with the others",
    () => {
      const { io, sent } = scriptedIO(["Fixed: 1, 2"]);
      return Effect.gen(function* () {
        const { record } = yield* reviewLoop(
          turnSaying("Made the page."),
          io,
          options({ reviewers: ["opus", "gpt-6.1-sol"] }),
          yield* run
        );
        assert.strictEqual(sent.length, 1);
        assert.include(sent[0], "- gpt-6.1-sol: no score (");
        const gpt = record.passes[0]?.scores["gpt-6.1-sol"];
        assert.strictEqual(gpt?.score.kind, "none");
        assert.deepStrictEqual(gpt?.unscored, ["Header", "Footer"]);
        assert.strictEqual(record.passes[0]?.scores.opus?.score.kind, "scored");
        assert.deepStrictEqual(record.problems, []);
      }).pipe(
        withModels((question) => {
          if (!isReview(question)) {
            return groupedAsOne(question);
          }
          // GPT's answer never fits, as when it times out or writes no JSON.
          return question.model === "opus"
            ? answer([finding("Cramped")])
            : { nothing: true };
        })
      );
    }
  );

  it.effect(
    "with the findings log on, appends each finding with what the designer did with it",
    () => {
      const { io, sent } = scriptedIO([
        "Fixed: 1\nDeclined 2: the brief says so",
      ]);
      return Effect.gen(function* () {
        const { data } = yield* EvalsConfig;
        const file = path.join(data.root, "findings", "lab.jsonl");
        yield* reviewLoop(
          turnSaying("Made the page."),
          {
            ...io,
            log: {
              file,
              page: "share-modal",
              project: "lab/smoke",
              skill: "abc1234",
            },
          },
          options({}),
          yield* run
        );
        assert.strictEqual(sent.length, 1);
        const logged = (yield* readData("findings/lab.jsonl"))
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line));
        assert.deepStrictEqual(
          logged.map((f) => [f.round, f.section, f.designer, f.reviewer]),
          [
            [1, "Header", { did: "fixed" }, "opus"],
            [
              1,
              "Footer",
              { did: "declined", reason: "the brief says so" },
              "opus",
            ],
            [2, "Header", { did: "unanswered" }, "opus"],
            [2, "Footer", { did: "unanswered" }, "opus"],
          ]
        );
        assert.deepStrictEqual(
          [
            logged[0]?.project,
            logged[0]?.page,
            logged[0]?.skill,
            logged[0]?.category,
          ],
          ["lab/smoke", "share-modal", "abc1234", "spacing"]
        );
      }).pipe(
        withModels((question) =>
          isReview(question)
            ? answer([finding("Cramped")])
            : groupedAsOne(question)
        )
      );
    }
  );

  it.effect(
    "reads a goal from a round's flags, and refuses one it can't read",
    () =>
      Effect.gen(function* () {
        assert.deepStrictEqual(
          yield* goalFrom({
            floors: "accessibility=80",
            maxRounds: 6,
            reviewerGoals: "gpt-6.1-sol=none, cursor:grok-4.7-high=80",
            score: 90,
          }),
          {
            floors: { accessibility: 80 },
            maxRounds: 6,
            reviewers: { "cursor:grok-4.7-high": 80, "gpt-6.1-sol": null },
            score: 90,
          }
        );
        const wrong = yield* Effect.flip(goalFrom({ floors: "contrast=80" }));
        assert.include(wrong.message, "not <category>=<score>");
      })
  );

  it.effect(
    "section by section: reviews each node the designer names, asks for the next, then reviews the page once",
    () => {
      const { io, seen, sent } = scriptedIO([
        "Fixed: 1",
        "Section done: c_2 Footer",
        "All sections done",
      ]);
      return Effect.gen(function* () {
        const { record, turns } = yield* reviewLoop(
          turnSaying("Built it.\nSection done: c_1 Header"),
          io,
          options({ goal: { maxRounds: 2 }, mode: "each-section" }),
          yield* run
        );
        assert.deepStrictEqual(seen.nodes, ["c_1", "c_1", "c_2"]);
        assert.strictEqual(seen.pages, 1);
        assert.strictEqual(sent.length, 3);
        assert.include(sent[0], "the section you just built, Header");
        assert.match(sent[1] ?? "", NEXT_SECTION);
        assert.match(sent[2] ?? "", NEXT_SECTION);
        assert.strictEqual(turns.length, 4);
        assert.deepStrictEqual(
          record.passes.map((p) => [p.kind, p.node, p.pass, p.merged.length]),
          [
            ["section", "c_1", 1, 1],
            ["section", "c_1", 2, 0],
            ["section", "c_2", 1, 0],
            ["page", undefined, 1, 0],
          ]
        );
        assert.deepStrictEqual(
          [record.totals.design.turns, record.totals.answers.turns],
          [3, 1]
        );
        assert.deepStrictEqual(record.problems, []);
      }).pipe(
        withModels(() =>
          // The first look at the first section finds something, no later one does.
          answer(
            seen.nodes.length === 1 && seen.pages === 0
              ? [finding("Tight header")]
              : []
          )
        )
      );
    }
  );

  it.effect(
    "ends a designer that never says a section is done at the turn cap, and reviews the page as it stands",
    () => {
      const { io, seen, sent } = scriptedIO([
        "Working.",
        "Working.",
        "Working.",
      ]);
      return Effect.gen(function* () {
        const { record, turns } = yield* reviewLoop(
          turnSaying("Working."),
          io,
          options({ maxTurns: 3, mode: "each-section" }),
          yield* run
        );
        assert.strictEqual(turns.length, 3);
        assert.strictEqual(sent.length, 2);
        assert.strictEqual(seen.pages, 1);
        assert.match(record.problems[0] ?? "", TURN_CAP);
      }).pipe(withModels(() => answer([])));
    }
  );
});
