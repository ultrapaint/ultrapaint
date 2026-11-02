import { emptyDesignSystem } from "@ultrapaint/contracts/design-system";
import {
  type DesignSystemSetup,
  emptySetup,
  type SetupStep,
  type UsageInventory,
  type UsageMapping,
} from "@ultrapaint/contracts/design-system-setup";
import { describe, expect, it } from "vitest";
import {
  applyChanges,
  batchesOf,
  mappingOf,
  stepAfter,
  targetProblem,
  verifySummary,
} from "./services/design-system-setup-rules.ts";

/** A setup whose steps are as given, in order; the rest todo. */
const setupWith = (...given: SetupStep["status"][]): DesignSystemSetup => {
  const empty = emptySetup(0);
  return {
    ...empty,
    steps: empty.steps.map((s, i) => ({ ...s, status: given[i] ?? "todo" })),
  };
};

const outcome = (result: ReturnType<typeof stepAfter>) =>
  "problem" in result ? result.problem : result.status;

describe("where a step may go", () => {
  it("starts the steps in order, each once, an agent's in its thread", () => {
    expect(outcome(stepAfter(setupWith(), "inventory", "start"))).toBe(
      "active"
    );
    expect(
      outcome(stepAfter(setupWith(), "map", "start", { threadId: "t" }))
    ).toBe("Inventory comes first: go on past it before Map.");
    expect(outcome(stepAfter(setupWith("done"), "define", "start"))).toBe(
      "Define runs in a thread."
    );
    expect(
      outcome(
        stepAfter(setupWith("done"), "define", "start", { threadId: "t" })
      )
    ).toBe("active");
    expect(
      outcome(
        stepAfter(setupWith("done", "stopped"), "define", "start", {
          threadId: "t",
        })
      )
    ).toBe("Define has started already: resume it, or redo it to start again.");
  });

  it("stops, resumes, finishes and goes on past a step only from where that can be done", () => {
    const at = (status: SetupStep["status"]) => setupWith("done", status);
    expect(outcome(stepAfter(at("active"), "define", "stop"))).toBe("stopped");
    expect(outcome(stepAfter(at("todo"), "define", "stop"))).toBe(
      "Define is not under way."
    );
    expect(outcome(stepAfter(at("review"), "define", "resume"))).toBe("active");
    expect(outcome(stepAfter(at("active"), "define", "resume"))).toBe(
      "Define is under way already."
    );
    expect(outcome(stepAfter(at("done"), "define", "resume"))).toBe(
      "Define cannot be resumed: redo it to start again."
    );
    expect(outcome(stepAfter(at("stopped"), "define", "finish"))).toBe(
      "review"
    );
    expect(outcome(stepAfter(at("done"), "define", "finish"))).toBe(
      "The user has gone on past Define already."
    );
    expect(outcome(stepAfter(at("stopped"), "define", "complete"))).toBe(
      "done"
    );
    expect(outcome(stepAfter(at("done"), "define", "complete"))).toBe(
      "Define is done already."
    );
    expect(outcome(stepAfter(at("todo"), "define", "complete"))).toBe(
      "Define has not started."
    );
  });
});

const audit: UsageInventory = {
  against: "saved",
  at: 1,
  files: 2,
  ownColors: 0,
  recommendation: { mode: "adopt", reason: "" },
  totals: [
    { default: 1, kind: "color", raw: 1, system: 3 },
    { default: 0, kind: "spacing", raw: 1, system: 0 },
  ],
  values: [
    {
      count: 3,
      examples: ["bg-primary"],
      files: 1,
      kind: "color",
      locations: [],
      status: "system",
      value: "color-primary",
    },
    {
      count: 1,
      examples: ["text-gray-500"],
      files: 1,
      kind: "color",
      locations: [{ file: "src/a.tsx", line: 2 }],
      status: "default",
      value: "color-gray-500",
    },
    {
      count: 2,
      examples: ["bg-[#ff0000]"],
      files: 1,
      kind: "color",
      locations: [],
      status: "raw",
      value: "#ff0000",
    },
    {
      count: 1,
      examples: ["p-[13px]"],
      files: 1,
      kind: "spacing",
      locations: [],
      status: "raw",
      value: "13px",
    },
  ],
};

const ds = {
  ...emptyDesignSystem(),
  colors: [
    { name: "Semantic", tokens: [{ name: "color-primary", value: "#f00" }] },
  ],
};

describe("the mapping", () => {
  const mapping: UsageMapping = mappingOf(
    audit,
    [
      {
        kind: "color",
        note: "Exact",
        target: "color-primary",
        value: "#ff0000",
      },
    ],
    5
  );

  it("lists every value off the system, most used first, with what the rules settled", () => {
    expect(
      mapping.entries.map((e) => [e.kind, e.value, e.target, e.by, e.where])
    ).toEqual([
      ["color", "#ff0000", "color-primary", "rule", undefined],
      ["color", "color-gray-500", undefined, undefined, "src/a.tsx:2"],
      ["spacing", "13px", undefined, undefined, undefined],
    ]);
  });

  it("takes the decisions that fit, and says why the others do not", () => {
    const check = (kind: "color" | "spacing", target: string) =>
      targetProblem(kind, target, ds);
    const result = applyChanges(
      mapping,
      [
        { kind: "spacing", target: "spacing-3", value: "13px" },
        {
          keep: true,
          kind: "color",
          note: "The brand's",
          value: "color-gray-500",
        },
        { kind: "color", target: "color-nope", value: "#ff0000" },
        { kind: "color", target: "color-primary", value: "#000" },
      ],
      "agent",
      (kind, target) => check(kind as "color" | "spacing", target)
    );
    expect(result.applied).toBe(2);
    expect(result.problems).toEqual([
      'color #ff0000: "color-nope" is not a color token; there are color-primary.',
      "color #000 is not a value of the mapping: the task lists them.",
    ]);
    expect(
      result.mapping.entries.map((e) => [e.value, e.target ?? e.keep, e.by])
    ).toEqual([
      ["#ff0000", "color-primary", "rule"],
      ["color-gray-500", true, "agent"],
      ["13px", "spacing-3", "agent"],
    ]);
  });

  it("says when the code is verified how much is off the system, then and now", () => {
    expect(verifySummary(audit, mapping)).toBe(
      "2 files read. Off the system: 4 uses when the mapping was made, 3 now."
    );
    expect(verifySummary(audit, null)).toBe(
      "2 files read. 3 uses off the system."
    );
  });
});

describe("the migration's batches", () => {
  it("are a directory at a time, twelve files at most", () => {
    const files = Array.from({ length: 13 }, (_, i) => `src/f${i}.tsx`);
    const batches = batchesOf([...files, "lib/a.tsx"], (f) =>
      f.slice(0, f.lastIndexOf("/"))
    );
    expect(batches.map((b) => [b.id, b.dir, b.files.length])).toEqual([
      ["batch-1", "lib", 1],
      ["batch-2", "src", 12],
      ["batch-3", "src", 1],
    ]);
  });
});
