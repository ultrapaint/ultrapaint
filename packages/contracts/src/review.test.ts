import { describe, expect, it } from "vitest";
import {
  type Finding,
  formatReviewModel,
  type Goal,
  levelOf,
  pageScore,
  parseReviewModel,
  type Round,
  reviewersOfRound,
  reviewSettingsOf,
  type Score,
  sectionScore,
  verdictOf,
  withLevel,
} from "./review.ts";

const finding = (
  category: Finding["category"],
  severity: Finding["severity"]
): Finding => ({
  category,
  fix: "Fix it.",
  problem: "It breaks a rule.",
  rule: "",
  severity,
  title: `${severity} in ${category}`,
  where: "the element",
});

const scored = (overall: number): Score => ({
  categories: {},
  kind: "scored",
  overall,
});
const none: Score = { kind: "none", reason: "timed out" };

/** A round where each reviewer has the score given, signed off when `signed` names it. */
const round = (
  scores: Record<string, Score>,
  signed: readonly string[] = [],
  costUsd = 0
): Round => ({
  costUsd,
  reviewers: Object.fromEntries(
    Object.entries(scores).map(([name, score]) => [
      name,
      { score, signedOff: signed.includes(name) },
    ])
  ),
});

describe("sectionScore", () => {
  it("scores a section with no findings 100 on the categories every screen has", () => {
    const score = sectionScore([], []);
    expect(score.overall).toBe(100);
    expect(Object.keys(score.categories).sort()).toEqual(
      [
        "color",
        "hierarchy",
        "layout",
        "restraint",
        "spacing",
        "typography",
      ].sort()
    );
  });

  it("takes each finding's cost off its category, never below 0", () => {
    const score = sectionScore(
      [
        finding("spacing", "major"),
        finding("spacing", "minor"),
        finding("states", "blocker"),
        finding("states", "blocker"),
        finding("states", "blocker"),
      ],
      []
    );
    expect(score.categories.spacing).toBe(80);
    expect(score.categories.states).toBe(0);
  });

  it("scores a category the section has only when the reviewer says it has it", () => {
    expect(sectionScore([], ["motion"]).categories.motion).toBe(100);
    expect(sectionScore([], []).categories.motion).toBeUndefined();
  });

  it("caps a section with a blocker at 60", () => {
    expect(
      sectionScore([finding("accessibility", "blocker")], []).overall
    ).toBe(60);
  });
});

describe("pageScore", () => {
  it("averages the sections, each category over the sections scored on it", () => {
    const page = pageScore([
      {
        name: "header",
        score: sectionScore([finding("spacing", "major")], []),
      },
      { name: "footer", score: sectionScore([], ["motion"]) },
    ]);
    expect(page.kind).toBe("scored");
    if (page.kind === "scored") {
      expect(page.categories.spacing).toBe(93);
      expect(page.categories.motion).toBe(100);
    }
  });

  it("leaves out and names a section given no review", () => {
    const page = pageScore([
      { name: "header", score: sectionScore([], []) },
      { name: "footer", score: none },
    ]);
    expect(page.kind === "scored" && page.overall).toBe(100);
    expect(page.unscored).toEqual(["footer"]);
  });

  it("has no score when no section was reviewed", () => {
    const page = pageScore([{ name: "header", score: none }]);
    expect(page).toMatchObject({ kind: "none", reason: "timed out" });
  });
});

describe("verdictOf", () => {
  it("goes on until every reviewer reaches the goal's score", () => {
    const goal: Goal = { score: 90 };
    expect(
      verdictOf(goal, [round({ gpt: scored(94), opus: scored(85) })])
    ).toEqual({ stop: false, unmet: ["opus 85 < 90"] });
    expect(
      verdictOf(goal, [
        round({ gpt: scored(94), opus: scored(85) }),
        round({ gpt: scored(95), opus: scored(91) }),
      ])
    ).toMatchObject({ best: 1, reason: "goal", stop: true });
  });

  it("holds a reviewer to its own target, and not at all when it only advises", () => {
    const goal: Goal = { reviewers: { gpt: null, grok: 80 }, score: 90 };
    expect(
      verdictOf(goal, [
        round({ gpt: scored(40), grok: scored(82), opus: scored(90) }),
      ])
    ).toMatchObject({ reason: "goal", stop: true });
  });

  it("with no score asked, stops when every reviewer signs off", () => {
    expect(
      verdictOf({}, [round({ grok: scored(70), opus: scored(99) }, ["opus"])])
    ).toEqual({ stop: false, unmet: ["grok hasn't signed off"] });
    expect(
      verdictOf({}, [
        round({ grok: scored(88), opus: scored(99) }, ["grok", "opus"]),
      ])
    ).toMatchObject({ reason: "signed-off", stop: true });
  });

  it("holds every reviewer to the floors", () => {
    const low: Score = {
      categories: { accessibility: 70 },
      kind: "scored",
      overall: 95,
    };
    expect(
      verdictOf({ floors: { accessibility: 80 }, score: 90 }, [
        round({ opus: low }),
      ])
    ).toEqual({ stop: false, unmet: ["opus: accessibility 70 < 80"] });
  });

  it("doesn't count a reviewer with no score, and says so in the round", () => {
    expect(
      verdictOf({ score: 90 }, [round({ gpt: none, opus: scored(92) })])
    ).toMatchObject({ reason: "goal", stop: true });
  });

  it("stops rather than guess when no reviewer the goal holds to has a score", () => {
    expect(
      verdictOf({ reviewers: { gpt: null }, score: 90 }, [
        round({ gpt: scored(99), opus: none }),
      ])
    ).toMatchObject({ reason: "no-scores", stop: true });
  });

  it("stops at the round cap and keeps the best round, not the last", () => {
    const rounds = [
      round({ opus: scored(70) }),
      round({ opus: scored(84) }),
      round({ opus: scored(80) }),
    ];
    expect(verdictOf({ maxRounds: 3, score: 90 }, rounds)).toEqual({
      best: 1,
      reason: "max-rounds",
      stop: true,
      unmet: ["opus 80 < 90"],
    });
  });

  it("stops when two rounds gain less than two points", () => {
    expect(
      verdictOf({ maxRounds: 6, score: 95 }, [
        round({ opus: scored(80) }),
        round({ opus: scored(81) }),
        round({ opus: scored(81) }),
      ])
    ).toMatchObject({ reason: "plateau", stop: true });
  });

  it("stops at the budget", () => {
    expect(
      verdictOf({ budgetUsd: 20, maxRounds: 6, score: 95 }, [
        round({ opus: scored(70) }, [], 12),
        round({ opus: scored(80) }, [], 9),
      ])
    ).toMatchObject({ reason: "budget", stop: true });
  });
});

const opus = { agentId: "claude-code", model: "opus" };

describe("who reviews", () => {
  const council = ["opus", "gpt-6.1-sol", "cursor:grok-4.7-high"];

  it("gives each round the first member, the members in turn, or all of them", () => {
    expect(reviewersOfRound(council, "one", 2)).toEqual(["opus"]);
    expect(
      [0, 1, 2, 3].map((i) => reviewersOfRound(council, "rotate", i))
    ).toEqual([["opus"], ["gpt-6.1-sol"], ["cursor:grok-4.7-high"], ["opus"]]);
    expect(reviewersOfRound(council, "all", 5)).toEqual(council);
  });

  it("takes each setting from the narrowest layer that sets it, the defaults under all", () => {
    expect(
      reviewSettingsOf(
        { eachRound: "one", reviewModels: [opus] },
        { eachRound: "all", goal: { score: 90 } },
        { eachRound: undefined, findingsLog: true }
      )
    ).toEqual({
      approval: "all",
      eachRound: "all",
      findingsLog: true,
      goal: { score: 90 },
      on: true,
      reviewModels: [opus],
      when: "end",
    });
  });

  it("compares a reviewer with itself for the plateau when the members take turns", () => {
    // Opus gains on Opus; GPT's lower scores in between don't make it a plateau.
    expect(
      verdictOf({ maxRounds: 6, score: 99 }, [
        round({ opus: scored(70) }),
        round({ gpt: scored(60) }),
        round({ opus: scored(80) }),
        round({ gpt: scored(61) }),
        round({ opus: scored(90) }),
      ])
    ).toMatchObject({ stop: false });
  });
});

describe("review levels", () => {
  it("names the defaults Standard, and each level's combination by its name", () => {
    expect(levelOf(undefined)).toBe("standard");
    expect(levelOf({ approval: "one", eachRound: "one" })).toBe("quick");
    expect(levelOf({ eachRound: "all" })).toBe("thorough");
    expect(levelOf({ eachRound: "all", on: false })).toBe("off");
  });

  it("is custom for a combination no level names, or with a goal", () => {
    expect(levelOf({ approval: "one", eachRound: "all" })).toBe("custom");
    expect(levelOf({ goal: { score: 90 } })).toBe("custom");
    expect(levelOf({ goal: {} })).toBe("standard");
  });

  it("sets a level keeping the review models and the log, and drops the goal", () => {
    const custom = {
      approval: "one",
      eachRound: "all",
      findingsLog: true,
      goal: { score: 90 },
      reviewModels: [opus],
    } as const;
    const quick = withLevel(custom, "quick");
    expect(quick).toEqual({
      approval: "one",
      eachRound: "one",
      findingsLog: true,
      on: true,
      reviewModels: [opus],
    });
    expect(levelOf(quick)).toBe("quick");
    expect(levelOf(withLevel(quick, "off"))).toBe("off");
    expect(levelOf(withLevel(withLevel(quick, "off"), "standard"))).toBe(
      "standard"
    );
  });
});

describe("a review model's lab name", () => {
  it("reads the agent from the name, and writes it back the same", () => {
    for (const name of ["opus", "gpt-6.1-sol", "cursor:grok-4.7-high"]) {
      expect(formatReviewModel(parseReviewModel(name))).toBe(name);
    }
    expect(parseReviewModel("gpt-6.1-sol")).toEqual({
      agentId: "codex",
      model: "gpt-6.1-sol",
    });
    expect(parseReviewModel("cursor:grok-4.7-high").agentId).toBe("cursor");
    expect(parseReviewModel("opus").agentId).toBe("claude-code");
  });
});
