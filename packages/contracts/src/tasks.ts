/**
 * The tasks an agent is given, as typed requests: implement a design, link pages built already
 * to their code, import a Figma file, redraw a canvas, draw a component sheet, run a step of the
 * design-system setup, sync. The server turns a request into the task's text
 * (`apps/server/src/services/threads/tasks.ts`); a slash command is one way to write a request,
 * read by `parseCommand` and written by `commandOf`, so the editor that puts a command in a
 * composer and the server that reads it back share one form.
 */
import { Schema } from "effect";
import { DefineMode, SetupStepId } from "./design-system-setup.ts";
import type { ThreadPurpose } from "./threads.ts";

/** What the user typed after a command's argument, passed on to the agent as it is. */
const Extra = Schema.optional(Schema.String);

/** `/init`: the repository's design system imported into the editor. */
export const InitTask = Schema.TaggedStruct("Init", { extra: Extra });
export type InitTask = typeof InitTask.Type;

/**
 * `/implement`: a page or a component spec turned into the application's code (ADR 0030). The
 * target is a page's URL, file or id, `spec:<Component>` or a component's name; empty names the
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
export const AdoptTask = Schema.TaggedStruct("Adopt", {
  targets: Schema.Array(Schema.String),
});
export type AdoptTask = typeof AdoptTask.Type;

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

/** `/components`: a sheet of the design system's components drawn into a canvas. */
export const ComponentsTask = Schema.TaggedStruct("Components", {
  canvas: Schema.String,
  extra: Extra,
});
export type ComponentsTask = typeof ComponentsTask.Type;

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
  ComponentsTask,
  SetupStepTask,
  SyncTask,
]);
export type TaskRequest = typeof TaskRequest.Type;

/** The slash command a request is written as, without its slash. */
export const commandNameOf = (request: TaskRequest): string => {
  switch (request._tag) {
    case "Init":
      return "init";
    case "Implement":
    case "Adopt":
      return "implement";
    case "ImportFigma":
      return "import-figma";
    case "Redraw":
      return "redraw";
    case "Components":
      return "components";
    case "SetupStep":
      return "design-system";
    case "Sync":
      return "sync";
    default:
      return request satisfies never;
  }
};

/**
 * What a thread running the task is for (ADR 0030): implementing writes the application, so it
 * starts its agent with the repository writable. Linking pages built already changes no code.
 */
export const taskPurpose = (request: TaskRequest): ThreadPurpose =>
  request._tag === "Implement" ? "implement" : "design";

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

/** The slash command a request is written as, which `parseCommand` reads back as the request. */
export const commandOf = (request: TaskRequest): string => {
  const name = `/${commandNameOf(request)}`;
  switch (request._tag) {
    case "Init":
      return written(name, request.extra);
    case "Implement":
      return written(
        name,
        request.canvas ? `${request.canvas}:${request.target}` : request.target,
        request.extra
      );
    case "Adopt":
      return written(name, ADOPT_FLAG, ...request.targets.map(canvasWord));
    case "ImportFigma":
      return written(name, request.file, request.extra);
    case "Redraw":
      return written(name, canvasWord(request.canvas), request.change);
    case "Components":
      return written(name, canvasWord(request.canvas), request.extra);
    case "SetupStep":
      return written(name, request.step, request.mode, request.extra);
    case "Sync":
      return written(name, request.source, request.extra);
    default:
      return request satisfies never;
  }
};

/** A command that names something it cannot: what the agent tells the user instead. */
export interface InvalidCommand {
  readonly _tag: "Invalid";
  /** Without its slash: `design-system`. */
  readonly command: string;
  /** Why, as a clause: `foo is not a step of the setup`. */
  readonly message: string;
}

export type ParsedCommand =
  | { readonly _tag: "Request"; readonly request: TaskRequest }
  | InvalidCommand;

/** The first word of an argument, and the rest of it. */
const splitWord = (argument: string) => {
  const [first = "", ...rest] = argument.trim().split(WHITESPACE_RE);
  return { first, rest: rest.join(" ") };
};

/** An optional field of a request, left out when the command has nothing for it. */
const given = <K extends string>(key: K, text: string) =>
  (text === "" ? {} : { [key]: text }) as { readonly [P in K]?: string };

const requestOf = (request: TaskRequest): ParsedCommand => ({
  _tag: "Request",
  request,
});

/**
 * The request a prompt's text stands for when it starts with a command the editor knows, or null
 * (it then goes to the agent as it is, which may have commands of its own).
 */
export const parseCommand = (text: string): ParsedCommand | null => {
  const match: RegExpExecArray | null = COMMAND_RE.exec(text.trim());
  const name = match?.[1];
  const argument = match?.[2]?.trim() ?? "";
  const { first, rest } = splitWord(argument);
  switch (name) {
    case "init":
      return requestOf({ _tag: "Init", ...given("extra", argument) });
    case "implement": {
      if (first === ADOPT_FLAG) {
        return requestOf({
          _tag: "Adopt",
          targets: rest.split(WHITESPACE_RE).filter(Boolean).map(canvasOfWord),
        });
      }
      const inCanvas: RegExpExecArray | null = IN_CANVAS_RE.exec(first);
      return requestOf({
        _tag: "Implement",
        target: inCanvas?.[2] ?? first,
        ...given("canvas", inCanvas?.[1] ?? ""),
        ...given("extra", rest),
      });
    }
    case "import-figma":
      return requestOf({
        _tag: "ImportFigma",
        ...given("file", first),
        ...given("extra", rest),
      });
    case "redraw":
      return requestOf({
        _tag: "Redraw",
        canvas: canvasOfWord(first),
        ...given("change", rest),
      });
    case "components":
      return requestOf({
        _tag: "Components",
        canvas: canvasOfWord(first),
        ...given("extra", rest),
      });
    case "design-system": {
      if (!isSetupStep(first)) {
        return {
          _tag: "Invalid",
          command: name,
          message: first
            ? `${first} is not a step of the setup`
            : "it did not say which step",
        };
      }
      const { first: mode, rest: words } = splitWord(rest);
      return first === "define" && isDefineMode(mode)
        ? requestOf({
            _tag: "SetupStep",
            mode,
            step: first,
            ...given("extra", words),
          })
        : requestOf({
            _tag: "SetupStep",
            step: first,
            ...given("extra", rest),
          });
    }
    case "sync":
      // Any other word is not a source: where the sync stands is what is asked.
      return requestOf(
        isSyncSource(first)
          ? { _tag: "Sync", source: first, ...given("extra", rest) }
          : { _tag: "Sync" }
      );
    default:
      return null;
  }
};
