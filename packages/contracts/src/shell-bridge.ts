/**
 * What a shell gives the editor beyond the page (ADR 0031): the desktop app's capabilities, each
 * declared once, as one table. A capability is a name, the path it takes in the editor's
 * `Platform` (`projects.open` is `platform().projects.open`), its kind, its Schema'd input and
 * output, and whether a project on another machine shows it. The desktop app's preload script
 * builds the object it exposes from the entries the main process says are shown, and the main
 * process decodes each call's input, runs its handler and encodes its answer by the same entry;
 * the editor's `Platform` is the type the table gives (`ShellPlatform`), so neither side can
 * drift from the other.
 *
 * Two kinds:
 *
 * - `invoke`: the page calls, the main process answers. Its arguments are a tuple; one that
 *   reports progress (`progress`) takes a listener after them, told each step until it answers.
 * - `state`: a value the main process holds and tells the page as it changes; the page reads it
 *   at once (`current`) and listens to it (`subscribe`). Its value as the page loads comes with
 *   the entries shown.
 *
 * Imports no Electron: the editor takes its types, and the desktop app's both processes its
 * entries.
 */
import { Schema } from "effect";
import { CodeLocation, NewDesignStep } from "./new-design.ts";
import { ScaffoldTemplate } from "./setup.ts";
import { BuiltInAgentId, ChatPreferencesFile } from "./threads.ts";

/**
 * What the shell is doing for the open project that the editor cannot see: reconnecting to the
 * machine a project over SSH is on, say. The editor shows it while the backend is away.
 */
export const ShellStatus = Schema.Struct({
  /** Why, at more length: the error the last attempt met. */
  detail: Schema.optional(Schema.String),
  message: Schema.String,
});
export type ShellStatus = typeof ShellStatus.Type;

/**
 * Something the shell found the editor will miss, and how to put it right: Node.js not
 * installed, say. Shown as a banner over the editor until it is dismissed.
 */
export const ShellNotice = Schema.Struct({
  /** A command that puts it right, to copy. */
  command: Schema.optional(Schema.String),
  detail: Schema.String,
  id: Schema.String,
  /** Where to read more or download what is missing; opens in the browser. */
  link: Schema.optional(
    Schema.Struct({ label: Schema.String, url: Schema.String })
  ),
  title: Schema.String,
});
export type ShellNotice = typeof ShellNotice.Type;

/** How an agent stands on this machine, as the shell found it. */
export const PlatformAgent = Schema.Struct({
  /** Whether the shell keeps an API key for it, which it signs in with (Claude Code). */
  apiKey: Schema.optional(Schema.Boolean),
  /** Whether the shell could keep a key for it: it takes one, and there is a keychain. */
  canKeepKey: Schema.optional(Schema.Boolean),
  /** The executable set in the shell's settings, in place of the one on the PATH. */
  customPath: Schema.optional(Schema.String),
  /** What was found, or what is missing and how to put it right: a sentence or two. */
  detail: Schema.String,
  /** What the shell can download in its place, when it is missing: a release, its size in bytes. */
  download: Schema.optional(
    Schema.Struct({ size: Schema.Number, version: Schema.String })
  ),
  /** A download under way, or why the last one failed. */
  downloading: Schema.optional(
    Schema.Struct({
      message: Schema.optional(Schema.String),
      phase: Schema.String,
      received: Schema.Number,
      total: Schema.Number,
    })
  ),
  executable: Schema.optional(Schema.String),
  /** The built-in agents are the ones the desktop app brings an adapter for. */
  id: BuiltInAgentId,
  /** Where to read how to install it. */
  install: Schema.String,
  name: Schema.String,
  /**
   * What the shell can sign it in with, through its adapter (`ChatGPT` for Codex); absent, it
   * signs in by itself, in a terminal (Claude Code, which may not be signed in from here).
   */
  signInWith: Schema.optional(Schema.String),
  /** Where the executable came from: the PATH, the shell's settings, or the shell's download. */
  source: Schema.optional(Schema.Literals(["path", "setting", "download"])),
  /** `ready`: found and signed in; `signed-out`: found; `missing`: not found. */
  state: Schema.Literals(["ready", "signed-out", "missing"]),
  version: Schema.optional(Schema.String),
});
export type PlatformAgent = typeof PlatformAgent.Type;

/** A project the shell keeps, as its switcher lists it. */
export const PlatformProject = Schema.Struct({
  /** Where it is, for the list: a folder, or a host and a path on it. */
  detail: Schema.optional(Schema.String),
  id: Schema.String,
  name: Schema.String,
});
export type PlatformProject = typeof PlatformProject.Type;

/** A folder on another machine, reached over SSH, as the dialog asks for it. */
const RemoteProjectRequest = Schema.Struct({
  /** What runs the server there, before the flags the shell adds; `ultrapaint` when empty. */
  command: Schema.optional(Schema.String),
  /** An alias of the user's SSH configuration, a host name, `user@host` or `user@host:port`. */
  host: Schema.String,
  /** The folder there: absolute, or `~/…`. */
  path: Schema.String,
});

/**
 * What the start screen asks for besides the folder (ADR 0062): the prompt, sent in the
 * project's first chat once it opens, who picks the look, and the agent and model to send it
 * with. The editor takes it off its address (`apps/web/src/lib/first-prompt.ts`).
 */
export const FirstPrompt = Schema.Struct({
  agentId: Schema.optional(Schema.String),
  /** `agent`: the agent settles it from the prompt; `pick`: the person picks it first. */
  look: Schema.Literals(["agent", "pick"]),
  /** A value of the agent's model option, as the chat remembers it. */
  model: Schema.optional(Schema.String),
  prompt: Schema.String,
});
export type FirstPrompt = typeof FirstPrompt.Type;

/** The editor's address carries it as JSON in this parameter, taken off once read. */
export const FIRST_PROMPT_PARAM = "first-prompt";

/** The parameters a project opens with to send `start`: none without one. */
export const firstPromptQuery = (
  start: FirstPrompt | undefined
): Readonly<Record<string, string>> =>
  start ? { [FIRST_PROMPT_PARAM]: JSON.stringify(start) } : {};

/** What a folder the person chose holds, before anything is written in it. */
export const FolderKind = Schema.Struct({
  /**
   * `project`: it has an Ultrapaint configuration; `empty`: nothing but what a system leaves;
   * `folder`: anything else, an app or not.
   */
  kind: Schema.Literals(["project", "empty", "folder"]),
  /** Its name, as the list would show it. */
  name: Schema.String,
});
export type FolderKind = typeof FolderKind.Type;

/** A design from nothing (PLAN-desktop D11), as the start screen asks for it (ADR 0062). */
export const NewDesignInput = Schema.Struct({
  /** Where the application's code goes: `app/` beside the designs, or the folder's root. */
  code: CodeLocation,
  /** Absolute; made when it is not there, and empty otherwise. */
  folder: Schema.String,
  /** A first commit, and the git integration on; off, nothing is written to git. */
  git: Schema.Boolean,
  name: Schema.String,
  /** The start screen's prompt, sent once the project opens. */
  start: Schema.optional(FirstPrompt),
  /** `blank`: no components; `starter`: ten to design with. */
  template: ScaffoldTemplate,
});
export type NewDesignInput = typeof NewDesignInput.Type;

/** The steps of writing a new design, in order: the server's, then `open`, the shell's own. */
export const NewDesignStepId = Schema.Literals([
  ...NewDesignStep.literals,
  "open",
]);
export type NewDesignStepId = typeof NewDesignStepId.Type;

/** How a step goes, as the shell reports it. */
export const NewDesignUpdate = Schema.Struct({
  /** What it did, or why it failed. */
  detail: Schema.optional(Schema.String),
  state: Schema.Literals(["active", "done", "skipped", "failed"]),
  step: NewDesignStepId,
});
export type NewDesignUpdate = typeof NewDesignUpdate.Type;

/** How writing a new design ended: the step that failed, when one did. */
export const NewDesignOutcome = Schema.Struct({
  failed: Schema.optional(
    Schema.Struct({ message: Schema.String, step: NewDesignStepId })
  ),
});
export type NewDesignOutcome = typeof NewDesignOutcome.Type;

/**
 * The window's own buttons, where the shell draws no title bar (the desktop app on a Mac): they
 * sit over the editor's title card, which leaves them room, and the cards at the top move the
 * window when dragged, as a title bar would.
 */
const WindowControlsState = Schema.Struct({
  /** Full screen draws no buttons, and the room is the editor's again. */
  fullScreen: Schema.Boolean,
  /** How far from the window's left edge the buttons reach, in CSS pixels. */
  inset: Schema.Number,
});

/** A capability the page calls and the main process answers. */
interface Invoke<
  Input extends Schema.Tuple.Elements = Schema.Tuple.Elements,
  Output extends Schema.Constraint = Schema.Constraint,
  Progress extends Schema.Constraint | undefined =
    | Schema.Constraint
    | undefined,
> {
  readonly input: Schema.Tuple<Input>;
  readonly kind: "invoke";
  readonly output: Output;
  /** What it tells a listener given after its arguments, step by step, until it answers. */
  readonly progress: Progress;
  /** Whether a project on another machine shows it: false for this machine's own. */
  readonly remote: boolean;
}

/** A value the main process holds and tells the page as it changes. */
export interface State<Value extends Schema.Constraint = Schema.Constraint> {
  readonly kind: "state";
  /** Whether a project on another machine shows it: false for this machine's own. */
  readonly remote: boolean;
  readonly value: Value;
}

export type Capability = Invoke | State;

/** This machine's own: a project on another machine has its own, and the shell hides these. */
const LOCAL = { remote: false } as const;

const invoke = <
  const Input extends Schema.Tuple.Elements,
  Output extends Schema.Constraint,
>(
  input: Input,
  output: Output,
  options: { readonly remote?: boolean } = {}
): Invoke<Input, Output, undefined> => ({
  input: Schema.Tuple(input),
  kind: "invoke",
  output,
  progress: undefined,
  remote: options.remote ?? true,
});

/** An invoke that tells a listener each step of its `progress` until it answers. */
const reporting = <
  const Input extends Schema.Tuple.Elements,
  Output extends Schema.Constraint,
  Progress extends Schema.Constraint,
>(
  input: Input,
  output: Output,
  progress: Progress,
  options: { readonly remote?: boolean } = {}
): Invoke<Input, Output, Progress> => ({
  ...invoke(input, output, options),
  progress,
});

const state = <Value extends Schema.Constraint>(
  value: Value,
  options: { readonly remote?: boolean } = {}
): State<Value> => ({ kind: "state", remote: options.remote ?? true, value });

/**
 * Every capability, by its name, which is its path in `Platform`. A group (`agents`, `projects`,
 * `newDesign`) is shown or hidden whole (`shell-bridge.test.ts`): a part the editor finds is all
 * there.
 */
export const SHELL_BRIDGE = {
  /** Picks the agent's executable with the shell's own dialog; the server starts again. */
  "agents.choosePath": invoke([BuiltInAgentId], Schema.Void, LOCAL),
  /** Goes back to the agent on the PATH; the server starts again. */
  "agents.clearPath": invoke([BuiltInAgentId], Schema.Void, LOCAL),
  /** Downloads the release `download` names; done once it is installed. */
  "agents.download": invoke([BuiltInAgentId], Schema.Void, LOCAL),
  /** How each agent stands on this machine. */
  "agents.list": invoke([], Schema.Array(PlatformAgent), LOCAL),
  /**
   * What the chat remembers of each agent's models and the one a new thread starts with, from
   * the user's directory: the start screen offers them before any server runs.
   */
  "agents.preferences": invoke([], ChatPreferencesFile, LOCAL),
  /** Keeps the key the agent signs in with; `null` forgets it. The server starts again. */
  "agents.setApiKey": invoke(
    [BuiltInAgentId, Schema.NullOr(Schema.String)],
    Schema.Void,
    LOCAL
  ),
  /** Signs in through the shell (`chatgpt`): the browser opens, and this ends once it is done. */
  "agents.signIn": invoke([BuiltInAgentId], Schema.Void, LOCAL),
  /**
   * Writes a new design, telling the listener how each step goes, then opens it in place of the
   * open project, which the shell stops (asking first when an agent is working). Answers with the
   * step that failed, when one does: what the steps before it did stays.
   */
  "newDesign.create": reporting(
    [NewDesignInput],
    NewDesignOutcome,
    NewDesignUpdate
  ),
  /**
   * Where a design of that name goes unless another folder is picked: a folder of that name in
   * `~/Ultrapaint`, numbered when one is there already.
   */
  "newDesign.folderFor": invoke([Schema.String], Schema.String),
  /** What the shell found missing on this machine. */
  notices: invoke([], Schema.Array(ShellNotice), LOCAL),
  /** A native folder picker; null when it is cancelled. */
  pickFolder: invoke(
    [
      Schema.optional(
        Schema.Struct({
          defaultPath: Schema.optional(Schema.String),
          title: Schema.optional(Schema.String),
        })
      ),
    ],
    Schema.NullOr(Schema.String)
  ),
  /** Adds a project, through the shell's own dialog, and opens it. */
  "projects.add": invoke([], Schema.Void),
  /**
   * Adds a folder on another machine and opens it in place of the open project. What is wrong
   * with the input comes back as `problem`; a project that could not be opened is the shell's to
   * show, as for `open`.
   */
  "projects.addRemote": invoke(
    [RemoteProjectRequest],
    Schema.Struct({ problem: Schema.optional(Schema.String) })
  ),
  /** The open project's id. */
  "projects.current": invoke([], Schema.NullOr(Schema.String)),
  /** What a folder holds: an Ultrapaint project, nothing, or anything else. */
  "projects.inspect": invoke([Schema.String], FolderKind),
  "projects.list": invoke([], Schema.Array(PlatformProject)),
  /**
   * Opens another project. The shell stops the open project's server, asking first when an agent
   * is working, starts the next one's and loads its editor in place of this one.
   */
  "projects.open": invoke([Schema.String], Schema.Void),
  /**
   * Adds a folder to the list, when it is not there yet, and opens it as `open` does, sending
   * the start screen's prompt in its first chat when one is given.
   */
  "projects.openFolder": invoke(
    [Schema.String, Schema.optional(FirstPrompt)],
    Schema.Void
  ),
  /**
   * Takes a project off the list, with the unsaved session the shell kept for it; its folder is
   * left as it is. The open project stays, and the call fails saying so.
   */
  "projects.remove": invoke([Schema.String], Schema.Void),
  /**
   * Shows the start screen in place of the open project's editor, which stays open behind it:
   * `open` with its id goes back to it.
   */
  "projects.showStart": invoke([], Schema.Void),
  /** The host aliases of the user's SSH configuration, suggested as a host is typed. */
  "projects.sshHosts": invoke([], Schema.Array(Schema.String)),
  /** Stops the project opening (its machine not answering, say) and shows the list instead. */
  "projects.stopOpening": invoke([], Schema.Void),
  /** What the shell is doing for the open project; null when nothing. */
  shellStatus: state(Schema.NullOr(ShellStatus)),
  /** The window's buttons over the page; not shown where the system draws the frame. */
  windowControls: state(WindowControlsState),
} as const satisfies Record<string, Capability>;

export type ShellBridge = typeof SHELL_BRIDGE;
export type CapabilityName = keyof ShellBridge;

/** The names of the capabilities of a kind. */
type NamesOf<Kind extends Capability["kind"]> = {
  [K in CapabilityName]: ShellBridge[K]["kind"] extends Kind ? K : never;
}[CapabilityName];

export type InvokeName = NamesOf<"invoke">;
export type StateName = NamesOf<"state">;

/** What an invoke takes, its listener last when it reports progress. */
type CallArgs<C extends Invoke> = C["progress"] extends Schema.Constraint
  ? [
      ...C["input"]["Type"],
      onProgress: (progress: C["progress"]["Type"]) => void,
    ]
  : C["input"]["Type"];

/** A value as the page reads it, and listens to it. */
export interface StateSource<A> {
  readonly current: () => A;
  /** Calls `listener` with each change; the returned function stops it. */
  readonly subscribe: (listener: (value: A) => void) => () => void;
}

/** A capability as the page finds it. */
export type Exposed<C extends Capability> = C extends Invoke
  ? (...args: CallArgs<C>) => Promise<C["output"]["Type"]>
  : C extends State
    ? StateSource<C["value"]["Type"]>
    : never;

type Head<K extends string> = K extends `${infer H}.${string}` ? H : K;

/** A record of dotted names as nested objects: `{ "a.b": X }` is `{ a: { b: X } }`. */
export type Nested<T> = {
  readonly [K in keyof T & string as Head<K>]: K extends `${infer H}.${string}`
    ? Nested<{
        [J in keyof T & string as J extends `${H}.${infer R}`
          ? R
          : never]: T[J];
      }>
    : T[K];
};

/** Everything the table gives the editor: what the desktop app's preload exposes when all shows. */
export type ShellPlatform = Nested<{
  [K in CapabilityName]: Exposed<ShellBridge[K]>;
}>;
