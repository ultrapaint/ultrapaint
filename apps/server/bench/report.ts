/**
 * Turns the runs of one comparison, a directory under `docs/feature/benchmarks/`, into the table the decision is made from: what a
 * task costs an agent in each arm, and whether it still came out right.
 *
 * One section per agent. The arms of one agent say nothing about another's — a different model
 * behind a different harness — so the runs are never pooled across them.
 *
 * Usage: node --experimental-strip-types apps/server/bench/report.ts <directory of runs>
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

interface Measurement {
  readonly agent?: string;
  readonly arm: string;
  readonly failure: string | null;
  readonly seconds: number;
  readonly task: string;
  readonly tokens?: {
    readonly byModel: Record<string, number>;
    readonly cached: number;
    readonly input: number;
    readonly output: number;
    readonly total: number;
  };
  readonly toolCalls: number;
  readonly toolKinds: Record<string, number>;
}

const [given] = process.argv.slice(2);
if (given === undefined) {
  console.error(
    "say which comparison: report.ts docs/feature/benchmarks/<directory>"
  );
  process.exit(2);
}
const dir = path.resolve(import.meta.dirname, "../../..", given);
const runs = readdirSync(dir)
  .filter((name) => name.endsWith(".json"))
  .flatMap(
    (name) =>
      JSON.parse(readFileSync(path.join(dir, name), "utf8")) as Measurement[]
  );

const mean = (values: readonly number[]) =>
  values.length === 0
    ? null
    : values.reduce((a, b) => a + b, 0) / values.length;

const millions = (n: number) => `${(n / 1_000_000).toFixed(2)}M`;

/**
 * One task in one arm. The spread is shown next to the mean because a single run of an agent is
 * a sample of a noisy thing: on repeats the same task has come back anywhere from 19 to 36 calls.
 * A mean with no spread behind it reads as a measurement when it is a coin toss.
 */
const cell = (mine: readonly Measurement[]) => {
  if (mine.length === 0) {
    return "—";
  }
  const all = mine.map((r) => r.toolCalls).sort((a, b) => a - b);
  const low = all[0] ?? 0;
  const high = all.at(-1) ?? 0;
  const spread = low === high ? "" : `–${high}`;
  const failed = mine.filter((r) => r.failure !== null).length;
  return `${low}${spread} calls (n=${mine.length})${failed > 0 ? ` · ${failed} wrong` : ""}`;
};

/** Everything one agent's runs have to say. */
const section = (agent: string, mine: readonly Measurement[]) => {
  const arms = [...new Set(mine.map((r) => r.arm))];
  const tasks = [...new Set(mine.map((r) => r.task))];
  const inArm = (arm: string) => mine.filter((r) => r.arm === arm);
  return [
    `## ${agent}`,
    "",
    `| Task | ${arms.join(" | ")} |`,
    `|---|${arms.map(() => "---").join("|")}|`,
    ...tasks.map(
      (task) =>
        `| ${task} | ${arms
          .map((arm) =>
            cell(mine.filter((r) => r.task === task && r.arm === arm))
          )
          .join(" | ")} |`
    ),
    "",
    "### Totals",
    "",
    ...arms.map((arm) => {
      const all = inArm(arm)
        .map((r) => r.toolCalls)
        .sort((a, b) => a - b);
      return `- ${arm}: ${(mean(all) ?? 0).toFixed(1)} calls on average over ${all.length} runs, ${all[0]} to ${all.at(-1)}`;
    }),
    "",
    "### Tokens per run",
    "",
    ...arms.map((arm) => {
      const measured = inArm(arm).filter((r) => r.tokens);
      const per = (pick: (t: NonNullable<Measurement["tokens"]>) => number) =>
        millions(
          mean(measured.map((r) => (r.tokens ? pick(r.tokens) : 0))) ?? 0
        );
      return measured.length === 0
        ? `- ${arm}: not counted`
        : `- ${arm}: ${per((t) => t.total)} on average (cache reads ${per((t) => t.cached)}, fresh input ${per((t) => t.input)}, output ${per((t) => t.output)})`;
    }),
    "",
    "### Where the calls go",
    "",
    ...arms.map((arm) => {
      const counts: Record<string, number> = {};
      for (const run of inArm(arm)) {
        for (const [kind, n] of Object.entries(run.toolKinds)) {
          counts[kind] = (counts[kind] ?? 0) + n;
        }
      }
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      const shown = Object.entries(counts)
        .sort(([, a], [, b]) => b - a)
        .map(([kind, n]) => `${kind} ${n}`)
        .join(", ");
      return `- ${arm}: ${total} tool calls — ${shown}`;
    }),
    "",
  ];
};

/** What the measuring itself cost, since it is the user's own quota being spent. */
const spend = () => {
  const withTokens = runs.filter((r) => r.tokens);
  if (withTokens.length === 0) {
    return [];
  }
  const sum = (pick: (one: Measurement) => number) =>
    withTokens.reduce((total, run) => total + pick(run), 0);
  const byModel: Record<string, number> = {};
  for (const run of withTokens) {
    for (const [model, tokens] of Object.entries(run.tokens?.byModel ?? {})) {
      byModel[model] = (byModel[model] ?? 0) + tokens;
    }
  }
  return [
    "## What the measuring cost",
    "",
    `- ${withTokens.length} runs, ${millions(sum((one) => one.tokens?.total ?? 0))} tokens in total`,
    `- of which cache reads: ${millions(sum((one) => one.tokens?.cached ?? 0))}; fresh input: ${millions(sum((one) => one.tokens?.input ?? 0))}; output: ${millions(sum((one) => one.tokens?.output ?? 0))}`,
    `- per run: ${millions(sum((one) => one.tokens?.total ?? 0) / withTokens.length)} on average`,
    ...Object.entries(byModel)
      .sort(([, a], [, b]) => b - a)
      .map(([model, tokens]) => `- ${model}: ${millions(tokens)}`),
    "",
  ];
};

const agents = [...new Set(runs.map((r) => r.agent ?? "unknown"))].sort();

const report = [
  "# Benchmark: what a task costs an agent",
  "",
  "Generated by `apps/server/bench/report.ts` from the runs in this directory.",
  "",
  ...agents.flatMap((agent) =>
    section(
      agent,
      runs.filter((r) => (r.agent ?? "unknown") === agent)
    )
  ),
  ...spend(),
].join("\n");

writeFileSync(path.join(dir, "README.md"), report);
process.stdout.write(report);
