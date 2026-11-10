/**
 * A round's runs in a host outside the editor (ADR 0069's outside run): the skill installed in a
 * plain app as any project installs it (`.agents/skills/ultrapaint/` and
 * `.claude/skills/ultrapaint/`), and the agent's own command asked to build a reference's screen
 * there, never told the skill's name. It says whether the skill is found, read and followed
 * where Ultrapaint tells nobody about it.
 *
 * A host is outside when its directory has a `host.json` of kind `outside`. Each run works in a
 * copy of the host's app, and is written where an editor round's is: its pictures in `shots/`,
 * its source in `pages/`, what the agent ran in `trace.md` and said in `agent.md`, its events as
 * they came in `events.jsonl`. So `judge`, `panel`, `pairwise` and `review` read it as any run.
 *
 * The agent and the app's dev server are stopped through the handle that started them, their
 * whole process group with them.
 */
import path from "node:path";
import {
  Clock,
  DateTime,
  Deferred,
  Duration,
  Effect,
  Fiber,
  FileSystem,
  Option,
  Schema,
  Stream,
} from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { Browser } from "./browser.ts";
import { foldName, tileName } from "./capture.ts";
import { EvalsConfig } from "./config.ts";
import { EvalsError } from "./errors.ts";
import { commitOf, RoundInfo, type RunInfo } from "./generate.ts";
import { prompt, readJson, writeJson, writeText } from "./layout.ts";
import { versionName, writeSkillTree } from "./recall.ts";
import {
  describeViewports,
  type LoadedReference,
  viewportsOf,
} from "./reference.ts";

/** What makes a host one the agents work in outside the editor: `hosts/<host>/host.json`. */
export const OutsideHost = Schema.Struct({
  /** The file the agent is asked to build the screen in, from the app's root. */
  entry: Schema.String,
  kind: Schema.Literal("outside"),
  /** The installed packages every copy of the app links to, from the host's directory. */
  modules: Schema.String,
});
export type OutsideHost = typeof OutsideHost.Type;

export const HOST_FILE = "host.json";
/** No skill installed: the baseline a round with the skill is set against. */
export const NO_SKILL = "none";
/** Where a project installs a skill for Codex and for Claude Code. */
export const SKILL_DIRS = [
  path.join(".agents", "skills", "ultrapaint"),
  path.join(".claude", "skills", "ultrapaint"),
] as const;

/** The agents that have a command of their own to run outside the editor. */
export const OUTSIDE_AGENTS = ["claude-code", "codex"] as const;
export type OutsideAgent = (typeof OUTSIDE_AGENTS)[number];

/** The host's `host.json` when it is one outside the editor; none for an Ultrapaint project. */
export const outsideHostOf = Effect.fn("outsideHostOf")(function* (
  host: string
) {
  const { data } = yield* EvalsConfig;
  const fs = yield* FileSystem.FileSystem;
  const file = path.join(data.hostDir(host), HOST_FILE);
  return (yield* fs.exists(file))
    ? Option.some(yield* readJson(OutsideHost, file))
    : Option.none();
});

/** The agent's own command for one prompt in an app, with every permission it asks for. */
export const agentCommand = (
  agent: OutsideAgent,
  input: {
    readonly cwd: string;
    readonly model: string | undefined;
    readonly prompt: string;
  }
): { readonly args: readonly string[]; readonly command: string } =>
  agent === "codex"
    ? {
        args: [
          "exec",
          input.prompt,
          "--json",
          "--dangerously-bypass-approvals-and-sandbox",
          "--skip-git-repo-check",
          "-C",
          input.cwd,
          ...(input.model ? ["--model", input.model] : []),
        ],
        command: "codex",
      }
    : {
        args: [
          "-p",
          input.prompt,
          "--output-format",
          "stream-json",
          "--verbose",
          "--permission-mode",
          "bypassPermissions",
          // The project's settings alone: the person's own skills and CLAUDE.md stay out of it.
          "--setting-sources",
          "project",
          ...(input.model ? ["--model", input.model] : []),
        ],
        command: "claude",
      };

/** What an agent's events say of its run. */
export interface AgentRun {
  readonly mcpCalls: number;
  /** The model the events name, when they do. */
  readonly model: string | undefined;
  readonly said: string;
  readonly tokens: number;
  readonly toolCalls: number;
  /** A line per tool call, as a round's `trace.md` holds them: `- · ` done, `- ✗ ` failed. */
  readonly trace: readonly string[];
}

const CodexEvent = Schema.Struct({
  item: Schema.optional(
    Schema.Struct({
      changes: Schema.optional(
        Schema.Array(
          Schema.Struct({
            kind: Schema.optional(Schema.String),
            path: Schema.optional(Schema.String),
          })
        )
      ),
      command: Schema.optional(Schema.String),
      exit_code: Schema.optional(Schema.NullOr(Schema.Number)),
      query: Schema.optional(Schema.String),
      server: Schema.optional(Schema.String),
      text: Schema.optional(Schema.String),
      tool: Schema.optional(Schema.String),
      type: Schema.optional(Schema.String),
    })
  ),
  type: Schema.optional(Schema.String),
  usage: Schema.optional(
    Schema.Struct({
      input_tokens: Schema.optional(Schema.Number),
      output_tokens: Schema.optional(Schema.Number),
    })
  ),
});
const decodeCodex = Schema.decodeUnknownOption(
  Schema.fromJsonString(CodexEvent)
);

const mark = (wrong: boolean) => (wrong ? "- ✗ " : "- · ");

/** A run of `codex exec --json`, from its lines: the items it completed and what its turns used. */
export const readCodexEvents = (
  lines: readonly string[],
  app: string
): AgentRun => {
  const events = lines
    .filter((line) => line.startsWith("{"))
    .flatMap((line) => Option.toArray(decodeCodex(line)));
  const items = events.flatMap((e) =>
    e.type === "item.completed" && e.item ? [e.item] : []
  );
  const trace = items.flatMap((item) => {
    switch (item.type) {
      case "command_execution":
        return [
          `${mark(item.exit_code !== undefined && item.exit_code !== null && item.exit_code !== 0)}${item.command ?? ""}`,
        ];
      case "file_change":
        return [
          `- · edit ${(item.changes ?? [])
            .map((c) => `${c.kind ?? ""} ${c.path ?? ""}`.trim())
            .join(", ")
            .replaceAll(`${app}${path.sep}`, "")}`,
        ];
      case "mcp_tool_call":
        return [`- · mcp.${item.server ?? ""}.${item.tool ?? ""}`];
      case "web_search":
        return [`- · Web search: ${item.query ?? ""}`];
      default:
        return [];
    }
  });
  return {
    mcpCalls: items.filter((i) => i.type === "mcp_tool_call").length,
    model: undefined,
    said: items
      .flatMap((i) => (i.type === "agent_message" && i.text ? [i.text] : []))
      .join("\n\n"),
    tokens: events
      .filter((e) => e.type === "turn.completed")
      .reduce(
        (n, e) =>
          n + (e.usage?.input_tokens ?? 0) + (e.usage?.output_tokens ?? 0),
        0
      ),
    toolCalls: items.filter((i) => i.type === "command_execution").length,
    trace,
  };
};

const ClaudeEvent = Schema.Struct({
  message: Schema.optional(
    Schema.Struct({
      content: Schema.optional(
        Schema.Array(
          Schema.Struct({
            id: Schema.optional(Schema.String),
            input: Schema.optional(
              Schema.Record(Schema.String, Schema.Unknown)
            ),
            is_error: Schema.optional(Schema.Boolean),
            name: Schema.optional(Schema.String),
            text: Schema.optional(Schema.String),
            tool_use_id: Schema.optional(Schema.String),
            type: Schema.optional(Schema.String),
          })
        )
      ),
      model: Schema.optional(Schema.String),
    })
  ),
  type: Schema.optional(Schema.String),
  usage: Schema.optional(
    Schema.Struct({
      cache_creation_input_tokens: Schema.optional(Schema.Number),
      cache_read_input_tokens: Schema.optional(Schema.Number),
      input_tokens: Schema.optional(Schema.Number),
      output_tokens: Schema.optional(Schema.Number),
    })
  ),
});
const decodeClaude = Schema.decodeUnknownOption(
  Schema.fromJsonString(ClaudeEvent)
);

const MCP_TOOL_RE = /^mcp__(.+?)__(.+)$/;
const EDITING = new Set(["Edit", "MultiEdit", "NotebookEdit", "Write"]);

/** What a tool call of Claude Code did, in the words a trace uses. */
const claudeCall = (
  name: string,
  input: Readonly<Record<string, unknown>>,
  app: string
) => {
  const text = (key: string) => {
    const value = input[key];
    return typeof value === "string"
      ? value.replaceAll(`${app}${path.sep}`, "")
      : "";
  };
  // Typed by hand: the linter otherwise takes the match for non-null.
  const mcp: RegExpExecArray | null = MCP_TOOL_RE.exec(name);
  if (mcp) {
    return `mcp.${mcp[1]}.${mcp[2]}`;
  }
  if (name === "Bash") {
    return text("command");
  }
  if (name === "Read") {
    return `Read ${text("file_path")}`;
  }
  if (EDITING.has(name)) {
    return `edit ${text("file_path") || text("notebook_path")}`;
  }
  if (name === "Skill") {
    // Loading a skill reads its core, with no Read of the file to show for it.
    const skill = text("skill") || text("command");
    return `Skill ${skill} (${path.join(".claude", "skills", skill, "SKILL.md")})`;
  }
  if (name === "Glob" || name === "Grep") {
    return `${name} ${text("pattern")} ${text("path")}`.trim();
  }
  return name;
};

/** A run of `claude -p --output-format stream-json`, from its lines. */
export const readClaudeEvents = (
  lines: readonly string[],
  app: string
): AgentRun => {
  const events = lines
    .filter((line) => line.startsWith("{"))
    .flatMap((line) => Option.toArray(decodeClaude(line)));
  const blocks = events.flatMap((e) => e.message?.content ?? []);
  const failed = new Set(
    blocks.flatMap((b) =>
      b.type === "tool_result" && b.is_error && b.tool_use_id
        ? [b.tool_use_id]
        : []
    )
  );
  const calls = blocks.filter((b) => b.type === "tool_use");
  const usage = events.findLast((e) => e.type === "result")?.usage;
  return {
    mcpCalls: calls.filter((c) => MCP_TOOL_RE.test(c.name ?? "")).length,
    model: events.find((e) => e.message?.model !== undefined)?.message?.model,
    said: events
      .filter((e) => e.type === "assistant")
      .flatMap((e) => e.message?.content ?? [])
      .flatMap((b) => (b.type === "text" && b.text ? [b.text] : []))
      .join("\n\n"),
    tokens:
      (usage?.input_tokens ?? 0) +
      (usage?.output_tokens ?? 0) +
      (usage?.cache_creation_input_tokens ?? 0) +
      (usage?.cache_read_input_tokens ?? 0),
    toolCalls: calls.length,
    trace: calls.map(
      (c) =>
        `${mark(c.id !== undefined && failed.has(c.id))}${claudeCall(c.name ?? "", c.input ?? {}, app)}`
    ),
  };
};

export interface OutsideOptions {
  readonly agent: string;
  readonly host: string;
  /** How long one run's agent may take. */
  readonly minutes: number;
  /** The agent's model, by the name its own command takes; its default otherwise. */
  readonly model: string | undefined;
  readonly round: string;
  readonly runs: number;
  /** `built-in`, `candidates/<fix>` laid over it, or `none`. */
  readonly skill: string;
}

const failed = (what: string) => (cause: unknown) =>
  new EvalsError({ message: `${what}: ${String(cause)}` });

const VITE_URL_RE = /http:\/\/127\.0\.0\.1:\d+\//;

/** The agent's command run to its end or to the time it may take, its lines as they came. */
const runAgent = Effect.fn("runAgent")(function* (
  agent: OutsideAgent,
  input: {
    readonly cwd: string;
    readonly minutes: number;
    readonly model: string | undefined;
    readonly prompt: string;
  }
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const { args, command } = agentCommand(agent, input);
  const lines: string[] = [];
  const errors: string[] = [];
  const started = yield* Clock.currentTimeMillis;
  const collect = (
    stream: Stream.Stream<Uint8Array, unknown>,
    into: string[]
  ) =>
    stream.pipe(
      Stream.decodeText(),
      Stream.splitLines,
      Stream.runForEach((line) => Effect.sync(() => into.push(line))),
      // A stream that breaks ends what was read of it; the exit code says how the run went.
      Effect.ignore,
      Effect.forkScoped
    );
  // Leaving the scope stops the agent and its process group, when it ran out of time too.
  const code = yield* Effect.scoped(
    Effect.gen(function* () {
      const child = yield* spawner
        .spawn(
          ChildProcess.make(command, args, {
            cwd: input.cwd,
            forceKillAfter: "5 seconds",
            stdin: "ignore",
          })
        )
        .pipe(Effect.mapError(failed(`${command} did not start`)));
      const reading = yield* collect(child.stdout, lines);
      yield* collect(child.stderr, errors);
      const exit = yield* child.exitCode.pipe(
        Effect.mapError(failed(`${command} could not be waited for`)),
        Effect.timeoutOption(Duration.minutes(input.minutes))
      );
      if (Option.isSome(exit)) {
        yield* Fiber.join(reading);
      }
      return exit;
    })
  );
  const ended = yield* Clock.currentTimeMillis;
  const problem = Option.match(code, {
    onNone: () => `${command} was stopped after ${input.minutes} minutes`,
    onSome: (exit) =>
      exit === 0
        ? undefined
        : `${command} exited ${exit}: ${errors.join("\n").slice(-300)}`,
  });
  return { lines, problem, seconds: Math.round((ended - started) / 1000) };
});

/** The app's pictures at each viewport, from its own dev server; what went wrong, if anything. */
const photograph = Effect.fn("photograph")(function* (
  app: string,
  reference: LoadedReference,
  dir: string
) {
  const browser = yield* Browser;
  const fs = yield* FileSystem.FileSystem;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const child = yield* spawner
    .spawn(
      ChildProcess.make(
        path.join(app, "node_modules", ".bin", "vite"),
        ["--host", "127.0.0.1"],
        {
          cwd: app,
          // Colour codes would sit inside the address it prints.
          env: { NO_COLOR: "1" },
          extendEnv: true,
          forceKillAfter: "5 seconds",
          stdin: "ignore",
        }
      )
    )
    .pipe(Effect.mapError(failed("the app's dev server did not start")));
  const ready = yield* Deferred.make<string>();
  yield* child.stdout.pipe(
    Stream.decodeText(),
    Stream.splitLines,
    Stream.runForEach((line) => {
      // Typed by hand, as above.
      const url: RegExpExecArray | null = VITE_URL_RE.exec(line);
      return url ? Deferred.succeed(ready, url[0]) : Effect.void;
    }),
    Effect.ignore,
    Effect.forkScoped
  );
  yield* child.stderr.pipe(Stream.runDrain, Effect.ignore, Effect.forkScoped);
  const url = yield* Deferred.await(ready).pipe(
    Effect.timeout("1 minute"),
    Effect.mapError(failed("the app did not say where it is served"))
  );
  yield* fs.makeDirectory(dir, { recursive: true });
  for (const viewport of viewportsOf(reference)) {
    const capture = yield* browser.capture(url, viewport, {
      hide: [],
      waitMs: 1500,
    });
    yield* fs.writeFile(path.join(dir, foldName(viewport.name)), capture.fold);
    yield* Effect.forEach(capture.tiles, (tile, index) =>
      fs.writeFile(path.join(dir, tileName(viewport.name, index)), tile)
    );
  }
});

/** A fresh copy of the host's app with the skill installed as a project installs one, committed. */
const prepareApp = Effect.fn("prepareApp")(function* (
  app: string,
  hostDir: string,
  host: OutsideHost,
  skillTree: string | undefined
) {
  const fs = yield* FileSystem.FileSystem;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  yield* fs.remove(app, { force: true, recursive: true });
  yield* fs.makeDirectory(path.dirname(app), { recursive: true });
  yield* fs.copy(hostDir, app);
  yield* fs.remove(path.join(app, HOST_FILE), { force: true });
  yield* fs.remove(path.join(app, "node_modules"), {
    force: true,
    recursive: true,
  });
  yield* fs.symlink(
    path.resolve(hostDir, host.modules),
    path.join(app, "node_modules")
  );
  if (skillTree !== undefined) {
    for (const dir of SKILL_DIRS) {
      yield* fs.makeDirectory(path.dirname(path.join(app, dir)), {
        recursive: true,
      });
      yield* fs.copy(skillTree, path.join(app, dir));
      // The skill's README is for who builds the skill, not who uses it.
      yield* fs.remove(path.join(app, dir, "README.md"), { force: true });
    }
  }
  const git = (...args: string[]) =>
    spawner.string(
      ChildProcess.make("git", args, { cwd: app, stdin: "ignore" })
    );
  yield* git("init", "-q");
  yield* git("add", ".");
  yield* git(
    "-c",
    "user.name=lab",
    "-c",
    "user.email=lab@localhost",
    "commit",
    "-qm",
    "the app"
  );
});

const isOutsideAgent = (agent: string): agent is OutsideAgent =>
  (OUTSIDE_AGENTS as readonly string[]).includes(agent);

const runOnce = Effect.fn("runOnce")(function* (
  reference: LoadedReference,
  run: number,
  host: OutsideHost,
  skillTree: string | undefined,
  agent: OutsideAgent,
  options: OutsideOptions
) {
  const { data } = yield* EvalsConfig;
  const fs = yield* FileSystem.FileSystem;
  const dir = data.runDir(options.round, reference.id, run);
  yield* fs.remove(dir, { force: true, recursive: true });
  const app = path.join(
    data.work,
    "outside",
    options.round,
    reference.id,
    `run-${run}`
  );
  yield* prepareApp(app, data.hostDir(options.host), host, skillTree).pipe(
    Effect.mapError(failed("the app could not be prepared"))
  );
  const brief = yield* fs.readFileString(data.briefFile(reference.id));
  yield* Effect.log(
    `${reference.id} run ${run}: ${agent} designing in ${data.fromData(app)}`
  );
  const ran = yield* runAgent(agent, {
    cwd: app,
    minutes: options.minutes,
    model: options.model,
    prompt: yield* prompt("generate-outside", {
      brief: brief.trim(),
      entry: host.entry,
      viewports: describeViewports(viewportsOf(reference)),
    }),
  });
  const read =
    agent === "codex"
      ? readCodexEvents(ran.lines, app)
      : readClaudeEvents(ran.lines, app);
  const problems = ran.problem === undefined ? [] : [ran.problem];
  yield* fs.copy(
    path.join(app, path.dirname(host.entry)),
    path.join(dir, "pages")
  );
  yield* Effect.scoped(
    photograph(app, reference, path.join(dir, "shots"))
  ).pipe(
    Effect.catch((error) =>
      Effect.sync(() => {
        problems.push(`no pictures: ${String(error)}`);
      })
    )
  );
  yield* writeText(path.join(dir, "agent.md"), `${read.said.trim()}\n`);
  yield* writeText(path.join(dir, "trace.md"), `${read.trace.join("\n")}\n`);
  // What the page shows that its brief did not is read from a design document: none here.
  yield* writeJson(path.join(dir, "added-text.json"), []);
  yield* writeText(path.join(dir, "events.jsonl"), `${ran.lines.join("\n")}\n`);
  const model = options.model ?? read.model ?? agent;
  const info: RunInfo = {
    agent,
    mcpCalls: read.mcpCalls,
    models: { [model]: read.tokens },
    pages: ["/"],
    problems,
    seconds: ran.seconds,
    tokens: read.tokens,
    toolCalls: read.toolCalls,
  };
  yield* writeJson(path.join(dir, "run.json"), info);
  yield* Effect.log(
    `${reference.id} run ${run}: ${info.toolCalls} tool calls, ${info.seconds}s, ${(info.tokens / 1000).toFixed(0)}k tokens${problems.length > 0 ? `; ${problems.join("; ")}` : ""}`
  );
});

/** The round's record; a round run again must be the same round: one host, one skill. */
const startRound = Effect.fn("startRound")(function* (
  references: readonly LoadedReference[],
  options: OutsideOptions
) {
  const { data } = yield* EvalsConfig;
  const fs = yield* FileSystem.FileSystem;
  const file = path.join(data.runs, options.round, "round.json");
  if (yield* fs.exists(file)) {
    const before = yield* readJson(RoundInfo, file);
    if (before.host !== options.host || before.skills !== options.skill) {
      return yield* new EvalsError({
        message: `round ${options.round} was started with host ${before.host ?? "none"} and skill ${before.skills}; name a new round for host ${options.host} and skill ${options.skill}`,
      });
    }
    return;
  }
  yield* writeJson(file, {
    agent: options.agent,
    commit: yield* commitOf,
    host: options.host,
    ...(options.model !== undefined && { model: options.model }),
    name: options.round,
    references: references.map((r) => r.id),
    runs: options.runs,
    skills: options.skill,
    startedAt: DateTime.formatIso(yield* DateTime.now),
  } satisfies RoundInfo);
});

/** `generate` for a host outside the editor: every pending run, one after another. */
export const generateOutside = Effect.fn("generateOutside")(function* (
  references: readonly LoadedReference[],
  host: OutsideHost,
  options: OutsideOptions
) {
  const { data } = yield* EvalsConfig;
  const fs = yield* FileSystem.FileSystem;
  const { agent } = options;
  if (!isOutsideAgent(agent)) {
    return yield* new EvalsError({
      message: `--agent ${agent} has no command of its own to run outside the editor: one of ${OUTSIDE_AGENTS.join(", ")}`,
    });
  }
  for (const reference of references) {
    if (!(yield* fs.exists(data.briefFile(reference.id)))) {
      return yield* new EvalsError({
        message: `${reference.id} has no brief: run brief ${reference.id} and read it first`,
      });
    }
  }
  yield* startRound(references, options);
  const skillTree =
    options.skill === NO_SKILL
      ? undefined
      : yield* writeSkillTree(
          path.join(
            data.runs,
            options.round,
            "skills",
            versionName(options.skill)
          ),
          options.skill
        );
  let pending = 0;
  for (const reference of references) {
    for (let run = 1; run <= options.runs; run += 1) {
      // A run with its run.json is done: a round run again picks up where it stopped.
      const done = yield* fs.exists(
        path.join(data.runDir(options.round, reference.id, run), "run.json")
      );
      if (!done) {
        pending += 1;
        yield* runOnce(reference, run, host, skillTree, agent, options);
      }
    }
  }
  yield* Effect.log(
    pending === 0
      ? "every run was generated before"
      : `generated: ${data.fromData(path.join(data.runs, options.round))}`
  );
});
