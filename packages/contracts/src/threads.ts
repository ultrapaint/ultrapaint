import { Schema } from "effect";
import { FileId, Json } from "./base.ts";
import { LookPlace } from "./components.ts";
import { Category, ReviewSettings, Severity } from "./review.ts";

/**
 * The agents that ship built in, each declared once by its descriptor in acp's `built-in`
 * (`BUILT_IN_AGENTS`, which must name exactly these). Their ids are here, below acp, because the
 * desktop's shell bridge names them on the wire.
 */
export const BuiltInAgentId = Schema.Literals(["claude-code", "codex"]);
export type BuiltInAgentId = typeof BuiltInAgentId.Type;

export const AgentConfig = Schema.Struct({
  args: Schema.Array(Schema.String),
  authHint: Schema.optional(Schema.String),
  builtIn: Schema.Boolean,
  /** Executable; resolved through PATH or `npx` when `package` is set. */
  command: Schema.String,
  env: Schema.Record(Schema.String, Schema.String),
  id: Schema.String,
  name: Schema.String,
  /** npm package that provides the command, used for `npx` fallback and install hints. */
  package: Schema.optional(Schema.String),
  /**
   * Environment the agent needs when it runs inside the sandbox, typically to stop it from
   * starting a sandbox of its own: one cannot start inside another.
   */
  sandboxEnv: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  /** Sent as `session/new` `_meta` when the agent runs inside the sandbox, for the same reason. */
  sandboxMeta: Schema.optional(Json),
  /**
   * Where the agent keeps its own login, sessions and caches. Readable and writable inside the
   * sandbox, wherever they are. `~` is the user's home directory, `<uid>` their user id. A
   * trailing `/` says the path is a directory, which is made if it is missing: on Linux nothing
   * the agent may write can come into being inside the sandbox unless it exists beforehand.
   */
  stateDirs: Schema.optional(Schema.Array(Schema.String)),
});
export type AgentConfig = typeof AgentConfig.Type;

/**
 * Where a thread is with its agent: `idle`, `running` (from the prompt on, the agent's start
 * included), `cancelling` and `error`. A thread file read at start is idle whatever it says, so
 * one written with an older status (`starting`, `closed`) still reads.
 */
export const ThreadStatus = Schema.Literals([
  "idle",
  "running",
  /** The design's review models look at what the turn made (ADR 0063); the designer waits. */
  "reviewing",
  "cancelling",
  "error",
]);
export type ThreadStatus = typeof ThreadStatus.Type;

/**
 * The agent is on a turn, or stopping one: a prompt sent now waits in the thread's queue, the
 * agent cannot be switched, and stopping the server would cut it off.
 */
export const isBusy = (status: ThreadStatus | undefined): boolean =>
  status === "running" || status === "reviewing" || status === "cancelling";

/**
 * A setting the agent's session offers: its model, reasoning effort, and the like. A `boolean`
 * is on or off (its choices `true` and `false`) and is set as a boolean; a select, the kind a
 * thread written before kept without saying, is one of its choices.
 */
export const ConfigOption = Schema.Struct({
  category: Schema.optional(Schema.String),
  currentValue: Schema.String,
  id: Schema.String,
  name: Schema.String,
  options: Schema.Array(
    Schema.Struct({
      description: Schema.optional(Schema.String),
      name: Schema.String,
      value: Schema.String,
    })
  ),
  type: Schema.optional(Schema.Literals(["select", "boolean"])),
});
export type ConfigOption = typeof ConfigOption.Type;

const SessionMode = Schema.Struct({
  description: Schema.optional(Schema.String),
  id: Schema.String,
  name: Schema.String,
});
type SessionMode = typeof SessionMode.Type;

/** Whether an option chooses the model. Agents say so by category; some only by its id. */
export const isModelOption = (option: ConfigOption): boolean =>
  option.category === "model" || option.id === "model";

type Choice = ConfigOption["options"][number];

const DEFAULT_CHOICE_RE = /^default\b/i;

/** A choice that leaves the pick to the agent ("Default (recommended)"): it names nothing. */
const isUnnamed = (choice: Choice) =>
  choice.value === "default" || DEFAULT_CHOICE_RE.test(choice.name);

const EFFORT_RE = /effort|thought|thinking|reasoning/i;

/** Whether an option sets how hard the model thinks. */
export const isEffortOption = (option: ConfigOption): boolean =>
  option.category === "thought_level" || EFFORT_RE.test(option.id);

/** The choices an option offers by name, without the agent's unnamed default. */
export const namedChoices = (option: ConfigOption): readonly Choice[] => {
  const named = option.options.filter((c) => !isUnnamed(c));
  return named.length > 0 ? named : option.options;
};

/**
 * The named choice the agent's unnamed default stands for, where it offers one: the first model
 * it names; for effort, medium, the level the Claude adapter itself recommends.
 */
export const defaultChoice = (option: ConfigOption): string | undefined => {
  if (!option.options.some(isUnnamed)) {
    return undefined;
  }
  const named = namedChoices(option);
  const medium = isEffortOption(option)
    ? named.find((c) => c.value === "medium")
    : undefined;
  return (medium ?? named[0])?.value;
};

/**
 * The options with named choices for the model and the effort: where the agent's own default is
 * current, the choice it stands for. A thread always says what it answers with.
 */
export const withNamedChoices = (
  options: readonly ConfigOption[]
): readonly ConfigOption[] =>
  options.map((o) => {
    if (!(isModelOption(o) || isEffortOption(o))) {
      return o;
    }
    const fallback = defaultChoice(o);
    return fallback === undefined ||
      namedChoices(o).some((c) => c.value === o.currentValue)
      ? o
      : { ...o, currentValue: fallback };
  });

const AUTO_MODE_RE = /^auto\b/i;

/** The mode a thread starts in: the agent's automatic one where it has it, else its current one. */
export const startingMode = (
  modes: readonly SessionMode[] | undefined,
  current: string | undefined
) =>
  modes?.find((m) => m.id === "auto" || AUTO_MODE_RE.test(m.name))?.id ??
  current;

/** What a board's pick stands for (ADR 0045, B6). */
export const BoardPickKind = Schema.Literals([
  "token",
  "group",
  "textStyle",
  "foundation",
  "guideline",
  "systemComponent",
  "appComponent",
]);
export type BoardPickKind = typeof BoardPickKind.Type;

/**
 * A thread is not tied to an agent: `agentId` is the one its next prompt goes to, and the user
 * can switch it between prompts. Its session starts with the first prompt that needs it, so a
 * thread exists before any agent does.
 */
export const PromptAttachment = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("file"), path: Schema.String }),
  /** A node of a design document the user has selected on the canvas. */
  Schema.Struct({
    /** Whether the node is an instance of a component (ADR 0041). */
    component: Schema.optional(Schema.Boolean),
    /** The page's file, or the canvas's `canvas.json` for a node beside the pages. */
    file: Schema.String,
    kind: Schema.Literal("selection"),
    name: Schema.String,
    nodeId: Schema.String,
  }),
  Schema.Struct({
    dataUrl: Schema.String,
    kind: Schema.Literal("image"),
    name: Schema.String,
  }),
  /**
   * What the user has picked on a board of Design system or the Library (ADR 0045, B11): a
   * token, a colour group, a text style, a foundation, a guideline, a component, a system
   * component's look at a variant and a state, an app component's variant.
   */
  Schema.Struct({
    /** What it is now, as the editor shows it: a token's value in each theme, a text style's fields. */
    detail: Schema.optional(Schema.String),
    /**
     * The file it is kept in: `design-system.json`, DESIGN.md, the component's file (which a
     * system component in its default look does not have yet).
     */
    file: Schema.String,
    kind: Schema.Literal("board"),
    /** The token's, the group's, the style's, the foundation's, the section's or the component's. */
    name: Schema.String,
    pick: BoardPickKind,
    /**
     * Where in a component the pick is (ADR 0044): a system component's look at a variant's
     * member, a state or a state in a member; an app component's choice at a member, its `axis`
     * the property. Absent for the component as a whole.
     */
    place: Schema.optional(LookPlace),
  }),
]);
export type PromptAttachment = typeof PromptAttachment.Type;
export type BoardAttachment = Extract<PromptAttachment, { kind: "board" }>;

/** A prompt waiting for the agent's turn to end. */
export const QueuedPrompt = Schema.Struct({
  at: Schema.Number,
  attachments: Schema.Array(PromptAttachment),
  id: Schema.String,
  text: Schema.String,
});
export type QueuedPrompt = typeof QueuedPrompt.Type;

/**
 * What a thread works on, from its first prompt: the node attached to it, or the page when no node
 * was. The chat shows a picture of it, so the thread is found by sight.
 */
export const ThreadScope = Schema.Struct({
  /** Whether the node is an instance of a component, which gives it the component colour. */
  component: Schema.optional(Schema.Boolean),
  /** How many nodes the first prompt attached, when more than one. */
  count: Schema.optional(Schema.Number),
  /** The page's file, or the canvas's `canvas.json` for a node beside the pages. */
  file: Schema.String,
  name: Schema.String,
  /** Absent when the scope is a whole page. */
  nodeId: Schema.optional(Schema.String),
});
export type ThreadScope = typeof ThreadScope.Type;

/**
 * What a thread is for (ADR 0030): `design` writes the designs directory only, `implement` the
 * repository. Threads written before there was a purpose are design threads.
 */
export const ThreadPurpose = Schema.Literals(["design", "implement"]);
export type ThreadPurpose = typeof ThreadPurpose.Type;

/** How full the agent's context is, as it last said (ACP's `usage_update`), and what it cost. */
export const ContextUsage = Schema.Struct({
  /** What the session has cost so far. */
  cost: Schema.optional(
    Schema.Struct({ amount: Schema.Number, currency: Schema.String })
  ),
  /** The context window, in tokens. */
  size: Schema.Number,
  /** The tokens in it now. */
  used: Schema.Number,
});
export type ContextUsage = typeof ContextUsage.Type;

/** A command a prompt may start with; the server expands it into the task it stands for. */
export const SlashCommand = Schema.Struct({
  /** What goes after the command, for the composer's hint: `<route>`. */
  argument: Schema.optional(Schema.String),
  description: Schema.String,
  /** Without the slash: `init`. */
  name: Schema.String,
});
export type SlashCommand = typeof SlashCommand.Type;

export const Thread = Schema.Struct({
  /**
   * The commands the agent's own session offers after a `/` (ACP's available commands), as it
   * last said: the composer offers them after the editor's, and they go to the agent as typed.
   */
  agentCommands: Schema.optional(Schema.Array(SlashCommand)),
  agentId: Schema.String,
  /**
   * The session's options. Before the session exists these are the agent's options as a
   * previous session reported them, and what is chosen here is applied when it starts.
   */
  configOptions: Schema.optional(Schema.Array(ConfigOption)),
  /** How full the agent's context is, as it last said; the session's, gone with it. */
  context: Schema.optional(ContextUsage),
  createdAt: Schema.Number,
  currentModeId: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
  id: Schema.String,
  /** Advertised session modes, generic. */
  modes: Schema.optional(Schema.Array(SessionMode)),
  /**
   * The title was given when the thread was made (the setup chat's, ADR 0062): the titles the
   * agent's session suggests leave it as it is.
   */
  named: Schema.optional(Schema.Boolean),
  /** `design` when absent. */
  purpose: Schema.optional(ThreadPurpose),
  /**
   * Prompts sent while the agent was working, oldest first: each is sent when a turn ends, and
   * waits after a turn that was stopped or failed until the user sends it.
   */
  queued: Schema.optional(Schema.Array(QueuedPrompt)),
  /**
   * This design's own review settings (ADR 0063), from the composer's Review chip: over the
   * project's, field by field. Absent, the project's hold.
   */
  review: Schema.optional(ReviewSettings),
  /** Whether the agent process is confined to the repository by the operating system. */
  sandboxed: Schema.optional(Schema.Boolean),
  /** Why it is not, when this machine has a sandbox that refused to start. */
  sandboxProblem: Schema.optional(Schema.String),
  scope: Schema.optional(ThreadScope),
  sessionId: Schema.optional(Schema.String),
  status: ThreadStatus,
  /**
   * The thread's last line and whether it waits on the user, for the list of threads. Derived
   * from the transcript when the list is read; not stored.
   */
  summary: Schema.optional(
    Schema.Struct({ text: Schema.String, waiting: Schema.Boolean })
  ),
  title: Schema.String,
  updatedAt: Schema.Number,
});
export type Thread = typeof Thread.Type;

/** What an agent's sessions offer, as the last one it started reported it. */
export const AgentOptions = Schema.Struct({
  agentId: Schema.String,
  configOptions: Schema.Array(ConfigOption),
  currentModeId: Schema.optional(Schema.String),
  modes: Schema.optional(Schema.Array(SessionMode)),
});
export type AgentOptions = typeof AgentOptions.Type;

/** What a new thread starts with. Each is optional: absent is the first agent, its own model. */
export const ChatDefaults = Schema.Struct({
  agentId: Schema.optional(Schema.String),
  /** A value of the default agent's effort option. */
  effort: Schema.optional(Schema.String),
  /** One of the default agent's session modes: what it may do without asking. */
  modeId: Schema.optional(Schema.String),
  /** A value of the default agent's model option. */
  model: Schema.optional(Schema.String),
});
export type ChatDefaults = typeof ChatDefaults.Type;

/**
 * What the chat remembers across projects (`~/.ultrapaint/chat/preferences.json`): the options
 * each agent's sessions offered last, and what a new thread starts with. The desktop app's start
 * screen reads it to offer a model before any server runs (ADR 0062).
 */
export const ChatPreferencesFile = Schema.Struct({
  agents: Schema.Array(AgentOptions),
  defaults: ChatDefaults,
});
export type ChatPreferencesFile = typeof ChatPreferencesFile.Type;

/**
 * What a tool call produced. The agent sends text, a diff of a file it is changing, or the id of
 * a terminal whose output arrives on its own; the editor shows each of them differently, so none
 * of it is flattened into a string.
 */
export const ToolContent = Schema.Union([
  Schema.Struct({ text: Schema.String, type: Schema.Literal("text") }),
  Schema.Struct({
    newText: Schema.String,
    oldText: Schema.optional(Schema.String),
    path: Schema.String,
    type: Schema.Literal("diff"),
  }),
  Schema.Struct({
    /** The tail of what it printed, once it ended; while it runs, its output streams apart. */
    output: Schema.optional(Schema.String),
    terminalId: Schema.String,
    type: Schema.Literal("terminal"),
  }),
]);

/** How much of a terminal's output the editor keeps: its last characters. */
export const TERMINAL_TAIL = 8000;
export type ToolContent = typeof ToolContent.Type;

/** Where in the repository a tool call is working, to the line when the agent says so. */
export const ToolLocation = Schema.Struct({
  line: Schema.optional(Schema.Number),
  path: Schema.String,
});
export type ToolLocation = typeof ToolLocation.Type;

/**
 * What a turn spent, in the agent's own accounting, as ACP's `Usage` says it. Absent when it
 * keeps none. A turn written before had `cachedInputTokens`, read as `cachedReadTokens`.
 */
export const TurnUsage = Schema.Struct({
  /** Split by model, where the agent says (Codex, Claude Code, in their `_meta`). */
  byModel: Schema.optional(
    Schema.Array(Schema.Struct({ model: Schema.String, tokens: Schema.Number }))
  ),
  cachedReadTokens: Schema.optional(Schema.Number),
  cachedWriteTokens: Schema.optional(Schema.Number),
  inputTokens: Schema.Number,
  outputTokens: Schema.Number,
  thoughtTokens: Schema.optional(Schema.Number),
  totalTokens: Schema.Number,
});
export type TurnUsage = typeof TurnUsage.Type;

export const QuestionOption = Schema.Struct({
  description: Schema.optional(Schema.String),
  id: Schema.String,
  label: Schema.String,
});
export type QuestionOption = typeof QuestionOption.Type;

/** One question an agent puts to the user, with the answers it offers. */
export const Question = Schema.Struct({
  /** The user may type an answer of their own instead of picking one. */
  allowOther: Schema.optional(Schema.Boolean),
  /** More on what is asked, shown under the question. */
  description: Schema.optional(Schema.String),
  id: Schema.String,
  /** Several options may be picked; the answer is all of them. */
  multiple: Schema.optional(Schema.Boolean),
  /** The question may be left unanswered. */
  optional: Schema.optional(Schema.Boolean),
  options: Schema.Array(QuestionOption),
  question: Schema.String,
  /**
   * With no options, the answer is typed; this says what it must be. The user picks yes or no
   * for a `boolean`, which comes with its two options.
   */
  value: Schema.optional(
    Schema.Literals(["text", "number", "integer", "boolean"])
  ),
});
export type Question = typeof Question.Type;

/** An answer: the option picked or the text typed, or every option picked of a `multiple` one. */
export const Answer = Schema.Union([
  Schema.String,
  Schema.Array(Schema.String),
]);
export type Answer = typeof Answer.Type;

/** The answers to a card, by question id. */
export const Answers = Schema.Record(Schema.String, Answer);
export type Answers = typeof Answers.Type;

/** What kind of thing a tool call does, as ACP names it, for its icon. */
export const ToolKind = Schema.Literals([
  "read",
  "edit",
  "delete",
  "move",
  "search",
  "execute",
  "think",
  "fetch",
  "switch_mode",
  "other",
]);
export type ToolKind = typeof ToolKind.Type;

/** Why the agent ended a turn, as ACP says it. */
export const StopReason = Schema.Literals([
  "end_turn",
  "max_tokens",
  "max_turn_requests",
  "refusal",
  "cancelled",
]);
export type StopReason = typeof StopReason.Type;

const ToolCallStatus = Schema.Literals([
  "pending",
  "in_progress",
  "completed",
  "failed",
]);

/** How a review model's look at a round went. */
export const ReviewerStatus = Schema.Literals(["looking", "done", "no-score"]);
export type ReviewerStatus = typeof ReviewerStatus.Type;

/** One review model in one round of a design's review (ADR 0063). */
export const RoundReviewer = Schema.Struct({
  /** Whether it approved the design as it is. */
  approved: Schema.optional(Schema.Boolean),
  /** How many findings it gave. */
  findings: Schema.Number,
  /** Its lab name (`opus`, `gpt-6.1-sol`): the goal's and the log's key for it. */
  key: Schema.String,
  /** The model as the agent names it, for the round's line. */
  name: Schema.String,
  /** Why it has no score, when it has none: "It didn't answer in 5 minutes." */
  reason: Schema.optional(Schema.String),
  /** Its overall out of 100, once it has one. */
  score: Schema.optional(Schema.Number),
  status: ReviewerStatus,
});
export type RoundReviewer = typeof RoundReviewer.Type;

/** A finding as the transcript shows it, with the designer's answer once it has one. */
export const RoundFinding = Schema.Struct({
  category: Category,
  /** The designer's reason when it declined it. */
  declined: Schema.optional(Schema.String),
  fix: Schema.String,
  problem: Schema.String,
  /** Who found it, by `RoundReviewer.key`. */
  reviewer: Schema.String,
  severity: Severity,
  title: Schema.String,
  where: Schema.String,
});
export type RoundFinding = typeof RoundFinding.Type;

/** Why a design's review stopped (contracts' `review` `StopReason`), or that it couldn't start. */
export const ReviewEnd = Schema.Literals([
  "approved",
  "goal",
  "max-rounds",
  "plateau",
  "budget",
  "no-scores",
  "stopped",
  "failed",
]);
export type ReviewEnd = typeof ReviewEnd.Type;

export const ThreadItem = Schema.Union([
  Schema.Struct({
    at: Schema.Number,
    attachments: Schema.Array(Schema.String),
    id: Schema.String,
    kind: Schema.Literal("user"),
    /**
     * The prompt carries a review round's findings to the designer, sent by the editor (ADR 0063):
     * the id of that round's item, which shows them, so the transcript doesn't.
     */
    review: Schema.optional(Schema.String),
    text: Schema.String,
  }),
  Schema.Struct({
    at: Schema.Number,
    id: Schema.String,
    kind: Schema.Literal("agent"),
    text: Schema.String,
  }),
  Schema.Struct({
    at: Schema.Number,
    id: Schema.String,
    kind: Schema.Literal("thought"),
    text: Schema.String,
  }),
  Schema.Struct({
    at: Schema.Number,
    content: Schema.Array(ToolContent),
    id: Schema.String,
    kind: Schema.Literal("tool"),
    locations: Schema.Array(ToolLocation),
    status: ToolCallStatus,
    title: Schema.String,
    toolCallId: Schema.String,
    toolKind: Schema.optional(ToolKind),
  }),
  Schema.Struct({
    at: Schema.Number,
    entries: Schema.Array(
      Schema.Struct({
        content: Schema.String,
        priority: Schema.optional(Schema.Literals(["high", "medium", "low"])),
        status: Schema.Literals(["pending", "in_progress", "completed"]),
      })
    ),
    id: Schema.String,
    kind: Schema.Literal("plan"),
  }),
  Schema.Struct({
    at: Schema.Number,
    decision: Schema.NullOr(Schema.String),
    detail: Schema.optional(Schema.String),
    id: Schema.String,
    kind: Schema.Literal("permission"),
    options: Schema.Array(
      Schema.Struct({
        kind: Schema.Literals([
          "allow_once",
          "allow_always",
          "reject_once",
          "reject_always",
        ]),
        name: Schema.String,
        optionId: Schema.String,
      })
    ),
    requestId: Schema.String,
    title: Schema.String,
    toolCallId: Schema.optional(Schema.String),
  }),
  /**
   * Questions put to the user. Two ways they come:
   * - The agent waits for the answers within its turn (`elicitation`): an MCP server, the
   *   editor's `ask_user` among them, asked through the agent, and the answers go back the same
   *   way. The user may also decline.
   * - The agent asked with `ask_user` and ended its turn, because it cannot wait: the answers
   *   are sent as the next prompt.
   */
  Schema.Struct({
    /** Question id → the answer. Null while unanswered. */
    answers: Schema.NullOr(Answers),
    at: Schema.Number,
    /** Present when the agent waits for the answers: what it says it needs them for. */
    elicitation: Schema.optional(Schema.Struct({ message: Schema.String })),
    id: Schema.String,
    kind: Schema.Literal("question"),
    /** Why there are no answers: the user declined, or the agent stopped waiting. */
    outcome: Schema.optional(Schema.Literals(["declined", "cancelled"])),
    questions: Schema.Array(Question),
  }),
  Schema.Struct({
    at: Schema.Number,
    id: Schema.String,
    kind: Schema.Literal("status"),
    /** The agent the thread was switched to, when that is what the line says. */
    switchedTo: Schema.optional(Schema.String),
    text: Schema.String,
  }),
  Schema.Struct({
    at: Schema.Number,
    /**
     * Files changed during the turn that the agent was not seen writing, while something else
     * changed files too (another thread's turn, the user in the editor): changed during the turn,
     * not known to be by its agent. Absent when there were none, and in older stored turns.
     */
    changedDuring: Schema.optional(Schema.Array(Schema.String)),
    /** The files the turn changed, the agent's: all of them unless something else wrote meanwhile. */
    changedFiles: Schema.Array(Schema.String),
    id: Schema.String,
    kind: Schema.Literal("turn_end"),
    stopReason: StopReason,
    /** What the turn spent, as the agent accounts for it, split by model. */
    usage: Schema.optional(TurnUsage),
  }),
  /**
   * One round of a design's review (ADR 0063): who looked, what they scored and found, and what
   * the designer did with it. Updated in place as reviewers answer and the designer replies; the
   * round that ends the review carries why.
   */
  Schema.Struct({
    at: Schema.Number,
    /** The whole set of review models looking at the page as it stands, before the end. */
    closing: Schema.optional(Schema.Boolean),
    /** Why the review ended after this round, and who was still short. */
    end: Schema.optional(
      Schema.Struct({
        /** The round kept, from 1: not always the last. */
        best: Schema.optional(Schema.Number),
        /** What went wrong, when it failed: "Codex isn't signed in." */
        problem: Schema.optional(Schema.String),
        reason: ReviewEnd,
        unmet: Schema.Array(Schema.String),
      })
    ),
    findings: Schema.Array(RoundFinding),
    /** How many findings the designer fixed, once it answered the round. */
    fixed: Schema.optional(Schema.Number),
    id: Schema.String,
    kind: Schema.Literal("review"),
    maxRounds: Schema.Number,
    reviewers: Schema.Array(RoundReviewer),
    /** From 1. */
    round: Schema.Number,
  }),
]);
export type ThreadItem = typeof ThreadItem.Type;

export const PromptInput = Schema.Struct({
  attachments: Schema.Array(PromptAttachment),
  text: Schema.String,
  threadId: FileId,
});
export type PromptInput = typeof PromptInput.Type;

/** The name the editor's MCP server goes by, to agents and in the tool calls they report. */
export const EDITOR_MCP_SERVER = "ultrapaint";

/**
 * How each agent names a tool of a server: Claude Code `mcp__ultrapaint__list_pages`, Codex
 * `mcp.ultrapaint.list_pages`. Other agents may use either, so both are recognised.
 */
const EDITOR_MCP_CALL_RE = new RegExp(
  `(^|_)mcp__${EDITOR_MCP_SERVER}__|^mcp\\.${EDITOR_MCP_SERVER}\\.`
);

/**
 * Whether a tool call's title is the agent asking the editor. The call's kind cannot say: Claude
 * Code reports these as `other` and Codex as `execute`.
 */
export const isEditorMcpCall = (title: string | undefined): boolean =>
  title !== undefined && EDITOR_MCP_CALL_RE.test(title);

/** What an agent outside the editor needs to reach its MCP server. */
export const McpConnection = Schema.Struct({
  /** Off when the server was started with `--no-mcp`. */
  enabled: Schema.Boolean,
  header: Schema.String,
  /** The token was one made the old, guessable way and is new since the server started. */
  replaced: Schema.Boolean,
  token: Schema.String,
  url: Schema.String,
});
export type McpConnection = typeof McpConnection.Type;

/**
 * An agent saying which page it is working on, so the canvas can show and follow it, and which of
 * its nodes it is about to change and how, so they show its work while it is under way.
 */
export const AgentFocus = Schema.Struct({
  /** What the agent is doing to them, in a few words: "formatting the dates". */
  action: Schema.optional(Schema.String),
  /** The nodes of the page it is about to change; none means the page as a whole. */
  nodeIds: Schema.optional(Schema.Array(Schema.String)),
  /**
   * The document it works on: a page's id (a route alone can be a page in more than one canvas),
   * or a canvas's for a node beside the pages, as `AgentEdited.doc` says it.
   */
  pageId: Schema.String,
  route: Schema.optional(Schema.String),
  threadId: Schema.String,
});
export type AgentFocus = typeof AgentFocus.Type;

/** Nodes an agent's operations changed, and in which document: its work, shown where it lands. */
export const AgentEdited = Schema.Struct({
  /** The page's id, or the document of the canvas's loose nodes. */
  doc: Schema.String,
  label: Schema.optional(Schema.String),
  nodeIds: Schema.Array(Schema.String),
  threadId: Schema.String,
});
export type AgentEdited = typeof AgentEdited.Type;

/** Output of a terminal the agent is running, as it arrives. */
export const AgentTerminalOutput = Schema.Struct({
  chunk: Schema.String,
  terminalId: Schema.String,
  threadId: Schema.String,
});
export type AgentTerminalOutput = typeof AgentTerminalOutput.Type;

export const AgentEvent = Schema.Union([
  Schema.Struct({ thread: Thread, type: Schema.Literal("thread") }),
  Schema.Struct({
    item: ThreadItem,
    threadId: Schema.String,
    type: Schema.Literal("item"),
  }),
  Schema.Struct({
    item: ThreadItem,
    threadId: Schema.String,
    type: Schema.Literal("itemUpdate"),
  }),
  /** A streamed chunk: `text` goes at the end of the item's own, sent without the rest of it. */
  Schema.Struct({
    itemId: Schema.String,
    text: Schema.String,
    threadId: Schema.String,
    type: Schema.Literal("itemText"),
  }),
  Schema.Struct({ threadId: Schema.String, type: Schema.Literal("removed") }),
]);
export type AgentEvent = typeof AgentEvent.Type;

const MARKDOWN_RE = /[*_`#>[\]]+/g;
const SPACES_RE = /\s+/g;

/** What an item says, as the list of threads quotes it. */
const textOf = (item: ThreadItem | undefined): string => {
  switch (item?.kind) {
    case "question":
      return item.questions[0]?.question ?? "";
    case "permission":
      return item.title;
    case "agent":
    case "user":
      return item.text;
    default:
      return "";
  }
};

/**
 * A thread's last line, and whether it waits on the user: a question unanswered or a permission
 * undecided. What the list of threads shows under each title.
 */
export const summarise = (
  items: readonly ThreadItem[]
): { text: string; waiting: boolean } => {
  const pending = items.findLast(
    (i) =>
      (i.kind === "question" && i.answers === null) ||
      (i.kind === "permission" && i.decision === null)
  );
  const said = items.findLast((i) => i.kind === "agent" || i.kind === "user");
  const text = textOf(pending ?? said);
  const line =
    text
      .split("\n")
      .map((l) => l.replace(MARKDOWN_RE, "").replace(SPACES_RE, " ").trim())
      .find(Boolean) ?? "";
  return { text: line, waiting: pending !== undefined };
};
