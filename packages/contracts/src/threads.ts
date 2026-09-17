import * as S from "effect/Schema";
import { Json } from "./base.ts";

export const AgentConfig = S.Struct({
  id: S.String,
  name: S.String,
  /** Executable; resolved through PATH or `npx` when `package` is set. */
  command: S.String,
  args: S.Array(S.String),
  env: S.Record({ key: S.String, value: S.String }),
  /** npm package that provides the command, used for `npx` fallback and install hints. */
  package: S.optional(S.String),
  authHint: S.optional(S.String),
  builtIn: S.Boolean,
});
export type AgentConfig = typeof AgentConfig.Type;

export const ThreadStatus = S.Literal(
  "idle",
  "starting",
  "running",
  "cancelling",
  "error",
  "closed",
);
export type ThreadStatus = typeof ThreadStatus.Type;

export const Thread = S.Struct({
  id: S.String,
  agentId: S.String,
  title: S.String,
  createdAt: S.Number,
  updatedAt: S.Number,
  status: ThreadStatus,
  sessionId: S.optional(S.String),
  error: S.optional(S.String),
  currentModeId: S.optional(S.String),
  /** Advertised session modes, generic. */
  modes: S.optional(
    S.Array(S.Struct({ id: S.String, name: S.String, description: S.optional(S.String) })),
  ),
  configOptions: S.optional(
    S.Array(
      S.Struct({
        id: S.String,
        name: S.String,
        category: S.optional(S.String),
        currentValue: S.String,
        options: S.Array(
          S.Struct({ value: S.String, name: S.String, description: S.optional(S.String) }),
        ),
      }),
    ),
  ),
});
export type Thread = typeof Thread.Type;

export const ToolCallStatus = S.Literal("pending", "in_progress", "completed", "failed");

export const ThreadItem = S.Union(
  S.Struct({
    id: S.String,
    kind: S.Literal("user"),
    text: S.String,
    at: S.Number,
    attachments: S.Array(S.String),
  }),
  S.Struct({ id: S.String, kind: S.Literal("agent"), text: S.String, at: S.Number }),
  S.Struct({ id: S.String, kind: S.Literal("thought"), text: S.String, at: S.Number }),
  S.Struct({
    id: S.String,
    kind: S.Literal("tool"),
    toolCallId: S.String,
    title: S.String,
    toolKind: S.optional(S.String),
    status: ToolCallStatus,
    content: S.Array(S.String),
    locations: S.Array(S.String),
    at: S.Number,
  }),
  S.Struct({
    id: S.String,
    kind: S.Literal("plan"),
    entries: S.Array(
      S.Struct({ content: S.String, status: S.String, priority: S.optional(S.String) }),
    ),
    at: S.Number,
  }),
  S.Struct({
    id: S.String,
    kind: S.Literal("permission"),
    requestId: S.String,
    toolCallId: S.optional(S.String),
    title: S.String,
    detail: S.optional(S.String),
    options: S.Array(S.Struct({ optionId: S.String, name: S.String, kind: S.String })),
    decision: S.NullOr(S.String),
    at: S.Number,
  }),
  S.Struct({ id: S.String, kind: S.Literal("status"), text: S.String, at: S.Number }),
  S.Struct({
    id: S.String,
    kind: S.Literal("turn_end"),
    stopReason: S.String,
    changedFiles: S.Array(S.String),
    at: S.Number,
  }),
);
export type ThreadItem = typeof ThreadItem.Type;

export const PromptAttachment = S.Union(
  S.Struct({ kind: S.Literal("file"), path: S.String }),
  S.Struct({
    kind: S.Literal("selection"),
    file: S.String,
    line: S.Number,
    col: S.Number,
    name: S.String,
  }),
  S.Struct({ kind: S.Literal("image"), dataUrl: S.String, name: S.String }),
);
export type PromptAttachment = typeof PromptAttachment.Type;

export const PromptInput = S.Struct({
  threadId: S.String,
  text: S.String,
  attachments: S.Array(PromptAttachment),
});
export type PromptInput = typeof PromptInput.Type;

export const AgentEvent = S.Union(
  S.Struct({ type: S.Literal("thread"), thread: Thread }),
  S.Struct({ type: S.Literal("item"), threadId: S.String, item: ThreadItem }),
  S.Struct({ type: S.Literal("itemUpdate"), threadId: S.String, item: ThreadItem }),
  S.Struct({ type: S.Literal("removed"), threadId: S.String }),
);
export type AgentEvent = typeof AgentEvent.Type;

export const _json = Json;
