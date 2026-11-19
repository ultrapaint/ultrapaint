import type {
  DesignDocument,
  DesignFinding,
} from "@ultrapaint/contracts/design-system";
import type { SyncPlan } from "@ultrapaint/contracts/sync";
import { describe, expect, it } from "vitest";
import {
  findingWords,
  fixPrompt,
  ignorable,
  type ProblemsInput,
  problemsOf,
  worstOf,
} from "./problems.ts";

// The linter's own words (`@google/design.md` 0.4), as the server passes them on.
const MISSING_PRIMARY: DesignFinding = {
  message:
    "No 'primary' color defined. The agent will auto-generate key colors, reducing your control over the palette.",
  path: "colors",
  severity: "warning",
};
const CONTRAST: DesignFinding = {
  message:
    "textColor (#9a9a9a) on backgroundColor (#ffffff) has contrast ratio 2.80:1, below WCAG AA minimum of 4.5:1.",
  path: "components.button-secondary",
  severity: "warning",
};
const BROKEN: DesignFinding = {
  message:
    "Reference {colors.brand-500} does not resolve to any defined token.",
  path: "components.card.backgroundColor",
  severity: "error",
};
const orphan = (name: string): DesignFinding => ({
  message: `'${name}' is defined but never referenced by any component.`,
  path: `colors.${name}`,
  severity: "warning",
});
const SUMMARY: DesignFinding = {
  message: "Design system defines 29 colors.",
  severity: "info",
};

const documentWith = (findings: readonly DesignFinding[]): DesignDocument => ({
  body: "",
  findings,
  held: [],
  legacy: false,
  path: "DESIGN.md",
  sections: [],
  text: "",
});

const WAITING: SyncPlan = {
  at: 1,
  case: "maintain",
  drift: { tokensUndescribed: [] },
  facts: { app: true, designSystem: true, stylesheets: 1 },
  steps: [
    {
      detail: "DESIGN.md changed 3 values the code doesn’t have.",
      kind: "design-md",
      state: "attention",
      title: "Take DESIGN.md’s tokens into the design system",
    },
    { detail: "", kind: "describe", state: "done", title: "Describe the code" },
  ],
  summary: "",
};

const nothing: ProblemsInput = {
  designSystemRead: true,
  designsDir: "docs/designs",
  document: null,
  notes: [],
  plan: null,
  problem: undefined,
};

describe("Problems › DESIGN.md's linter, in Ultrapaint's words", () => {
  it("says a missing primary colour is what it costs and how to fix it", () => {
    expect(findingWords(MISSING_PRIMARY)).toEqual({
      detail:
        "Agents can’t tell which colour marks an action. Name the one your buttons use `primary`.",
      title: "No primary colour",
    });
  });

  it("names the component that is hard to read and its contrast against what text needs", () => {
    expect(findingWords(CONTRAST)).toEqual({
      detail: "Its text is 2.8:1 on its fill; text needs 4.5:1.",
      title: "`button-secondary` is hard to read",
    });
  });

  it("keeps a message it does not know as the linter wrote it, under its place", () => {
    const unknown: DesignFinding = {
      message:
        "'12pt' has an invalid unit 'pt'. Only px, rem, and em are allowed.",
      path: "typography.body.fontSize",
      severity: "error",
    };
    expect(findingWords(unknown)).toEqual({
      detail: unknown.message,
      title: "`typography.body.fontSize`",
    });
  });

  it("lists warnings and errors, never information", () => {
    const problems = problemsOf({
      ...nothing,
      document: documentWith([SUMMARY, MISSING_PRIMARY, BROKEN]),
    });
    expect(problems.map((p) => [p.severity, p.title])).toEqual([
      ["warning", "No primary colour"],
      ["error", "`card` points to a missing token"],
    ]);
  });

  it("makes the colours no component uses one problem, not one each", () => {
    const problems = problemsOf({
      ...nothing,
      document: documentWith([
        orphan("agent"),
        orphan("board"),
        orphan("canvas"),
      ]),
    });
    expect(problems.map((p) => [p.title, p.detail])).toEqual([
      [
        "3 colours no component uses",
        "`agent`, `board`, `canvas`. Use them in a component, or remove them.",
      ],
    ]);
  });
});

describe("Problems › what else needs fixing", () => {
  it("lists the sync's waiting steps first, to answer in the Sync", () => {
    const problems = problemsOf({
      ...nothing,
      document: documentWith([MISSING_PRIMARY]),
      plan: WAITING,
    });
    expect(problems.map((p) => [p.source, p.fix])).toEqual([
      ["Sync", "sync"],
      ["DESIGN.md", "agent"],
    ]);
    expect(problems[0]?.title).toBe(
      "Take DESIGN.md’s tokens into the design system"
    );
  });

  it("says a file that doesn't read is an error of that file", () => {
    const [tokens] = problemsOf({
      ...nothing,
      problem:
        "design.tokens.json is not JSON: SyntaxError: Unexpected end: the values are design-system.json's and the code's until it reads",
    });
    expect(tokens).toMatchObject({
      brief: "design.tokens.json doesn’t read: not JSON: Unexpected end",
      severity: "error",
      source: "design.tokens.json",
      title: "design.tokens.json doesn’t read",
    });
    const [system] = problemsOf({
      ...nothing,
      designSystemRead: false,
      problem: "design-system.json is not valid: Missing key",
    });
    expect(system?.source).toBe("design-system.json");
  });

  it("lists what the tokens file left out under that file", () => {
    const [left] = problemsOf({
      ...nothing,
      notes: [
        "design.tokens.json: `shadow.card`: its value could not be read as CSS, so it is left out.",
      ],
    });
    expect(left).toMatchObject({
      source: "design.tokens.json",
      title:
        "`shadow.card`: its value could not be read as CSS, so it is left out.",
    });
  });

  it("is red when one is an error, amber otherwise", () => {
    const warnings = problemsOf({
      ...nothing,
      document: documentWith([MISSING_PRIMARY]),
    });
    expect(worstOf(warnings)).toBe("warning");
    const both = problemsOf({
      ...nothing,
      document: documentWith([MISSING_PRIMARY, BROKEN]),
    });
    expect(worstOf(both)).toBe("error");
  });
});

describe("Problems › the chat drafted to fix them", () => {
  it("tells the agent the file's own words for one problem", () => {
    const [primary] = problemsOf({
      ...nothing,
      document: documentWith([MISSING_PRIMARY]),
    });
    expect(fixPrompt(primary ? [primary] : [])).toBe(
      "Fix this in the design system: DESIGN.md, `colors`: No 'primary' color defined. The agent will auto-generate key colors, reducing your control over the palette. Ask me where the choice is mine."
    );
  });

  it("lists every problem an agent can fix, and leaves the sync's to the Sync", () => {
    const problems = problemsOf({
      ...nothing,
      document: documentWith([MISSING_PRIMARY, CONTRAST]),
      plan: WAITING,
    });
    const prompt = fixPrompt(problems);
    expect(prompt.split("\n")).toEqual([
      "Fix these in the design system:",
      `- DESIGN.md, \`colors\`: ${MISSING_PRIMARY.message}`,
      `- DESIGN.md, \`components.button-secondary\`: ${CONTRAST.message}`,
      "Ask me where a choice is mine.",
    ]);
  });
});

describe("Problems › where each is written, and which can be left (ADR 0106)", () => {
  it("names the file and the place of its line, and none for a sync step", () => {
    const problems = problemsOf({
      ...nothing,
      document: documentWith([CONTRAST, orphan("agent")]),
      notes: [
        "design.tokens.json: `shadow.card`: its value could not be read as CSS, so it is left out.",
      ],
      plan: WAITING,
    });
    expect(problems.map((p) => p.file)).toEqual([
      null,
      { at: "shadow.card", path: "docs/designs/design.tokens.json" },
      { at: "components.button-secondary", path: "DESIGN.md" },
      { at: "colors.agent", path: "DESIGN.md" },
    ]);
  });

  it("lets a warning be left as it is, never an error or a sync step", () => {
    const problems = problemsOf({
      ...nothing,
      document: documentWith([MISSING_PRIMARY, BROKEN]),
      plan: WAITING,
    });
    expect(problems.map((p) => [p.source, p.severity, ignorable(p)])).toEqual([
      ["Sync", "warning", false],
      ["DESIGN.md", "warning", true],
      ["DESIGN.md", "error", false],
    ]);
  });
});
