/**
 * `tells`: the marks of a generated page counted in rounds' runs, so a skill candidate against
 * them is read without a judge (gaps g53 to g60). Each run's pictures and page source go to one
 * model, which lists every place the page has each mark. Kept in `tells@<model>.json` beside the
 * run; the report, `runs/<name>/tells.md`, says per round how many of each mark a page has and
 * how many pages have one.
 */
import path from "node:path";
import { Effect, FileSystem, Schema } from "effect";
import { EvalsConfig } from "./config.ts";
import { listDir, prompt, readJson, writeJson, writeText } from "./layout.ts";
import { Models } from "./models.ts";

/** A page's source files, as a run keeps them under `pages/`. */
const SOURCE_RE = /\.(tsx|jsx|css|html)$/;

export const TELLS = [
  "eyebrow",
  "numbers",
  "gradientText",
  "iconTiles",
  "sideStripe",
  "glow",
  "borderAndShadow",
  "fragments",
  "buzzwords",
] as const;
export type Tell = (typeof TELLS)[number];

export const Tells = Schema.Struct(
  Object.fromEntries(
    TELLS.map((t) => [t, Schema.Array(Schema.String)])
  ) as Record<Tell, Schema.$Array<Schema.String>>
);
export type Tells = typeof Tells.Type;

const tellsAnswer = {
  decode: Tells,
  schema: {
    additionalProperties: false,
    properties: Object.fromEntries(
      TELLS.map((t) => [t, { items: { type: "string" }, type: "array" }])
    ),
    required: [...TELLS],
    type: "object",
  },
};

/** Per round: each mark's count per page, and the pages that have it at all. */
export const tellsReport = (
  name: string,
  rounds: readonly { readonly round: string; readonly runs: readonly Tells[] }[]
) => {
  const cell = (runs: readonly Tells[], tell: Tell) => {
    if (runs.length === 0) {
      return "–";
    }
    const counts = runs.map((r) => r[tell].length);
    const total = counts.reduce((n, c) => n + c, 0);
    return `${(total / runs.length).toFixed(1)} · ${counts.filter((c) => c > 0).length}/${runs.length}`;
  };
  return [
    `# Tells: ${name}`,
    "",
    "The marks of a generated page, counted by a model in each run's pictures and source: per round, the mean count per page and the pages that have one.",
    "",
    `| Round | Pages | ${TELLS.join(" | ")} |`,
    `| --- | --- | ${TELLS.map(() => "---").join(" | ")} |`,
    ...rounds.map(
      ({ round, runs }) =>
        `| ${round} | ${runs.length} | ${TELLS.map((t) => cell(runs, t)).join(" | ")} |`
    ),
    "",
  ].join("\n");
};

/** A round's runs that have pictures: `<reference>/run-<n>` with `shots/`. */
const runsOf = Effect.fnUntraced(function* (out: string) {
  const fs = yield* FileSystem.FileSystem;
  const runs: string[] = [];
  for (const reference of yield* listDir(out)) {
    const at = path.join(out, reference);
    if ((yield* fs.stat(at)).type !== "Directory") {
      continue;
    }
    for (const run of yield* listDir(at)) {
      if (yield* fs.exists(path.join(at, run, "shots"))) {
        runs.push(path.join(reference, run));
      }
    }
  }
  return runs;
});

export const tells = Effect.fn("tells")(function* (options: {
  readonly concurrency: number;
  readonly effort: string;
  readonly model: string;
  readonly name: string;
  readonly rounds: readonly string[];
}) {
  const { data } = yield* EvalsConfig;
  const fs = yield* FileSystem.FileSystem;
  const models = yield* Models;
  const counted = yield* Effect.forEach(options.rounds, (round) =>
    Effect.gen(function* () {
      const out = path.join(data.runs, round);
      const runs = yield* Effect.forEach(
        yield* runsOf(out),
        (run) =>
          Effect.gen(function* () {
            const dir = path.join(out, run);
            const file = path.join(
              dir,
              `tells@${options.model.replaceAll(/[^\w.-]/g, "-")}.json`
            );
            if (yield* fs.exists(file)) {
              return [yield* readJson(Tells, file)];
            }
            const shots = (yield* listDir(path.join(dir, "shots"))).map((f) =>
              path.join("shots", f)
            );
            const pages = (yield* fs.exists(path.join(dir, "pages")))
              ? (yield* fs.readDirectory(path.join(dir, "pages"), {
                  recursive: true,
                }))
                  .filter((f) => SOURCE_RE.test(f))
                  .map((f) => path.join("pages", f))
              : [];
            const asked = yield* models.ask({
              cwd: dir,
              effort: options.effort,
              images: shots,
              model: options.model,
              prompt: yield* prompt("tells-count", {
                files: [...shots, ...pages].map((f) => `- \`${f}\``).join("\n"),
              }),
              ...tellsAnswer,
            });
            yield* writeJson(file, asked.value);
            yield* Effect.log(
              `${round} ${run}: ${TELLS.map((t) => `${t} ${asked.value[t].length}`).join(", ")}`
            );
            return [asked.value];
          }).pipe(
            Effect.catchTag("EvalsError", (error) =>
              Effect.as(
                Effect.logWarning(
                  `${round} ${run}: not counted: ${error.message}`
                ),
                []
              )
            )
          ),
        { concurrency: options.concurrency }
      );
      return { round, runs: runs.flat() };
    })
  );
  const report = path.join(data.runs, options.name, "tells.md");
  yield* writeText(report, tellsReport(options.name, counted));
  yield* Effect.log(`report: ${data.fromData(report)}`);
});
