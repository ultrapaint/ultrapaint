/**
 * `off-system`: the values each run's pages set for themselves where the design system has a
 * token (design-document's `offSystemValues`), counted per run and per kind. The check the
 * shift-left proposal runs at each edit (ADR 0061), measured on rounds already made: how much a
 * designer leaves off the system that a check on the document would have caught.
 */
import path from "node:path";
import { PageDocument } from "@ultrapaint/contracts/document";
import {
  type OffSystemKind,
  type OffSystemValue,
  offSystemValues,
} from "@ultrapaint/design-document/off-system";
import { Effect, FileSystem } from "effect";
import { EvalsConfig } from "./config.ts";
import { roundRuns } from "./judge.ts";
import { listDir, readJson, writeText } from "./layout.ts";

const KINDS: readonly OffSystemKind[] = [
  "spacing",
  "radius",
  "color",
  "shadow",
  "font",
  "text-size",
  "weight",
  "line-height",
  "tracking",
];

/**
 * Every value off the system in one run's pages, with the page each is on. A page is decoded as
 * this checkout's contracts have it, which is what `offSystemValues` reads; one that does not fit
 * (a round may measure another commit of Ultrapaint) is said and left out, not counted as it is.
 */
const runValues = Effect.fn("runValues")(function* (dir: string) {
  const pages = path.join(dir, "pages");
  const found: (OffSystemValue & { readonly page: string })[] = [];
  for (const file of (yield* listDir(pages)).filter((f) =>
    f.endsWith(".page.json")
  )) {
    const page = yield* readJson(PageDocument, path.join(pages, file)).pipe(
      Effect.catchTag("EvalsError", (error) =>
        Effect.as(Effect.logWarning(`not counted: ${error.message}`), undefined)
      )
    );
    if (page !== undefined) {
      found.push(
        ...offSystemValues(page.root).map((v) => ({ ...v, page: file }))
      );
    }
  }
  return found;
});

const row = (cells: readonly (string | number)[]) => `| ${cells.join(" | ")} |`;

/** The round's table: values off the system per run and kind, and each one under it. */
export const offSystemTable = (
  round: string,
  runs: readonly {
    readonly name: string;
    readonly values: readonly (OffSystemValue & { readonly page: string })[];
  }[]
) => {
  const lines = [
    `# Off the system: ${round}`,
    "",
    "Values each run's pages set for themselves where the design system has a token: a number or CSS where a `$token` was due. 0, `none`, `transparent`, sizes and a round radius are left alone.",
    "",
    row(["Run", "All", ...KINDS]),
    row(["---", "---", ...KINDS.map(() => "---")]),
    ...runs.map((r) =>
      row([
        r.name,
        `**${r.values.length}**`,
        ...KINDS.map((k) => r.values.filter((v) => v.kind === k).length),
      ])
    ),
    "",
  ];
  for (const r of runs) {
    lines.push(`## ${r.name}`, "");
    for (const v of r.values) {
      lines.push(
        `- ${v.page} › ${v.node}: \`${v.field}\` ${JSON.stringify(v.value)} (${v.kind})`
      );
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
};

export const offSystem = Effect.fn("offSystem")(function* (
  rounds: readonly string[]
) {
  const { data } = yield* EvalsConfig;
  const fs = yield* FileSystem.FileSystem;
  for (const round of rounds) {
    const runs: {
      name: string;
      values: (OffSystemValue & { readonly page: string })[];
    }[] = [];
    for (const run of yield* roundRuns(round)) {
      if (yield* fs.exists(path.join(run.dir, "pages"))) {
        runs.push({
          name: `${run.reference}/${path.basename(run.dir)}`,
          values: [...(yield* runValues(run.dir))],
        });
      }
    }
    const file = path.join(data.runs, round, "off-system.md");
    yield* writeText(file, offSystemTable(round, runs));
    const total = runs.reduce((n, r) => n + r.values.length, 0);
    yield* Effect.log(
      `${round}: ${total} values off the system in ${runs.length} runs; ${data.fromData(file)}`
    );
  }
});
