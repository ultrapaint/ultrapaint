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

type Found = OffSystemValue & { readonly page: string };

/** A run as the table shows it: its values, and the pages it could not count. */
interface CountedRun {
  readonly name: string;
  /** The page files that did not read as a page, by name: their values are in no count. */
  readonly skipped: readonly string[];
  readonly values: readonly Found[];
}

/**
 * Every value off the system in one run's pages, with the page each is on. A page is decoded as
 * this checkout's contracts have it, which is what `offSystemValues` reads; one that does not fit
 * (a round may measure another commit of Ultrapaint) is said and left out, not counted as it is,
 * and named in what is returned so the table says the count is of the rest.
 */
const runValues = Effect.fn("runValues")(function* (dir: string) {
  const pages = path.join(dir, "pages");
  const values: Found[] = [];
  const skipped: string[] = [];
  for (const file of (yield* listDir(pages)).filter((f) =>
    f.endsWith(".page.json")
  )) {
    const page = yield* readJson(PageDocument, path.join(pages, file)).pipe(
      Effect.catchTag("EvalsError", (error) =>
        Effect.as(Effect.logWarning(`not counted: ${error.message}`), undefined)
      )
    );
    if (page === undefined) {
      skipped.push(file);
    } else {
      values.push(
        ...offSystemValues(page.root).map((v) => ({ ...v, page: file }))
      );
    }
  }
  return { skipped, values };
});

const row = (cells: readonly (string | number)[]) => `| ${cells.join(" | ")} |`;

/**
 * The round's table: values off the system per run and kind, and each one under it. A run with
 * pages that could not be read says how many in its last column and which under its heading: its
 * count is of the pages that were read.
 */
export const offSystemTable = (round: string, runs: readonly CountedRun[]) => {
  const skipped = runs.reduce((n, r) => n + r.skipped.length, 0);
  const lines = [
    `# Off the system: ${round}`,
    "",
    "Values each run's pages set for themselves where the design system has a token: a number or CSS where a `$token` was due. 0, `none`, `transparent`, sizes and a round radius are left alone.",
    "",
    ...(skipped > 0
      ? [
          `**${skipped} page${skipped === 1 ? " is" : "s are"} not counted**: ${skipped === 1 ? "it does" : "they do"} not read as a page of this checkout (the round may have measured another commit). A run's count is of the pages that were read; the last column says how many were not.`,
          "",
        ]
      : []),
    row(["Run", "All", ...KINDS, "Pages not counted"]),
    row(["---", "---", ...KINDS.map(() => "---"), "---"]),
    ...runs.map((r) =>
      row([
        r.name,
        `**${r.values.length}**`,
        ...KINDS.map((k) => r.values.filter((v) => v.kind === k).length),
        r.skipped.length,
      ])
    ),
    "",
  ];
  for (const r of runs) {
    lines.push(`## ${r.name}`, "");
    if (r.skipped.length > 0) {
      lines.push(`Not counted: ${r.skipped.join(", ")}.`, "");
    }
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
    const runs: CountedRun[] = [];
    for (const run of yield* roundRuns(round)) {
      if (yield* fs.exists(path.join(run.dir, "pages"))) {
        runs.push({
          name: `${run.reference}/${path.basename(run.dir)}`,
          ...(yield* runValues(run.dir)),
        });
      }
    }
    const file = path.join(data.runs, round, "off-system.md");
    yield* writeText(file, offSystemTable(round, runs));
    const total = runs.reduce((n, r) => n + r.values.length, 0);
    const skipped = runs.reduce((n, r) => n + r.skipped.length, 0);
    yield* Effect.log(
      `${round}: ${total} values off the system in ${runs.length} runs${skipped > 0 ? `, ${skipped} page${skipped === 1 ? "" : "s"} not counted` : ""}; ${data.fromData(file)}`
    );
  }
});
