import { Schema } from "effect";
import { Json } from "./base.ts";

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
   * sandbox, wherever they are. `~` is the user's home directory, `<uid>` their user id.
   */
  stateDirs: Schema.optional(Schema.Array(Schema.String)),
});
export type AgentConfig = typeof AgentConfig.Type;

export const ThreadStatus = Schema.Literals([
  "idle",
  "starting",
  "running",
  "cancelling",
  "error",
  "closed",
]);
export type ThreadStatus = typeof ThreadStatus.Type;

export const Thread = Schema.Struct({
  agentId: Schema.String,
  configOptions: Schema.optional(
    Schema.Array(
      Schema.Struct({
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
      })
    )
  ),
  createdAt: Schema.Number,
  currentModeId: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
  id: Schema.String,
  /** Advertised session modes, generic. */
  modes: Schema.optional(
    Schema.Array(
      Schema.Struct({
        description: Schema.optional(Schema.String),
        id: Schema.String,
        name: Schema.String,
      })
    )
  ),
  /** Whether the agent process is confined to the repository by the operating system. */
  sandboxed: Schema.optional(Schema.Boolean),
  sessionId: Schema.optional(Schema.String),
  status: ThreadStatus,
  title: Schema.String,
  updatedAt: Schema.Number,
});
export type Thread = typeof Thread.Type;

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
    terminalId: Schema.String,
    type: Schema.Literal("terminal"),
  }),
]);
export type ToolContent = typeof ToolContent.Type;

/** Where in the repository a tool call is working, to the line when the agent says so. */
export const ToolLocation = Schema.Struct({
  line: Schema.optional(Schema.Number),
  path: Schema.String,
});
export type ToolLocation = typeof ToolLocation.Type;

export const ToolCallStatus = Schema.Literals([
  "pending",
  "in_progress",
  "completed",
  "failed",
]);

export const ThreadItem = Schema.Union([
  Schema.Struct({
    at: Schema.Number,
    attachments: Schema.Array(Schema.String),
    id: Schema.String,
    kind: Schema.Literal("user"),
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
    toolKind: Schema.optional(Schema.String),
  }),
  Schema.Struct({
    at: Schema.Number,
    entries: Schema.Array(
      Schema.Struct({
        content: Schema.String,
        priority: Schema.optional(Schema.String),
        status: Schema.String,
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
        kind: Schema.String,
        name: Schema.String,
        optionId: Schema.String,
      })
    ),
    requestId: Schema.String,
    title: Schema.String,
    toolCallId: Schema.optional(Schema.String),
  }),
  Schema.Struct({
    at: Schema.Number,
    id: Schema.String,
    kind: Schema.Literal("status"),
    text: Schema.String,
  }),
  Schema.Struct({
    at: Schema.Number,
    changedFiles: Schema.Array(Schema.String),
    id: Schema.String,
    kind: Schema.Literal("turn_end"),
    stopReason: Schema.String,
  }),
]);
export type ThreadItem = typeof ThreadItem.Type;

export const PromptAttachment = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("file"), path: Schema.String }),
  Schema.Struct({
    col: Schema.Number,
    file: Schema.String,
    kind: Schema.Literal("selection"),
    line: Schema.Number,
    name: Schema.String,
  }),
  Schema.Struct({
    dataUrl: Schema.String,
    kind: Schema.Literal("image"),
    name: Schema.String,
  }),
]);
export type PromptAttachment = typeof PromptAttachment.Type;

export const PromptInput = Schema.Struct({
  attachments: Schema.Array(PromptAttachment),
  text: Schema.String,
  threadId: Schema.String,
});
export type PromptInput = typeof PromptInput.Type;

/** What an agent outside the editor needs to reach its MCP server. */
export const McpConnection = Schema.Struct({
  /** Off when the server was started with `--no-mcp`. */
  enabled: Schema.Boolean,
  header: Schema.String,
  token: Schema.String,
  url: Schema.String,
});
export type McpConnection = typeof McpConnection.Type;

/** An agent saying which page it is working on, so the canvas can show and follow it. */
export const AgentFocus = Schema.Struct({
  route: Schema.String,
  threadId: Schema.String,
});
export type AgentFocus = typeof AgentFocus.Type;

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
  Schema.Struct({ threadId: Schema.String, type: Schema.Literal("removed") }),
]);
export type AgentEvent = typeof AgentEvent.Type;

export const _json = Json;
