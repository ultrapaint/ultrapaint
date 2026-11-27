import { describe, expect, it } from "@effect/vitest";
import type { RoundFinding, ThreadItem } from "@ultrapaint/contracts/threads";
import { Option } from "effect";
import { withoutDataUrls } from "./page-views.ts";
import {
  answeredRound,
  answerOf,
  answersByPage,
  declinedChecksOf,
  declinedOf,
  handsToAll,
  mergeFound,
  type PageAnswer,
  reviewerScore,
  runOf,
  standInFor,
} from "./review-rounds.ts";

const user = (id: string, text: string, review?: string): ThreadItem => ({
  at: 1,
  attachments: [],
  id,
  kind: "user",
  text,
  ...(review !== undefined && { review }),
});

const round = (id: string, closing = false): ThreadItem => ({
  at: 1,
  findings: [],
  id,
  kind: "review",
  maxRounds: 6,
  reviewers: [],
  round: 1,
  ...(closing && { closing }),
});

const finding = {
  category: "spacing",
  fix: "Use 16px.",
  problem: "The gap is uneven.",
  rule: "",
  severity: "minor",
  title: "Uneven gap",
  where: "the header",
} as const;

const answer = (fields: Partial<PageAnswer> = {}): PageAnswer => ({
  findings: [],
  reached: [],
  signOff: { done: true, left: "" },
  ...fields,
});

describe("a review run", () => {
  it("starts at the person's last prompt, its rounds the reviews since", () => {
    const run = runOf([
      user("u1", "a page"),
      round("r0"),
      user("u2", "make it calmer"),
      round("r1"),
      user("u3", "findings", "r1"),
      round("r2"),
    ]);
    expect(run.request).toBe("make it calmer");
    expect(run.rounds.map((r) => r.id)).toEqual(["r1", "r2"]);
    expect(run.answering).toBeUndefined();
  });

  it("is answering the round whose findings the last prompt carried", () => {
    const run = runOf([
      user("u1", "a page"),
      round("r1"),
      user("u2", "x", "r1"),
    ]);
    expect(run.answering?.id).toBe("r1");
  });
});

describe("a review model's answer", () => {
  it("is its last fenced JSON block", () => {
    const said = `Looking.\n\`\`\`json\n{"nope": 1}\n\`\`\`\nThen:\n\`\`\`json\n${JSON.stringify(
      {
        pages: [
          {
            findings: [finding],
            page: "designs/home.page.json",
            reached: ["content"],
            signOff: { done: false, left: "The gap." },
          },
        ],
      }
    )}\n\`\`\``;
    const pages = Option.getOrThrow(answerOf(said));
    expect(pages).toHaveLength(1);
    expect(pages[0]?.findings[0]?.title).toBe("Uneven gap");
  });

  it("may be one page's answer alone, a finding's rule left out", () => {
    const { rule: _rule, ...withoutRule } = finding;
    const pages = Option.getOrThrow(
      answerOf(
        JSON.stringify({
          findings: [withoutRule],
          signOff: { done: true, left: "" },
        })
      )
    );
    expect(pages[0]?.findings[0]?.rule).toBe("");
    expect(pages[0]?.reached).toEqual([]);
  });

  it("can't be read when it isn't the asked JSON", () => {
    expect(Option.isNone(answerOf("Looks great!"))).toBe(true);
  });

  it("is matched to the pages by name, then in order", () => {
    const pages = [
      { file: "designs/a.page.json" },
      { file: "designs/b.page.json", route: "/b" },
    ];
    const named = answersByPage(pages, [
      answer({ page: "/b", signOff: { done: false, left: "b" } }),
      answer({ page: "elsewhere" }),
    ]);
    expect(named[1]?.signOff.left).toBe("b");
    expect(named[0]?.page).toBe("elsewhere");
  });

  it("scores the pages and approves only when every page is approved", () => {
    const pages = [{ file: "a" }, { file: "b" }];
    const scored = reviewerScore(pages, [
      answer(),
      answer({
        findings: [finding],
        signOff: { done: false, left: "the gap" },
      }),
    ]);
    expect(scored.approved).toBe(false);
    expect(scored.score.kind === "scored" && scored.score.overall).toBe(100);
    expect(reviewerScore(pages, [answer(), answer()]).approved).toBe(true);
  });

  it("gives a problem shared by several pages once, at its worst, naming the pages", () => {
    const at = (page: string, severity: "major" | "minor") => ({
      finding: { ...finding, severity },
      page,
      reviewer: "opus",
    });
    const merged = mergeFound([
      at("designs/share.page.json", "minor"),
      at("designs/share-copied.page.json", "major"),
      { ...at("designs/share.page.json", "minor"), reviewer: "gpt-6.1-sol" },
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0]?.finding.severity).toBe("major");
    expect(merged[0]?.finding.where).toContain(
      "on 2 pages (share, share-copied)"
    );
  });

  it("approves a page where it found nothing and left nothing", () => {
    const scored = reviewerScore(
      [{ file: "a" }],
      [answer({ signOff: { done: false, left: "" } })]
    );
    expect(scored.approved).toBe(true);
  });
});

describe("who reviews", () => {
  const opus = { agentId: "claude-code", model: "opus" };
  const sol = { agentId: "codex", model: "gpt-6.1-sol" };
  const grok = { agentId: "cursor", model: "grok" };
  const models = [opus, sol, grok];

  it("takes the next model in turn for one that didn't answer", () => {
    expect(standInFor(models, opus, new Set(["opus"]))).toEqual(sol);
    expect(standInFor(models, grok, new Set(["cursor:grok", "opus"]))).toEqual(
      sol
    );
    expect(
      standInFor(models, opus, new Set(["opus", "gpt-6.1-sol", "cursor:grok"]))
    ).toBeUndefined();
  });

  it("hands a satisfied round to every model while not all of them looked", () => {
    const approved = {
      best: 0,
      reason: "signed-off",
      stop: true,
      unmet: [],
    } as const;
    const base = {
      approval: "all",
      closing: false,
      found: 2,
      models: 3,
      verdict: approved,
      who: 1,
    } as const;
    expect(handsToAll(base)).toBe(true);
    expect(handsToAll({ ...base, approval: "one" })).toBe(false);
    expect(handsToAll({ ...base, closing: true })).toBe(false);
    expect(handsToAll({ ...base, who: 3 })).toBe(false);
    expect(
      handsToAll({
        ...base,
        verdict: { stop: false, unmet: ["opus hasn't signed off"] },
      })
    ).toBe(false);
  });
});

describe("the designer's answer", () => {
  const findings = [
    { title: "Uneven gap" },
    { title: "Weak title" },
    { title: "Weak title contrast" },
  ];

  it("declines a finding by its title, with the reason after the dash", () => {
    const declined = declinedOf(
      "Fixed the rest.\n\n- **Declined: Weak title contrast** — the brand asks for it\nDeclined: uneven gap - the grid sets it",
      findings
    );
    expect([...declined.entries()]).toEqual([
      [2, { reason: "the brand asks for it" }],
      [0, { reason: "the grid sets it" }],
    ]);
  });

  it("reads a decline the person kept when asked beside the designer's own (ADR 0157)", () => {
    const declined = declinedOf(
      [
        "Declined: 1 — the grid sets it",
        "- **Declined by the user: Weak title** — they want it quiet",
        "Declined by the person: #3 — the brand asks for it",
      ].join("\n"),
      findings
    );
    expect([...declined.entries()]).toEqual([
      [0, { reason: "the grid sets it" }],
      [1, { decidedBy: "person", reason: "they want it quiet" }],
      [2, { decidedBy: "person", reason: "the brand asks for it" }],
    ]);
  });

  it("keeps a check's decline the designer's, written as the person's or not: it is never asked", () => {
    const declined = declinedOf(
      "Declined by the user: 1 — one strip by design",
      [{ check: "touching-rows", title: "Rows touching" }]
    );
    expect([...declined.entries()]).toEqual([
      [0, { reason: "one strip by design" }],
    ]);
  });

  it("declines a finding by its title shortened with an ellipsis, at its end or inside it", () => {
    const checks = [
      { title: "Hand-set colour color-mix(…) on Plan and 2 more" },
      {
        title:
          "linear-gradient(180deg, $color-scrim, rgba(12, 10, 40, 0.6) 70%) color off the system",
      },
      { title: "Hand-set spacing 13px on Title" },
      { title: "Hand-set spacing 6px on Row 1 and 8 more" },
    ];
    const declined = declinedOf(
      [
        "Declined: Hand-set colour color-mix… — the brand's tint",
        "Declined: linear-gradient(…) color off the system — the hero's scrim",
        // Two titles begin so: it names neither.
        "Declined: Hand-set spacing... — the grid",
      ].join("\n"),
      checks
    );
    expect([...declined.entries()]).toEqual([
      [0, { reason: "the brand's tint" }],
      [1, { reason: "the hero's scrim" }],
    ]);
  });

  it("declines a finding by its number, and ignores a line naming none", () => {
    const declined = declinedOf(
      "Declined: #2 — out of scope\nDeclined: something else — no",
      findings
    );
    expect([...declined.entries()]).toEqual([[1, { reason: "out of scope" }]]);
  });
});

describe("the checks' declines a thread remembers", () => {
  const place = {
    fields: '[["size",15]]',
    node: "c_title",
    page: "designs/home.page.json",
  };
  const check = (
    title: string,
    more: Partial<RoundFinding> = {}
  ): RoundFinding => ({
    category: "typography",
    check: "off-system",
    fix: "Use the design system's text size token.",
    places: [place],
    problem: "off the system",
    reviewer: "check",
    severity: "minor",
    title,
    where: "Title (`size`)",
    ...more,
  });
  const reviewed = (
    id: string,
    findings: readonly RoundFinding[]
  ): ThreadItem => ({
    at: 1,
    findings,
    id,
    kind: "review",
    maxRounds: 6,
    reviewers: [],
    round: 1,
  });

  it("are the checks' findings declined in every round of the thread, each once, as it was declined", () => {
    const declined = check("Hand-set text size 15px on Title", {
      declined: "the brand's",
    });
    const remembered = declinedChecksOf([
      user("u1", "a page"),
      reviewed("r1", [
        declined,
        check("Hand-set weight 550 on Title"),
        {
          ...check("Uneven gap", { declined: "on purpose" }),
          check: undefined,
          reviewer: "m0",
        },
      ]),
      user("u2", "now the footer"),
      // Carried into a later run's round, it is the decline it was.
      reviewed("r2", [{ ...declined, carried: true }]),
      // Stored before a finding kept its places, it names none.
      reviewed("r3", [
        check("Hand-set spacing 13px on Card", {
          declined: "tight",
          places: undefined,
        }),
      ]),
    ]);
    expect(remembered).toEqual([declined]);
  });

  it("are none in a thread of its own", () => {
    expect(declinedChecksOf([user("u1", "a page"), round("r1")])).toEqual([]);
  });
});

describe("a round answered", () => {
  it("counts as fixed only what the designer was sent, less what it declined", () => {
    const answered = {
      at: 0,
      findings: [
        {
          ...finding,
          reviewer: "opus",
          severity: "major" as const,
          title: "A",
        },
        {
          ...finding,
          reviewer: "opus",
          severity: "major" as const,
          title: "B",
        },
        {
          ...finding,
          reviewer: "opus",
          severity: "minor" as const,
          title: "C",
        },
      ],
      id: "r1",
      kind: "review" as const,
      maxRounds: 2,
      reviewers: [],
      round: 1,
    };
    expect(
      answeredRound(answered, new Map([[1, { reason: "the brief" }]])).fixed
    ).toBe(1);
  });

  it("counts as fixed only what the designer was sent, when it is known", () => {
    const roundFinding = (title: string, more: Partial<RoundFinding> = {}) => ({
      category: "spacing" as const,
      fix: "",
      problem: "",
      reviewer: "m0",
      severity: "major" as const,
      title,
      where: "",
      ...more,
    });
    const answered: Extract<ThreadItem, { kind: "review" }> = {
      at: 0,
      findings: [
        roundFinding("Rows touching", {
          check: "touching-rows",
          reviewer: "check",
        }),
        roundFinding("Header too loud"),
      ],
      id: "r1",
      kind: "review",
      maxRounds: 2,
      reviewers: [],
      round: 1,
    };
    expect(answeredRound(answered, new Map(), 1).fixed).toBe(1);
    expect(
      answeredRound(answered, new Map([[0, { reason: "by design" }]]), 1).fixed
    ).toBe(0);
  });

  it("keeps who decided each decline: the person, where they kept it when asked (ADR 0157)", () => {
    const answered: Extract<ThreadItem, { kind: "review" }> = {
      at: 0,
      findings: ["A", "B", "C"].map((title) => ({
        ...finding,
        reviewer: "opus",
        severity: "major" as const,
        title,
      })),
      id: "r1",
      kind: "review",
      maxRounds: 2,
      reviewers: [],
      round: 1,
    };
    const after = answeredRound(
      answered,
      new Map([
        [0, { reason: "the grid sets it" }],
        [1, { decidedBy: "person" as const, reason: "they want it quiet" }],
      ])
    );
    expect(
      after.findings.map((f) => [f.title, f.declined, f.decidedBy])
    ).toEqual([
      ["A", "the grid sets it", undefined],
      ["B", "they want it quiet", "person"],
      ["C", undefined, undefined],
    ]);
    expect(after.fixed).toBe(1);
  });

  it("leaves a decline carried from an earlier round as it was, neither fixed nor declined again", () => {
    const carried: RoundFinding = {
      carried: true,
      category: "spacing",
      check: "off-system",
      declined: "the card's own inset",
      fix: "",
      problem: "",
      reviewer: "check",
      severity: "minor",
      title: "Hand-set spacing 13px on Card",
      where: "",
    };
    const answered: Extract<ThreadItem, { kind: "review" }> = {
      at: 0,
      findings: [carried],
      id: "r1",
      kind: "review",
      maxRounds: 2,
      reviewers: [],
      round: 1,
    };
    // Sent before the server restarted, the round counts what it sends: never a carried one.
    const again = answeredRound(
      answered,
      new Map([[0, { reason: "another reason" }]])
    );
    expect(again.fixed).toBe(0);
    expect(again.findings).toEqual([carried]);
  });
});

describe("what a reviewer is shown", () => {
  it("says an image inlined as data by its type and size, not its bytes", () => {
    const data = `data:image/png;base64,${"A".repeat(4096)}`;
    const shown = withoutDataUrls(JSON.stringify({ src: data, text: "Hi" }));
    expect(shown).not.toContain("AAAA");
    expect(shown).toContain("(a image/png inlined as data, 3 KB)");
    expect(shown).toContain('"text":"Hi"');
  });
});
