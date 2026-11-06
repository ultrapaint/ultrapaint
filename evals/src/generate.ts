/**
 * `generate`: each reference's brief given to an agent in an Ultrapaint thread, as a user would
 * type it, several times, each time on an empty designs directory. What the agent made is kept
 * as the page files and as pictures at the same viewports as the reference's.
 *
 * Then the text the page shows that its brief did not (`added-text.json`), each with a picture of
 * the node around it (`parts/`): what the judge and a person look at for "less is more".
 *
 * The agent is told the skills the way it is in the product: the briefing of its thread. A round
 * with `--skills candidates/<name>` puts those files in the designs directory's `skills/`, where a
 * project's own skills go, so they replace or extend the shipped ones for that round only.
 */
import path from "node:path";
import {
  formatReviewModel,
  Goal,
  type ReviewSettings,
} from "@ultrapaint/contracts/review";
import {
  isEditorMcpCall,
  type ThreadItem,
} from "@ultrapaint/contracts/threads";
import { Duration, Effect, FileSystem, Schedule, Schema } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import {
  ADDED_TEXT_FILE,
  type AddedTextEntry,
  addedTexts,
  pageTexts,
} from "./added-text.ts";
import { Browser } from "./browser.ts";
import { foldName, tileName } from "./capture.ts";
import { EvalsConfig } from "./config.ts";
import { EvalsError } from "./errors.ts";
import {
  listDir,
  prompt,
  readJson,
  readPageFile,
  writeJson,
  writeText,
} from "./layout.ts";
import type { Models } from "./models.ts";
import { writeSkillTree } from "./recall.ts";
import {
  describeViewports,
  familyOf,
  type LoadedReference,
  type Viewport,
  viewportsOf,
} from "./reference.ts";
import {
  type FindingsLog,
  type ReviewIO,
  type ReviewOptions,
  reviewLoop,
} from "./review-loop.ts";
import type { ReviewRequest, SectionToReview } from "./section-review.ts";
import {
  type ReferenceSection,
  readRunSections,
  referenceSections,
  runSections,
  slugOf,
} from "./sections.ts";
import {
  type DesignThread,
  launch,
  openThread,
  resetDesigns,
  rpc,
  type Turn,
  type UltrapaintSession,
} from "./session.ts";

/** `--host family`: each reference in its family's host. */
export const FAMILY_HOST = "family";

/** The frame heights a whole page is looked for at, as multiples of the window's. */
const GROWTH = [2, 4, 9] as const;
/** Past this many, the added texts of a run are listed without their pictures. */
const MAX_PARTS = 30;

export const RoundInfo = Schema.Struct({
  agent: Schema.String,
  commit: Schema.String,
  /** The project the agents designed in, under `hosts/`; absent in rounds from before hosts. */
  host: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  name: Schema.String,
  /** Whether the agents saw the reference's picture as well as its brief. */
  picture: Schema.optional(Schema.Boolean),
  /** The prompt the agents were given, when not the default one. */
  prompt: Schema.optional(Schema.String),
  references: Schema.Array(Schema.String),
  /** How the designs were reviewed in their loop (ADR 0060); absent when they were not. */
  review: Schema.optional(
    Schema.Struct({
      /** When the loop stopped: absent in rounds from before the goal, which had `passes`. */
      eachRound: Schema.optional(Schema.String),
      goal: Schema.optional(Goal),
      mode: Schema.String,
      passes: Schema.optional(Schema.Number),
      reviewers: Schema.Array(Schema.String),
      signOff: Schema.optional(Schema.String),
    })
  ),
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
  /**
   * The editor's own review loop instead of the lab's (`--review editor`, ADR 0063): its
   * settings for the round's project. Off when absent.
   */
  readonly editorReview?: ReviewSettings | undefined;
  /** The project under `hosts/` the agents design in. */
  readonly host: string;
  /** How long one run may take. */
  readonly minutes: number;
  readonly model: string | undefined;
  /** Whether the agent is given the reference's picture with the brief, as a user attaches one. */
  readonly picture: boolean;
  /** The prompt under `prompts/` the agent is given; by default the brief's, or the picture's. */
  readonly prompt?: string | undefined;
  /**
   * Reviewers in the designer's loop (ADR 0060); none by default. With `logFindings`, every pass's
   * findings go to the findings log.
   */
  readonly review?:
    | (ReviewOptions & { readonly logFindings: boolean })
    | undefined;
  readonly round: string;
  readonly runs: number;
  /** A directory of skill files, relative to the data directory, or none for the shipped skills. */
  readonly skills: string | undefined;
}

export const commitOf = Effect.gen(function* () {
  const { checkout } = yield* EvalsConfig;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const head = yield* spawner.string(
    ChildProcess.make("git", ["rev-parse", "--short", "HEAD"], {
      cwd: checkout,
    })
  );
  const dirty = yield* spawner.string(
    ChildProcess.make(
      "git",
      ["status", "--porcelain", "--", "apps", "packages"],
      {
        cwd: checkout,
      }
    )
  );
  return `${head.trim()}${dirty.trim() ? " (with uncommitted changes)" : ""}`;
}).pipe(Effect.orElseSucceed(() => "unknown"));

/** The pictures a run is given of its reference: the fold and its enlarged parts, absolute paths. */
export const referencePictures = Effect.fn("referencePictures")(function* (
  id: string
) {
  const { data } = yield* EvalsConfig;
  const fs = yield* FileSystem.FileSystem;
  const dir = data.captureDir(id);
  return (yield* fs.readDirectory(dir))
    .filter((f) => f === "desktop-fold.jpg" || ZOOM.test(f))
    .sort()
    .map((f) => path.join(dir, f));
});

/** The reference's pictures as a user attaches a screenshot. */
const referenceImages = Effect.fn("referenceImages")(function* (
  pictures: readonly string[]
) {
  const fs = yield* FileSystem.FileSystem;
  const images: { readonly dataUrl: string; readonly name: string }[] = [];
  for (const file of pictures) {
    const bytes = yield* fs.readFile(file);
    images.push({
      dataUrl: `data:image/jpeg;base64,${Buffer.from(bytes).toString("base64")}`,
      name: path.basename(file),
    });
  }
  return images;
});
const ZOOM = /^zoom-\d+\.jpg$/;

/** The candidate skill files, put where a project's own skills go. */
const placeSkills = Effect.fn("placeSkills")(function* (
  designs: string,
  skills: string | undefined
) {
  const { data } = yield* EvalsConfig;
  if (skills === undefined) {
    return;
  }
  const fs = yield* FileSystem.FileSystem;
  const from = path.resolve(data.root, skills);
  // A candidate's `SKILL.md` is the router, which a project's skills cannot replace: only
  // `recall` reads it.
  const files = (yield* listDir(from)).filter(
    (f) => f.endsWith(".md") && f !== "SKILL.md"
  );
  if (files.length === 0) {
    return yield* new EvalsError({ message: `no skill files in ${skills}` });
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
  const { data } = yield* EvalsConfig;
  const list = yield* rpc(
    "listing the skills",
    session.client["skills.list"]()
  );
  for (const skill of list.skills.filter((s) => s.enabled)) {
    yield* writeText(
      path.join(data.runs, round, "skills", `${skill.name}.md`),
      `${skill.text.trim()}\n`
    );
  }
});

export const traceOf = (items: readonly ThreadItem[]) =>
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
      for (const entry of item.usage.byModel ?? []) {
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
  /** The page each viewport is drawn from: its URL, or a variant's file. */
  pageFor: (viewport: Viewport) => string,
  viewports: readonly Viewport[],
  dir: string
) {
  const fs = yield* FileSystem.FileSystem;
  const browser = yield* Browser;
  const problems: string[] = [];
  yield* fs.makeDirectory(dir, { recursive: true });
  for (const viewport of viewports) {
    const route = pageFor(viewport);
    const shoot = (height: number) =>
      Effect.gen(function* () {
        const framed = yield* session.tool("set_frame", {
          height,
          route,
          width: viewport.width,
        });
        if (framed.isError) {
          return yield* new EvalsError({
            message: `set_frame: ${framed.text}`,
          });
        }
        const shot = yield* session.tool("get_screenshot", { route });
        const [png] = shot.images;
        if (shot.isError || !png) {
          return yield* new EvalsError({
            message: `get_screenshot at ${viewport.width}px: ${shot.text}`,
          });
        }
        return png;
      }).pipe(
        // A heavy page can miss the preview's render deadline once and draw the next time.
        Effect.retry({
          schedule: Schedule.spaced(Duration.seconds(3)),
          times: 2,
        })
      );
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
      Effect.catchTag("EvalsError", (e) =>
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

/**
 * The texts the page shows that the brief does not, each with a picture of the node around it,
 * drawn at the first viewport the reference has.
 */
const recordAddedText = Effect.fn("recordAddedText")(function* (
  session: UltrapaintSession,
  options: {
    readonly brief: string;
    readonly dir: string;
    readonly file: string;
    readonly route: string;
    readonly viewport: Viewport;
  }
) {
  const fs = yield* FileSystem.FileSystem;
  const page = yield* readPageFile(path.join(session.root, options.file));
  const added = addedTexts(pageTexts(page), options.brief);
  yield* session.tool("set_frame", {
    height: options.viewport.height,
    route: options.route,
    width: options.viewport.width,
  });
  const pictures = new Map<string, string>();
  for (const parent of [...new Set(added.map((a) => a.parent))].slice(
    0,
    MAX_PARTS
  )) {
    const shot = yield* session.tool("get_screenshot", {
      node: parent,
      route: options.route,
      width: options.viewport.width,
    });
    const [png] = shot.images;
    if (!shot.isError && png) {
      const file = path.join("parts", `${parent}.png`);
      yield* fs.makeDirectory(path.join(options.dir, "parts"), {
        recursive: true,
      });
      yield* fs.writeFile(path.join(options.dir, file), png);
      pictures.set(parent, file);
    }
  }
  const entries: AddedTextEntry[] = added.map((a, index) => {
    const picture = pictures.get(a.parent);
    return { index: index + 1, ...a, ...(picture && { picture }) };
  });
  yield* writeJson(path.join(options.dir, ADDED_TEXT_FILE), entries);
  return entries;
});

/** The page a run made: the one at `/`, else the first with a URL, and how each viewport draws it. */
const homeOf = Effect.fn("homeOf")(function* (session: UltrapaintSession) {
  const list = yield* rpc("listing pages", session.client["pages.list"]());
  const routed = list.pages.filter(
    (p) => p.route !== undefined && !p.variant && !p.state
  );
  const main = routed.find((p) => p.route === "/") ?? routed[0];
  const home = main?.route;
  // A viewport is drawn from the variant made for it (`sign-in@mobile`) when there is one: that is
  // how a page's phone design is kept apart in Ultrapaint.
  const pageFor = (viewport: Viewport) =>
    list.pages.find((p) => p.route === home && p.variant === viewport.name)
      ?.file ??
    home ??
    "/";
  return { home, list, main, pageFor };
});

/** The page's file as it is now, kept in `dir/pages/` for the reviewers to read. */
const keepPage = Effect.fn("keepPage")(function* (
  session: UltrapaintSession,
  file: string,
  dir: string
) {
  const fs = yield* FileSystem.FileSystem;
  const pages = path.join(dir, "pages");
  yield* fs.makeDirectory(pages, { recursive: true });
  yield* fs.copyFile(
    path.join(session.root, file),
    path.join(pages, path.basename(file))
  );
  return pages;
});

/**
 * How the review loop sees the run's page: cut into the reference's sections from its pictures at
 * the desktop width, or one node of it as the editor draws it.
 */
const reviewIO = (
  session: UltrapaintSession,
  thread: DesignThread,
  options: {
    readonly judgeModel: string;
    readonly log: FindingsLog | undefined;
    readonly marked: readonly ReferenceSection[];
    readonly request: ReviewRequest;
    readonly tree: string;
    readonly viewport: Viewport;
  }
): ReviewIO<Browser | EvalsConfig | FileSystem.FileSystem | Models> => {
  const { viewport } = options;
  const failed = (what: string) => (error: unknown) =>
    Effect.as(Effect.logWarning(`${what}: ${String(error)}`), undefined);
  return {
    log: options.log,
    nodeSection: (node, name, dir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const at = yield* homeOf(session);
        if (!at.main) {
          return;
        }
        const route = at.pageFor(viewport);
        yield* session.tool("set_frame", {
          height: viewport.height,
          route,
          width: viewport.width,
        });
        const shot = yield* session.tool("get_screenshot", {
          node,
          route,
          width: viewport.width,
        });
        const [png] = shot.images;
        if (shot.isError || !png) {
          yield* Effect.logWarning(`node ${node}: ${shot.text}`);
          return;
        }
        const picture = path.join(dir, `${slugOf(name) || "section"}.png`);
        yield* fs.makeDirectory(dir, { recursive: true });
        yield* fs.writeFile(picture, png);
        return {
          name,
          node,
          pages: yield* keepPage(session, at.main.file, dir),
          picture,
          where: `The part of the page the designer built as node \`${node}\` and named "${name}".`,
        } satisfies SectionToReview;
      }).pipe(Effect.catch(failed(`node ${node} not pictured`))),
    pageSections: (dir) =>
      Effect.gen(function* () {
        const at = yield* homeOf(session);
        if (!at.main) {
          return [];
        }
        const problems = yield* photograph(
          session,
          at.pageFor,
          [viewport],
          path.join(dir, "shots")
        );
        if (problems.length > 0) {
          yield* Effect.logWarning(problems.join("; "));
        }
        const pages = yield* keepPage(session, at.main.file, dir);
        yield* runSections(dir, options.marked, options.judgeModel);
        const crops = yield* readRunSections(dir);
        return options.marked.flatMap((s) => {
          const picture = crops.get(s.name);
          return picture === undefined
            ? []
            : [{ name: s.name, pages, picture, where: s.what }];
        });
      }).pipe(
        Effect.catch((error) =>
          Effect.as(
            Effect.logWarning(
              `the page not cut into sections: ${String(error)}`
            ),
            []
          )
        )
      ),
    request: options.request,
    thread,
    tree: options.tree,
  };
};

/** The designer's turns: one prompt, or the review loop after it when the round reviews. */
const designTurns = Effect.fn("designTurns")(function* (
  session: UltrapaintSession,
  reference: LoadedReference,
  dir: string,
  first: {
    readonly images: readonly {
      readonly dataUrl: string;
      readonly name: string;
    }[];
    readonly text: string;
  },
  /** What the designer was asked, which the reviewers keep to. */
  request: ReviewRequest,
  options: GenerateOptions
) {
  const { data, findings } = yield* EvalsConfig;
  const thread = yield* openThread(session, {
    agent: options.agent,
    minutes: options.minutes,
    model: options.model,
  });
  const { review } = options;
  const text =
    review?.mode === "each-section"
      ? `${first.text.trim()}\n\n${yield* prompt("review-each-section", {})}`
      : first.text;
  const turn = yield* thread.send(text, first.images);
  if (review === undefined) {
    return [turn] as readonly Turn[];
  }
  const viewports = viewportsOf(reference);
  const viewport = viewports.find((v) => v.name === "desktop") ?? viewports[0];
  if (viewport === undefined) {
    return [turn] as readonly Turn[];
  }
  const io = reviewIO(session, thread, {
    judgeModel: review.judgeModel,
    log: review.logFindings
      ? {
          file: path.join(findings, "lab.jsonl"),
          page: reference.id,
          project: `lab/${options.round}`,
          skill: yield* commitOf,
        }
      : undefined,
    marked: yield* referenceSections(reference.id, {
      force: false,
      model: review.judgeModel,
    }),
    request,
    // The skill as the designer was briefed with it, read without the editor's tools.
    tree: yield* writeSkillTree(
      path.join(data.runs, options.round, "review-skill"),
      options.skills ?? "built-in"
    ),
    viewport,
  });
  return (yield* reviewLoop(turn, io, review, dir)).turns;
});

const runOnce = Effect.fn("runOnce")(function* (
  session: UltrapaintSession,
  reference: LoadedReference,
  run: number,
  options: GenerateOptions
) {
  const { data } = yield* EvalsConfig;
  const fs = yield* FileSystem.FileSystem;
  const dir = data.runDir(options.round, reference.id, run);
  yield* fs.remove(dir, { force: true, recursive: true });
  yield* resetDesigns(session);
  yield* placeSkills(session.designs, options.skills);

  const brief = yield* fs.readFileString(data.briefFile(reference.id));
  const viewports = viewportsOf(reference);
  const pictures = options.picture
    ? yield* referencePictures(reference.id)
    : [];
  const images = yield* referenceImages(pictures);
  const turns = yield* Effect.scoped(
    designTurns(
      session,
      reference,
      dir,
      {
        images,
        text: yield* prompt(
          options.prompt ?? (options.picture ? "generate-picture" : "generate"),
          {
            brief: brief.trim(),
            viewports: describeViewports(viewports),
          }
        ),
      },
      { brief, pictures },
      options
    )
  );
  const items = turns.flatMap((t) => t.items);
  const seconds = turns.reduce((n, t) => n + t.seconds, 0);

  const { home, list, main, pageFor } = yield* homeOf(session);
  const problems = turns.flatMap((t) => (t.problem ? [t.problem] : []));
  yield* fs.makeDirectory(path.join(dir, "pages"), { recursive: true });
  for (const page of list.pages) {
    yield* fs.copyFile(
      path.join(session.root, page.file),
      path.join(dir, "pages", path.basename(page.file))
    );
  }
  if (home) {
    problems.push(
      ...(yield* photograph(
        session,
        pageFor,
        viewports,
        path.join(dir, "shots")
      ))
    );
    const [first] = viewports;
    const file = list.pages.find(
      (p) => p.route === home && p.variant === first?.name
    )?.file;
    if (first && main) {
      const added = yield* recordAddedText(session, {
        brief,
        dir,
        file: file ?? main.file,
        route: pageFor(first),
        viewport: first,
      }).pipe(
        Effect.catch((e) =>
          Effect.sync(() => {
            problems.push(`added text not recorded: ${String(e)}`);
            return [];
          })
        )
      );
      yield* Effect.log(
        `${reference.id} run ${run}: ${added.length} texts not in the brief, ${added.reduce((n, a) => n + a.words, 0)} words`
      );
    }
  } else {
    problems.push(
      "the agent made no page with a URL, so there is nothing to look at"
    );
  }

  const said = items
    .filter((i) => i.kind === "agent")
    .map((i) => (i.kind === "agent" ? i.text : ""))
    .join("\n\n");
  yield* writeText(path.join(dir, "agent.md"), `${said.trim()}\n`);
  yield* writeText(path.join(dir, "trace.md"), `${traceOf(items)}\n`);
  const info: RunInfo = {
    ...infoOf(options.agent, items, seconds),
    pages: list.pages.map((p) =>
      p.variant || p.state || !p.route ? p.file : p.route
    ),
    problems,
  };
  yield* writeJson(path.join(dir, "run.json"), info);
  // The editor's review rounds, as its transcript holds them (`--review editor`).
  const rounds = items.filter((i) => i.kind === "review");
  if (rounds.length > 0) {
    yield* writeJson(path.join(dir, "editor-review.json"), rounds);
  }
  yield* Effect.log(
    `${reference.id} run ${run}: ${info.toolCalls} tool calls, ${info.seconds}s, ${(info.tokens / 1000).toFixed(0)}k tokens${problems.length > 0 ? `; ${problems.join("; ")}` : ""}`
  );
});

/** The skills a round is told, and how when it is not the default (`EVAL_SKILLS_BRIEFING`). */
const skillsOfRound = (
  options: GenerateOptions,
  briefing: string | undefined
) => {
  const skills = options.skills ?? "built-in";
  return briefing === undefined ? skills : `${skills} (${briefing})`;
};

/**
 * The round's record, written when it starts; a round run again must be the same round: one host,
 * one set of skills, the picture or not. Resumed with others, it would compare nothing.
 */
const startRound = Effect.fn("startRound")(function* (
  references: readonly LoadedReference[],
  options: GenerateOptions
) {
  const { data, skillsBriefing } = yield* EvalsConfig;
  const fs = yield* FileSystem.FileSystem;
  const roundFile = path.join(data.runs, options.round, "round.json");
  if (yield* fs.exists(roundFile)) {
    const before = yield* readJson(RoundInfo, roundFile);
    const skills = skillsOfRound(options, skillsBriefing);
    if (
      before.host !== options.host ||
      before.skills !== skills ||
      (before.picture ?? false) !== options.picture
    ) {
      return yield* new EvalsError({
        message: `round ${options.round} was started with host ${before.host ?? "none"} and skills ${before.skills}; name a new round for host ${options.host} and skills ${skills}`,
      });
    }
    if ((before.review?.mode ?? "none") !== (options.review?.mode ?? "none")) {
      return yield* new EvalsError({
        message: `round ${options.round} was started with review ${before.review?.mode ?? "none"}; name a new round to review ${options.review?.mode ?? "none"}`,
      });
    }
  } else {
    yield* writeJson(roundFile, {
      agent: options.agent,
      commit: yield* commitOf,
      host: options.host,
      ...(options.model !== undefined && { model: options.model }),
      name: options.round,
      ...(options.picture && { picture: true }),
      ...(options.prompt !== undefined && { prompt: options.prompt }),
      references: references.map((r) => r.id),
      ...(options.review && {
        review: {
          eachRound: options.review.eachRound,
          goal: options.review.goal,
          mode: options.review.mode,
          reviewers: options.review.reviewers,
          signOff: options.review.signOff,
        },
      }),
      ...(options.editorReview?.on && {
        review: {
          eachRound: options.editorReview.eachRound,
          goal: options.editorReview.goal,
          mode: "editor",
          reviewers: (options.editorReview.reviewModels ?? []).map(
            formatReviewModel
          ),
          signOff: options.editorReview.approval,
        },
      }),
      runs: options.runs,
      skills: skillsOfRound(options, skillsBriefing),
      startedAt: new Date().toISOString(),
    } satisfies RoundInfo);
  }
});

export const generate = Effect.fn("generate")(function* (
  references: readonly LoadedReference[],
  options: GenerateOptions
) {
  const { data } = yield* EvalsConfig;
  const fs = yield* FileSystem.FileSystem;
  for (const reference of references) {
    if (!(yield* fs.exists(data.briefFile(reference.id)))) {
      return yield* new EvalsError({
        message: `${reference.id} has no brief: run brief ${reference.id} and read it first`,
      });
    }
  }
  yield* startRound(references, options);

  // A run with its run.json is done: a round run again picks up where it stopped.
  const pending: {
    readonly reference: LoadedReference;
    readonly run: number;
  }[] = [];
  for (const reference of references) {
    for (let run = 1; run <= options.runs; run += 1) {
      const done = yield* fs.exists(
        path.join(data.runDir(options.round, reference.id, run), "run.json")
      );
      if (!done) {
        pending.push({ reference, run });
      }
    }
  }
  if (pending.length === 0) {
    return yield* Effect.log("every run was generated before");
  }
  // `--host family`: each reference is designed with its family's library (`hosts/<family>`,
  // frozen from track A), one server per family.
  const hostOf = (reference: LoadedReference) =>
    options.host === FAMILY_HOST ? familyOf(reference) : options.host;
  const hosts = [...new Set(pending.map((p) => hostOf(p.reference)))];
  for (const [index, host] of hosts.entries()) {
    yield* Effect.scoped(
      Effect.gen(function* () {
        const session = yield* launch(host, "scratch", options.editorReview);
        yield* resetDesigns(session);
        yield* placeSkills(session.designs, options.skills);
        if (index === 0) {
          yield* recordSkills(session, options.round);
        }
        for (const { reference, run } of pending.filter(
          (p) => hostOf(p.reference) === host
        )) {
          yield* runOnce(session, reference, run, options);
        }
      })
    );
  }
  yield* Effect.log(
    `generated: ${data.fromData(path.join(data.runs, options.round))}`
  );
});
