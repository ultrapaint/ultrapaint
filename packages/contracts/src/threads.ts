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
  sessionId: Schema.optional(Schema.String),
  status: ThreadStatus,
  title: Schema.String,
  updatedAt: Schema.Number,
});
export type Thread = typeof Thread.Type;

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
    content: Schema.Array(Schema.String),
    id: Schema.String,
    kind: Schema.Literal("tool"),
    locations: Schema.Array(Schema.String),
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
