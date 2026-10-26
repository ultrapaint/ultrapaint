/**
 * `generate`: each reference's brief given to an agent in an ultrapaint thread, as a user would
 * type it, several times, each time on an empty designs directory. What the agent made is kept
 * as the page files and as pictures at the same viewports as the reference's.
 *
 * The agent is told the skills the way it is in the product: the briefing of its thread. A round
 * with `--skills candidates/<name>` puts those files in the designs directory's `skills/`, where a
 * project's own skills go, so they replace or extend the shipped ones for that round only.
 */
import path from "node:path";
import { Effect, FileSystem, Schema } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import {
  isEditorMcpCall,
  type ThreadItem,
} from "../../../packages/contracts/src/threads.ts";
import { Browser } from "./browser.ts";
import { foldName, tileName } from "./capture.ts";
import {
  type UltrapaintSession,
  launch,
  resetDesigns,
  rpc,
  runPrompt,
} from "./ultrapaint.ts";
import { LabError } from "./errors.ts";
import {
  briefFile,
  fromLab,
  LAB,
  listDir,
  prompt,
  REPO,
  RUNS,
  runDir,
  writeJson,
  writeText,
} from "./layout.ts";
import { type LoadedReference, VIEWPORTS } from "./reference.ts";

/** The frame heights a whole page is looked for at, as multiples of the window's. */
const GROWTH = [2, 4, 9] as const;

export const RoundInfo = Schema.Struct({
  agent: Schema.String,
  commit: Schema.String,
  model: Schema.optional(Schema.String),
  name: Schema.String,
  references: Schema.Array(Schema.String),
  runs: Schema.Number,
  /** `built-in`, or the candidates directory the round tried. */
  skills: Schema.String,
  startedAt: Schema.String,
});
export type RoundInfo = typeof RoundInfo.Type;

export const RunInfo = Schema.Struct({
  agent: Schema.String,
  mcpCalls: Schema.Number,
  /** The models the agent's turn went to, by tokens. */
  models: Schema.Record(Schema.String, Schema.Number),
  pages: Schema.Array(Schema.String),
  problems: Schema.Array(Schema.String),
  seconds: Schema.Number,
  tokens: Schema.Number,
  toolCalls: Schema.Number,
});
export type RunInfo = typeof RunInfo.Type;

export interface GenerateOptions {
  readonly agent: string;
  /** How long one run may take. */
  readonly minutes: number;
  readonly model: string | undefined;
  readonly round: string;
  readonly runs: number;
  /** A directory of skill files, relative to the lab, or none for the shipped skills. */
  readonly skills: string | undefined;
}

const commitOf = Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const head = yield* spawner.string(
    ChildProcess.make("git", ["rev-parse", "--short", "HEAD"], { cwd: REPO })
  );
  const dirty = yield* spawner.string(
    ChildProcess.make(
      "git",
      ["status", "--porcelain", "--", "apps", "packages"],
      {
        cwd: REPO,
      }
    )
  );
  return `${head.trim()}${dirty.trim() ? " (with uncommitted changes)" : ""}`;
}).pipe(Effect.orElseSucceed(() => "unknown"));

/** The candidate skill files, put where a project's own skills go. */
const placeSkills = Effect.fn("placeSkills")(function* (
  designs: string,
  skills: string | undefined
) {
  if (skills === undefined) {
    return;
  }
  const fs = yield* FileSystem.FileSystem;
  const from = path.resolve(LAB, skills);
  const files = (yield* listDir(from)).filter((f) => f.endsWith(".md"));
  if (files.length === 0) {
    return yield* new LabError({ message: `no skill files in ${skills}` });
  }
  yield* fs.makeDirectory(path.join(designs, "skills"), { recursive: true });
  for (const file of files) {
    yield* fs.copyFile(
      path.join(from, file),
      path.join(designs, "skills", file)
    );
  }
});

/** The skills as agents are told them this round, one file each, for the judge and the report. */
const recordSkills = Effect.fn("recordSkills")(function* (
  session: UltrapaintSession,
  round: string
) {
  const list = yield* rpc(
    "listing the skills",
    session.client["skills.list"]()
  );
  for (const skill of list.skills.filter((s) => s.enabled)) {
    yield* writeText(
      path.join(RUNS, round, "skills", `${skill.name}.md`),
      `${skill.text.trim()}\n`
    );
  }
});

const traceOf = (items: readonly ThreadItem[]) =>
  items
    .flatMap((item) => {
      if (item.kind === "tool") {
        const said =
          item.status === "failed"
            ? `\n  → ${item.content
                .map((c) => ("text" in c ? c.text : ""))
                .join(" ")
                .replace(/\s+/g, " ")
                .slice(0, 300)}`
            : "";
        return [
          `- ${item.status === "failed" ? "✗" : "·"} ${item.title}${said}`,
        ];
      }
      if (item.kind === "question") {
        return [
          `- ? asked: ${item.questions.map((q) => q.question).join(" / ")} (answered with the first option)`,
        ];
      }
      return [];
    })
    .join("\n");

const infoOf = (
  agent: string,
  items: readonly ThreadItem[],
  seconds: number
) => {
  const tools = items.filter((i) => i.kind === "tool");
  const models: Record<string, number> = {};
  let tokens = 0;
  for (const item of items) {
    if (item.kind === "turn_end" && item.usage) {
      tokens += item.usage.totalTokens;
      for (const entry of item.usage.byModel) {
        models[entry.model] = (models[entry.model] ?? 0) + entry.tokens;
      }
    }
  }
  return {
    agent,
    mcpCalls: tools.filter((t) => t.kind === "tool" && isEditorMcpCall(t.title))
      .length,
    models,
    seconds: Math.round(seconds),
    tokens,
    toolCalls: tools.length,
  };
};

/** The page's pictures at every viewport: the fold, then the whole page in tiles. */
const photograph = Effect.fn("photograph")(function* (
  session: UltrapaintSession,
  route: string,
  dir: string
) {
  const fs = yield* FileSystem.FileSystem;
  const browser = yield* Browser;
  const problems: string[] = [];
  yield* fs.makeDirectory(dir, { recursive: true });
  for (const viewport of VIEWPORTS) {
    const shoot = (height: number) =>
      Effect.gen(function* () {
        const framed = yield* session.tool("set_frame", {
          height,
          route,
          width: viewport.width,
        });
        if (framed.isError) {
          return yield* new LabError({ message: `set_frame: ${framed.text}` });
        }
        const shot = yield* session.tool("get_screenshot", { route });
        const [png] = shot.images;
        if (shot.isError || !png) {
          return yield* new LabError({
            message: `get_screenshot at ${viewport.width}px: ${shot.text}`,
          });
        }
        return png;
      });
    /**
     * The whole page: the frame grows until the content ends above its bottom. A page whose
     * top moves as the frame grows is drawn to the window's size (a full-height layout), so its
     * window is the whole of it.
     */
    const whole = Effect.gen(function* () {
      const first = yield* shoot(viewport.height);
      let previous = first;
      if ((yield* browser.compare(first, null, viewport.width)).blankBottom) {
        return { first, page: first };
      }
      for (const times of GROWTH) {
        const png = yield* shoot(viewport.height * times);
        const seen = yield* browser.compare(png, previous, viewport.width);
        if (!seen.sameTop) {
          return { first, page: previous };
        }
        previous = png;
        if (seen.blankBottom) {
          break;
        }
      }
      return { first, page: previous };
    });
    const { fold, tiles } = yield* whole.pipe(
      Effect.flatMap(({ first, page }) =>
        Effect.all({
          fold: browser.cut(first, viewport, false),
          tiles: browser.cut(page, viewport, true),
        })
      ),
      Effect.catchTag("LabError", (e) =>
        Effect.sync(() => {
          problems.push(e.message);
          return { fold: [], tiles: [] };
        })
      )
    );
    if (fold[0]) {
      yield* fs.writeFile(path.join(dir, foldName(viewport.name)), fold[0]);
    }
    yield* Effect.forEach(tiles, (tile, index) =>
      fs.writeFile(path.join(dir, tileName(viewport.name, index)), tile)
    );
  }
  return problems;
});

const runOnce = Effect.fn("runOnce")(function* (
  session: UltrapaintSession,
  reference: LoadedReference,
  run: number,
  options: GenerateOptions
) {
  const fs = yield* FileSystem.FileSystem;
  const dir = runDir(options.round, reference.id, run);
  if (yield* fs.exists(path.join(dir, "run.json"))) {
    yield* Effect.log(`${reference.id} run ${run}: done before, kept`);
    return;
  }
  yield* fs.remove(dir, { force: true, recursive: true });
  yield* resetDesigns(session.designs);
  yield* placeSkills(session.designs, options.skills);

  const brief = yield* fs.readFileString(briefFile(reference.id));
  const turn = yield* Effect.scoped(
    runPrompt(session, {
      agent: options.agent,
      minutes: options.minutes,
      model: options.model,
      text: yield* prompt("generate", { brief: brief.trim() }),
    })
  );

  const list = yield* rpc("listing pages", session.client["pages.list"]());
  const routed = list.pages.filter(
    (p) => p.route !== undefined && !p.variant && !p.state
  );
  const main = routed.find((p) => p.route === "/") ?? routed[0];
  const problems = turn.problem ? [turn.problem] : [];
  yield* fs.makeDirectory(path.join(dir, "pages"), { recursive: true });
  for (const page of list.pages) {
    yield* fs.copyFile(
      path.join(REPO, page.file),
      path.join(dir, "pages", path.basename(page.file))
    );
  }
  if (main?.route) {
    problems.push(
      ...(yield* photograph(session, main.route, path.join(dir, "shots")))
    );
  } else {
    problems.push(
      "the agent made no page with a URL, so there is nothing to look at"
    );
  }

  const said = turn.items
    .filter((i) => i.kind === "agent")
    .map((i) => (i.kind === "agent" ? i.text : ""))
    .join("\n\n");
  yield* writeText(path.join(dir, "agent.md"), `${said.trim()}\n`);
  yield* writeText(path.join(dir, "trace.md"), `${traceOf(turn.items)}\n`);
  const info: RunInfo = {
    ...infoOf(options.agent, turn.items, turn.seconds),
    pages: list.pages.map((p) => p.route ?? p.file),
    problems,
  };
  yield* writeJson(path.join(dir, "run.json"), info);
  yield* Effect.log(
    `${reference.id} run ${run}: ${info.toolCalls} tool calls, ${info.seconds}s, ${(info.tokens / 1000).toFixed(0)}k tokens${problems.length > 0 ? `; ${problems.join("; ")}` : ""}`
  );
});

export const generate = Effect.fn("generate")(function* (
  references: readonly LoadedReference[],
  options: GenerateOptions
) {
  const fs = yield* FileSystem.FileSystem;
  for (const reference of references) {
    if (!(yield* fs.exists(briefFile(reference.id)))) {
      return yield* new LabError({
        message: `${reference.id} has no brief: run brief ${reference.id} and read it first`,
      });
    }
  }
  const roundFile = path.join(RUNS, options.round, "round.json");
  if (!(yield* fs.exists(roundFile))) {
    yield* writeJson(roundFile, {
      agent: options.agent,
      commit: yield* commitOf,
      ...(options.model !== undefined && { model: options.model }),
      name: options.round,
      references: references.map((r) => r.id),
      runs: options.runs,
      skills: options.skills ?? "built-in",
      startedAt: new Date().toISOString(),
    } satisfies RoundInfo);
  }

  yield* Effect.scoped(
    Effect.gen(function* () {
      const session = yield* launch("default");
      yield* resetDesigns(session.designs);
      yield* placeSkills(session.designs, options.skills);
      yield* recordSkills(session, options.round);
      for (const reference of references) {
        for (let run = 1; run <= options.runs; run += 1) {
          yield* runOnce(session, reference, run, options);
        }
      }
    })
  );
  yield* Effect.log(`generated: ${fromLab(path.join(RUNS, options.round))}`);
});
