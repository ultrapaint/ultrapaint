import { Schema as S } from "effect";
import { Json } from "./base.ts";

export const AgentConfig = S.Struct({
  args: S.Array(S.String),
  authHint: S.optional(S.String),
  builtIn: S.Boolean,
  /** Executable; resolved through PATH or `npx` when `package` is set. */
  command: S.String,
  env: S.Record({ key: S.String, value: S.String }),
  id: S.String,
  name: S.String,
  /** npm package that provides the command, used for `npx` fallback and install hints. */
  package: S.optional(S.String),
});
export type AgentConfig = typeof AgentConfig.Type;

export const ThreadStatus = S.Literal(
  "idle",
  "starting",
  "running",
  "cancelling",
  "error",
  "closed"
);
export type ThreadStatus = typeof ThreadStatus.Type;

export const Thread = S.Struct({
  agentId: S.String,
  configOptions: S.optional(
    S.Array(
      S.Struct({
        category: S.optional(S.String),
        currentValue: S.String,
        id: S.String,
        name: S.String,
        options: S.Array(
          S.Struct({
            description: S.optional(S.String),
            name: S.String,
            value: S.String,
          })
        ),
      })
    )
  ),
  createdAt: S.Number,
  currentModeId: S.optional(S.String),
  error: S.optional(S.String),
  id: S.String,
  /** Advertised session modes, generic. */
  modes: S.optional(
    S.Array(
      S.Struct({
        description: S.optional(S.String),
        id: S.String,
        name: S.String,
      })
    )
  ),
  sessionId: S.optional(S.String),
  status: ThreadStatus,
  title: S.String,
  updatedAt: S.Number,
});
export type Thread = typeof Thread.Type;

export const ToolCallStatus = S.Literal(
  "pending",
  "in_progress",
  "completed",
  "failed"
);

export const ThreadItem = S.Union(
  S.Struct({
    at: S.Number,
    attachments: S.Array(S.String),
    id: S.String,
    kind: S.Literal("user"),
    text: S.String,
  }),
  S.Struct({
    at: S.Number,
    id: S.String,
    kind: S.Literal("agent"),
    text: S.String,
  }),
  S.Struct({
    at: S.Number,
    id: S.String,
    kind: S.Literal("thought"),
    text: S.String,
  }),
  S.Struct({
    at: S.Number,
    content: S.Array(S.String),
    id: S.String,
    kind: S.Literal("tool"),
    locations: S.Array(S.String),
    status: ToolCallStatus,
    title: S.String,
    toolCallId: S.String,
    toolKind: S.optional(S.String),
  }),
  S.Struct({
    at: S.Number,
    entries: S.Array(
      S.Struct({
        content: S.String,
        priority: S.optional(S.String),
        status: S.String,
      })
    ),
    id: S.String,
    kind: S.Literal("plan"),
  }),
  S.Struct({
    at: S.Number,
    decision: S.NullOr(S.String),
    detail: S.optional(S.String),
    id: S.String,
    kind: S.Literal("permission"),
    options: S.Array(
      S.Struct({ kind: S.String, name: S.String, optionId: S.String })
    ),
    requestId: S.String,
    title: S.String,
    toolCallId: S.optional(S.String),
  }),
  S.Struct({
    at: S.Number,
    id: S.String,
    kind: S.Literal("status"),
    text: S.String,
  }),
  S.Struct({
    at: S.Number,
    changedFiles: S.Array(S.String),
    id: S.String,
    kind: S.Literal("turn_end"),
    stopReason: S.String,
  })
);
export type ThreadItem = typeof ThreadItem.Type;

export const PromptAttachment = S.Union(
  S.Struct({ kind: S.Literal("file"), path: S.String }),
  S.Struct({
    col: S.Number,
    file: S.String,
    kind: S.Literal("selection"),
    line: S.Number,
    name: S.String,
  }),
  S.Struct({ dataUrl: S.String, kind: S.Literal("image"), name: S.String })
);
export type PromptAttachment = typeof PromptAttachment.Type;

export const PromptInput = S.Struct({
  attachments: S.Array(PromptAttachment),
  text: S.String,
  threadId: S.String,
});
export type PromptInput = typeof PromptInput.Type;

export const AgentEvent = S.Union(
  S.Struct({ thread: Thread, type: S.Literal("thread") }),
  S.Struct({ item: ThreadItem, threadId: S.String, type: S.Literal("item") }),
  S.Struct({
    item: ThreadItem,
    threadId: S.String,
    type: S.Literal("itemUpdate"),
  }),
  S.Struct({ threadId: S.String, type: S.Literal("removed") })
);
export type AgentEvent = typeof AgentEvent.Type;

export const _json = Json;
