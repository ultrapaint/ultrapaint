/**
 * The tasks an agent is given, as typed requests: implement a design, link pages built already
 * to their code, import a Figma file, redraw a canvas, run a step of the design-system setup,
 * sync. The server turns a request into the task's text
 * (`apps/server/src/services/threads/tasks.ts`); a slash command is one way to write a request.
 * Each command is declared once here, with how it is offered, read and written: the catalogue the
 * server serves (`slashCommands`), `parseCommand` and `commandOf` derive from it, so the editor
 * that puts a command in a composer and the server that reads it back share one form.
 */
import { Schema } from "effect";
import { DefineMode, SetupStepId } from "./design-system-setup.ts";
import type { SlashCommand, ThreadPurpose } from "./threads.ts";

/** What the user typed after a command's argument, passed on to the agent as it is. */
const Extra = Schema.optional(Schema.String);

/** `/init`: the repository's design system imported into the editor. */
const InitTask = Schema.TaggedStruct("Init", { extra: Extra });

/**
 * `/implement`: a page or a component turned into the application's code (ADR 0030). The
 * target is a page's URL, file or id, `component:<Name>` or a component's name; empty names the
 * only page there is. A canvas narrows a URL that pages of several canvases serve.
 */
export const ImplementTask = Schema.TaggedStruct("Implement", {
  canvas: Schema.optional(Schema.String),
  extra: Extra,
  target: Schema.String,
});
export type ImplementTask = typeof ImplementTask.Type;

/**
 * `/implement --adopt`: pages built already linked to the files that implement them, the code
 * left as it is. Each target is a canvas (`""` the designs directory's own), naming its pages,
 * or a page; none names every page not linked yet.
 */
const AdoptTask = Schema.TaggedStruct("Adopt", {
  targets: Schema.Array(Schema.String),
});

/** `/import-figma`: an uploaded Figma file, by id or name (the newest when absent), as pages. */
export const ImportFigmaTask = Schema.TaggedStruct("ImportFigma", {
  extra: Extra,
  file: Schema.optional(Schema.String),
});
export type ImportFigmaTask = typeof ImportFigmaTask.Type;

/** `/redraw`: every page of a canvas, a copy made to take another way, changed as `change` says. */
export const RedrawTask = Schema.TaggedStruct("Redraw", {
  canvas: Schema.String,
  change: Schema.optional(Schema.String),
});
export type RedrawTask = typeof RedrawTask.Type;

/** `/design-system`: a step of the design-system setup (ADR 0023); Define in a mode if given. */
export const SetupStepTask = Schema.TaggedStruct("SetupStep", {
  extra: Extra,
  mode: Schema.optional(DefineMode),
  step: SetupStepId,
});
export type SetupStepTask = typeof SetupStepTask.Type;

/** What `/sync` does: describe the code, match Figma's or DESIGN.md's tokens, bring the code up. */
export const SyncSource = Schema.Literals([
  "describe",
  "figma",
  "design",
  "code",
]);
export type SyncSource = typeof SyncSource.Type;

/** `/sync`: one of its sources, or with none, where the editor's sync stands (ADR 0025). */
export const SyncTask = Schema.TaggedStruct("Sync", {
  extra: Extra,
  source: Schema.optional(SyncSource),
});
export type SyncTask = typeof SyncTask.Type;

export const TaskRequest = Schema.Union([
  InitTask,
  ImplementTask,
  AdoptTask,
  ImportFigmaTask,
  RedrawTask,
  SetupStepTask,
  SyncTask,
]);
export type TaskRequest = typeof TaskRequest.Type;

/**
 * What a thread running the task is for (ADR 0030): implementing writes the application, so it
 * starts its agent with the repository writable. Linking pages built already changes no code.
 */
export const taskPurpose = (request: TaskRequest): ThreadPurpose =>
  request._tag === "Implement" ? "implement" : "design";

/**
 * Whether the thread that runs a task draws designs, and is told the design skills, which the
 * design evals were tuned with (ADR 0043): a canvas redrawn, a Figma file made pages, the design
 * system imported or defined. Implementing, linking pages built already, mapping and migrating
 * the code and matching tokens draw nothing.
 */
export const drawsDesigns = (request: TaskRequest): boolean => {
  switch (request._tag) {
    case "Init":
    case "ImportFigma":
    case "Redraw":
      return true;
    case "SetupStep":
      return request.step === "define";
    default:
      return false;
  }
};

const ROOT_CANVAS = '""';
const ADOPT_FLAG = "--adopt";
const WHITESPACE_RE = /\s+/;
const COMMAND_RE = /^\/([a-z][\w-]*)(?:\s+([\s\S]*))?$/;
/** `marketing:/pricing` or `marketing:pricing.page.json`: a page of a canvas, as node refs write it. */
const IN_CANVAS_RE = /^([^\s:]+):(\/\S*|\S+\.page\.json)$/;

/** A canvas as a command writes it: `""` for the designs directory's own. */
const canvasWord = (id: string) => (id === "" ? ROOT_CANVAS : id);
const canvasOfWord = (word: string) => (word === ROOT_CANVAS ? "" : word);

const isSetupStep = Schema.is(SetupStepId);
const isDefineMode = Schema.is(DefineMode);
const isSyncSource = Schema.is(SyncSource);

/** The words of a command, a word left out when it is empty. */
const written = (...words: readonly (string | undefined)[]) =>
  words.filter((w): w is string => w !== undefined && w !== "").join(" ");

/** The first word of an argument, and the rest of it. */
const splitWord = (argument: string) => {
  const [first = "", ...rest] = argument.trim().split(WHITESPACE_RE);
  return { first, rest: rest.join(" ") };
};

/** An optional field of a request, left out when the command has nothing for it. */
const given = <K extends string>(key: K, text: string) =>
  (text === "" ? {} : { [key]: text }) as { readonly [P in K]?: string };

type RequestTag = TaskRequest["_tag"];
type RequestOf<T extends RequestTag> = Extract<TaskRequest, { _tag: T }>;
/** What a command's argument is written as: its words, an empty one left out. */
type Words = readonly (string | undefined)[];

/**
 * A slash command as it is declared: its name, how its argument is written and what it does, as
 * the composer offers it; the requests it is written for, how its argument is read as one of
 * them (or why it names none, as a clause), and how one is written back.
 */
interface CommandDeclaration<T extends RequestTag> {
  readonly argument?: string;
  readonly description: string;
  readonly name: string;
  readonly parse: (
    argument: string
  ) => RequestOf<T> | { readonly invalid: string };
  readonly print: (request: RequestOf<T>) => Words;
  readonly requests: readonly T[];
}

/** A command declared, as the catalogue, the parser and the printer use it whatever it writes. */
interface Command {
  readonly entry: SlashCommand;
  readonly name: string;
  readonly parse: (argument: string) => ParsedCommand;
  /** The words after the command's name, for a request it is written for; null for another. */
  readonly print: (request: TaskRequest) => Words | null;
}

const command = <T extends RequestTag>(
  declared: CommandDeclaration<T>
): Command => {
  const { argument, description, name, parse, print, requests } = declared;
  const writes = (request: TaskRequest): request is RequestOf<T> =>
    (requests as readonly RequestTag[]).includes(request._tag);
  return {
    entry: { ...(argument !== undefined && { argument }), description, name },
    name,
    parse: (text) => {
      const read = parse(text);
      return "invalid" in read
        ? { _tag: "Invalid", command: name, message: read.invalid }
        : { _tag: "Request", request: read };
    },
    print: (request) => (writes(request) ? print(request) : null),
  };
};

/** Every slash command, in the order the composer offers them. */
const COMMANDS: readonly Command[] = [
  command({
    description:
      "Import the repository's design system: tokens, text styles and conventions",
    name: "init",
    parse: (argument) => ({ _tag: "Init", ...given("extra", argument) }),
    print: (request) => [request.extra],
    requests: ["Init"],
  }),
  command({
    argument: "<page | component> | --adopt [canvas | page…]",
    description:
      "Turn a page or a component of the design into the application's own code; `--adopt` links pages built already to the files that implement them",
    name: "implement",
    parse: (argument) => {
      const { first, rest } = splitWord(argument);
      if (first === ADOPT_FLAG) {
        return {
          _tag: "Adopt",
          targets: rest.split(WHITESPACE_RE).filter(Boolean).map(canvasOfWord),
        };
      }
      const inCanvas: RegExpExecArray | null = IN_CANVAS_RE.exec(first);
      return {
        _tag: "Implement",
        target: inCanvas?.[2] ?? first,
        ...given("canvas", inCanvas?.[1] ?? ""),
        ...given("extra", rest),
      };
    },
    print: (request) =>
      request._tag === "Adopt"
        ? [ADOPT_FLAG, ...request.targets.map(canvasWord)]
        : [
            request.canvas
              ? `${request.canvas}:${request.target}`
              : request.target,
            request.extra,
          ],
    requests: ["Implement", "Adopt"],
  }),
  command({
    description:
      "Turn an imported Figma file into pages, its components made the design's",
    name: "import-figma",
    parse: (argument) => {
      const { first, rest } = splitWord(argument);
      return {
        _tag: "ImportFigma",
        ...given("file", first),
        ...given("extra", rest),
      };
    },
    print: (request) => [request.file, request.extra],
    requests: ["ImportFigma"],
  }),
  command({
    argument: "<canvas> <what to change>",
    description:
      "Change every page of a canvas, a copy made to take another way: to wireframes, to finished screens",
    name: "redraw",
    parse: (argument) => {
      const { first, rest } = splitWord(argument);
      return {
        _tag: "Redraw",
        canvas: canvasOfWord(first),
        ...given("change", rest),
      };
    },
    print: (request) => [canvasWord(request.canvas), request.change],
    requests: ["Redraw"],
  }),
  command({
    argument: "<step>",
    description:
      "Run a step of the design-system setup (Design system → Setup): define, map or migrate",
    name: "design-system",
    parse: (argument) => {
      const { first, rest } = splitWord(argument);
      if (!isSetupStep(first)) {
        return {
          invalid: first
            ? `${first} is not a step of the setup`
            : "it did not say which step",
        };
      }
      const { first: mode, rest: words } = splitWord(rest);
      return first === "define" && isDefineMode(mode)
        ? { _tag: "SetupStep", mode, step: first, ...given("extra", words) }
        : { _tag: "SetupStep", step: first, ...given("extra", rest) };
    },
    print: (request) => [request.step, request.mode, request.extra],
    requests: ["SetupStep"],
  }),
  command({
    argument: "[describe | figma | design | code]",
    description:
      "Bring the design system and the code together: opens Sync; `describe` has an agent describe what changed, `figma` match Figma's tokens to the design system's, `design` DESIGN.md's, `code` bring the code up to the design",
    name: "sync",
    parse: (argument) => {
      const { first, rest } = splitWord(argument);
      // Any other word is not a source: where the sync stands is what is asked.
      return isSyncSource(first)
        ? { _tag: "Sync", source: first, ...given("extra", rest) }
        : { _tag: "Sync" };
    },
    print: (request) => [request.source, request.extra],
    requests: ["Sync"],
  }),
];

/**
 * The slash commands a prompt may start with, as the composer offers them after a `/`: what the
 * server's `commands.list` answers.
 */
export const slashCommands: readonly SlashCommand[] = COMMANDS.map(
  (c) => c.entry
);

/** The command a request is written as, and its words. Every request has one: the tests write each. */
const writing = (request: TaskRequest) => {
  for (const { name, print } of COMMANDS) {
    const words = print(request);
    if (words) {
      return { name, words };
    }
  }
  return { name: "", words: [] };
};

/** The slash command a request is written as, without its slash. */
export const commandNameOf = (request: TaskRequest): string =>
  writing(request).name;

/** The slash command a request is written as, which `parseCommand` reads back as the request. */
export const commandOf = (request: TaskRequest): string => {
  const { name, words } = writing(request);
  return written(`/${name}`, ...words);
};

/** A command that names something it cannot: what the agent tells the user instead. */
interface InvalidCommand {
  readonly _tag: "Invalid";
  /** Without its slash: `design-system`. */
  readonly command: string;
  /** Why, as a clause: `foo is not a step of the setup`. */
  readonly message: string;
}

type ParsedCommand =
  | { readonly _tag: "Request"; readonly request: TaskRequest }
  | InvalidCommand;

/**
 * The request a prompt's text stands for when it starts with a command the editor knows, or null
 * (it then goes to the agent as it is, which may have commands of its own).
 */
export const parseCommand = (text: string): ParsedCommand | null => {
  const match: RegExpExecArray | null = COMMAND_RE.exec(text.trim());
  const found = COMMANDS.find((c) => c.name === match?.[1]);
  return found ? found.parse(match?.[2]?.trim() ?? "") : null;
};
