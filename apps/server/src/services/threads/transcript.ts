/**
 * Projection of ACP `session/update` notifications into the transcript the editor renders.
 * Pure: it returns what should happen and leaves persistence and publishing to the caller.
 */
import type { SessionNotification } from "@ultrapaint/acp/acp-agent";
import type {
  Thread,
  ThreadItem,
  ToolContent,
  ToolLocation,
  TurnUsage,
} from "@ultrapaint/contracts/threads";

type SessionUpdate = SessionNotification["update"];

/** Which transcript items the streaming chunks of the current turn are appended to. */
export interface TurnCursor {
  agentItemId: string | null;
  planItemId: string | null;
  thoughtItemId: string | null;
}

export const emptyCursor = (): TurnCursor => ({
  agentItemId: null,
  planItemId: null,
  thoughtItemId: null,
});

export type TranscriptAction =
  | { readonly type: "push"; readonly item: ThreadItem }
  | {
      readonly type: "patch";
      readonly itemId: string;
      readonly patch: (item: ThreadItem) => ThreadItem;
    }
  | { readonly type: "thread"; readonly patch: Partial<Thread> };

export interface ProjectionContext {
  readonly hasItem: (itemId: string) => boolean;
  readonly newId: () => string;
  readonly now: number;
  /**
   * Agents name the files they touch by absolute path; the editor knows its pages by their path
   * in the repository. Everything that crosses the wire is repository-relative.
   */
  readonly relative: (path: string) => string;
  /** Mutated as chunks arrive. `null` outside a turn, where every chunk starts a new item. */
  readonly turn: TurnCursor | null;
}

/** A tool call's content as ACP sends it, before the editor's own shape. */
interface RawToolContent {
  readonly content?: { readonly text?: string; readonly type: string };
  readonly newText?: string;
  readonly oldText?: string | null;
  readonly path?: string;
  readonly terminalId?: string;
  readonly type: string;
}

/** Keeps what the editor can show by itself: text, a file's diff, a terminal to follow. */
export const toolContent = (
  c: RawToolContent,
  ctx: ProjectionContext
): ToolContent => {
  switch (c.type) {
    case "content":
      return {
        text:
          c.content?.type === "text"
            ? (c.content.text ?? "")
            : `[${c.content?.type ?? "content"}]`,
        type: "text",
      };
    case "diff":
      return {
        newText: c.newText ?? "",
        path: ctx.relative(c.path ?? ""),
        type: "diff",
        ...(c.oldText === null || c.oldText === undefined
          ? {}
          : { oldText: c.oldText }),
      };
    case "terminal":
      return { terminalId: c.terminalId ?? "", type: "terminal" };
    default:
      return { text: `[${c.type}]`, type: "text" };
  }
};

const toolLocations = (
  locations: readonly {
    readonly line?: number | null;
    readonly path: string;
  }[],
  ctx: ProjectionContext
): ToolLocation[] =>
  locations.map((l) => ({
    path: ctx.relative(l.path),
    ...(l.line === null || l.line === undefined ? {} : { line: l.line }),
  }));

interface RawConfigOption {
  readonly category?: string | null;
  readonly currentValue: unknown;
  readonly id: string;
  readonly name: string;
  readonly options?: readonly {
    readonly description?: string | null;
    readonly name: string;
    readonly value: string;
  }[];
  readonly type: string;
}

const BOOLEAN_OPTIONS = [
  { name: "On", value: "true" },
  { name: "Off", value: "false" },
];

/** Agents describe select and boolean options; the editor renders both as a list of choices. */
export const mapConfigOptions = (options: unknown): Thread["configOptions"] => {
  if (!Array.isArray(options)) {
    return;
  }
  return (options as RawConfigOption[]).map((opt) => ({
    id: opt.id,
    name: opt.name,
    ...(opt.category ? { category: opt.category } : {}),
    currentValue: String(opt.currentValue),
    options:
      opt.type === "boolean"
        ? BOOLEAN_OPTIONS
        : (opt.options ?? []).map((x) => ({
            name: x.name,
            value: x.value,
            ...(x.description ? { description: x.description } : {}),
          })),
  }));
};

interface RawQuota {
  readonly model_usage?: readonly {
    readonly model: string;
    readonly token_count?: { readonly totalTokens?: number };
  }[];
  readonly token_count?: {
    readonly cachedInputTokens?: number;
    readonly inputTokens?: number;
    readonly outputTokens?: number;
    readonly totalTokens?: number;
  };
}

/**
 * What a turn spent, as the agent reports it alongside the response. Agents that keep no
 * accounting send nothing, and the turn simply has no cost to show.
 */
export const turnUsage = (meta: unknown): TurnUsage | undefined => {
  const quota = (meta as { quota?: RawQuota } | undefined)?.quota;
  const total = quota?.token_count;
  if (!total) {
    return;
  }
  return {
    byModel: (quota.model_usage ?? []).map((entry) => ({
      model: entry.model,
      tokens: entry.token_count?.totalTokens ?? 0,
    })),
    cachedInputTokens: total.cachedInputTokens ?? 0,
    inputTokens: total.inputTokens ?? 0,
    outputTokens: total.outputTokens ?? 0,
    totalTokens: total.totalTokens ?? 0,
  };
};

const appendText =
  (kind: "agent" | "thought", text: string) =>
  (item: ThreadItem): ThreadItem =>
    item.kind === kind ? { ...item, text: item.text + text } : item;

/** A streamed chunk extends the open item of its kind, or opens one and closes the other. */
const projectChunk = (
  kind: "agent" | "thought",
  text: string,
  ctx: ProjectionContext
): TranscriptAction[] => {
  const key = kind === "agent" ? "agentItemId" : "thoughtItemId";
  const other = kind === "agent" ? "thoughtItemId" : "agentItemId";
  const open = ctx.turn?.[key];
  if (open) {
    return [{ itemId: open, patch: appendText(kind, text), type: "patch" }];
  }
  const item: ThreadItem = { at: ctx.now, id: ctx.newId(), kind, text };
  if (ctx.turn) {
    ctx.turn[key] = item.id;
    ctx.turn[other] = null;
  }
  return [{ item, type: "push" }];
};

type ToolUpdate = Extract<
  SessionUpdate,
  { sessionUpdate: "tool_call" | "tool_call_update" }
>;

const toolItem = (
  u: ToolUpdate,
  ctx: ProjectionContext,
  fallback: { status: "pending" | "in_progress"; title: string }
): ThreadItem => ({
  at: ctx.now,
  content: ((u.content ?? []) as RawToolContent[]).map((c) =>
    toolContent(c, ctx)
  ),
  id: `tool_${u.toolCallId}`,
  kind: "tool",
  locations: toolLocations(u.locations ?? [], ctx),
  status: u.status ?? fallback.status,
  title: u.title ?? fallback.title,
  toolCallId: u.toolCallId,
  ...(u.kind ? { toolKind: u.kind } : {}),
});

const projectToolUpdate = (
  u: Extract<SessionUpdate, { sessionUpdate: "tool_call_update" }>,
  ctx: ProjectionContext
): TranscriptAction[] => {
  const itemId = `tool_${u.toolCallId}`;
  if (!ctx.hasItem(itemId)) {
    const item = toolItem(u, ctx, {
      status: "in_progress",
      title: "Tool call",
    });
    return [{ item, type: "push" }];
  }
  return [
    {
      itemId,
      patch: (i) =>
        i.kind === "tool"
          ? {
              ...i,
              content: u.content
                ? (u.content as RawToolContent[]).map((c) =>
                    toolContent(c, ctx)
                  )
                : i.content,
              locations: u.locations
                ? toolLocations(u.locations, ctx)
                : i.locations,
              status: u.status ?? i.status,
              title: u.title ?? i.title,
            }
          : i,
      type: "patch",
    },
  ];
};

const projectPlan = (
  u: SessionUpdate,
  ctx: ProjectionContext
): TranscriptAction[] => {
  const raw = (u as { entries?: unknown }).entries;
  const entries = Array.isArray(raw)
    ? (raw as { content: string; priority?: string; status: string }[]).map(
        (e) => ({
          content: e.content,
          priority: e.priority,
          status: e.status,
        })
      )
    : [];
  const open = ctx.turn?.planItemId;
  if (open) {
    return [
      {
        itemId: open,
        patch: (i) => (i.kind === "plan" ? { ...i, entries } : i),
        type: "patch",
      },
    ];
  }
  const item: ThreadItem = {
    at: ctx.now,
    entries,
    id: ctx.newId(),
    kind: "plan",
  };
  if (ctx.turn) {
    ctx.turn.planItemId = item.id;
  }
  return [{ item, type: "push" }];
};

export const projectUpdate = (
  u: SessionUpdate,
  ctx: ProjectionContext
): TranscriptAction[] => {
  switch (u.sessionUpdate) {
    case "agent_message_chunk":
      return projectChunk(
        "agent",
        u.content.type === "text" ? u.content.text : `[${u.content.type}]`,
        ctx
      );
    case "agent_thought_chunk":
      return projectChunk(
        "thought",
        u.content.type === "text" ? u.content.text : "",
        ctx
      );
    case "tool_call": {
      if (ctx.turn) {
        ctx.turn.agentItemId = null;
        ctx.turn.thoughtItemId = null;
      }
      const item = toolItem(u, ctx, { status: "pending", title: u.title });
      return [{ item, type: "push" }];
    }
    case "tool_call_update":
      return projectToolUpdate(u, ctx);
    case "plan":
    case "plan_update":
      return projectPlan(u, ctx);
    case "current_mode_update":
      return [{ patch: { currentModeId: u.currentModeId }, type: "thread" }];
    case "config_option_update":
      return [
        {
          patch: { configOptions: mapConfigOptions(u.configOptions) },
          type: "thread",
        },
      ];
    case "session_info_update": {
      const { title } = u as { title?: string | null };
      return title ? [{ patch: { title }, type: "thread" }] : [];
    }
    default:
      return [];
  }
};
