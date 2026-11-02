/**
 * Projection of ACP `session/update` notifications into the transcript the editor renders.
 * Pure: it returns what should happen, and the turn's cursor after it, and leaves persistence,
 * publishing and keeping the cursor to the caller.
 */
import type {
  Plan,
  PromptResponse,
  SessionConfigOption,
  SessionConfigSelectOptions,
  SessionNotification,
  ToolCallContent,
  ToolCallLocation,
} from "@ultrapaint/acp/acp-agent";
import type {
  ConfigOption,
  ContextUsage,
  Thread,
  ThreadItem,
  ToolContent,
  ToolLocation,
  TurnUsage,
} from "@ultrapaint/contracts/threads";
import { Predicate } from "effect";

type SessionUpdate = SessionNotification["update"];

/** Which transcript items the streaming chunks of the current turn are appended to. */
export interface TurnCursor {
  readonly agentItemId: string | null;
  readonly planItemId: string | null;
  readonly thoughtItemId: string | null;
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
  /** A streamed chunk at the end of an item's text: sent alone, not with the item. */
  | { readonly type: "append"; readonly itemId: string; readonly text: string }
  /** What changes of the thread, from the thread as it is. */
  | {
      readonly type: "thread";
      readonly patch: (thread: Thread) => Partial<Thread>;
    };

interface ProjectionContext {
  readonly hasItem: (itemId: string) => boolean;
  readonly newId: () => string;
  readonly now: number;
  /**
   * Agents name the files they touch by absolute path; the editor knows its pages by their path
   * in the repository. Everything that crosses the wire is repository-relative.
   */
  readonly relative: (path: string) => string;
  /** `null` outside a turn, where every chunk starts a new item. */
  readonly turn: TurnCursor | null;
}

/** What an update does to the transcript, and where the turn's next chunks go. */
interface Projection {
  readonly actions: readonly TranscriptAction[];
  readonly turn: TurnCursor | null;
}

const unmoved = (
  actions: readonly TranscriptAction[],
  ctx: ProjectionContext
): Projection => ({ actions, turn: ctx.turn });

/** Keeps what the editor can show by itself: text, a file's diff, a terminal to follow. */
export const toolContent = (
  c: ToolCallContent,
  ctx: ProjectionContext
): ToolContent => {
  switch (c.type) {
    case "content":
      return {
        text:
          c.content.type === "text" ? c.content.text : `[${c.content.type}]`,
        type: "text",
      };
    case "diff":
      return {
        newText: c.newText,
        path: ctx.relative(c.path),
        type: "diff",
        ...(c.oldText === null || c.oldText === undefined
          ? {}
          : { oldText: c.oldText }),
      };
    default:
      return { terminalId: c.terminalId, type: "terminal" };
  }
};

const toolLocations = (
  locations: readonly ToolCallLocation[],
  ctx: ProjectionContext
): ToolLocation[] =>
  locations.map((l) => ({
    path: ctx.relative(l.path),
    ...(l.line === null || l.line === undefined ? {} : { line: l.line }),
  }));

const LEADING_CD_RE = /^cd\s+("[^"]+"|'[^']+'|\S+)\s*(?:&&|;)\s*(?=\S)/;
const QUOTES_RE = /^["']|["']$/g;

/**
 * A command's title is the command, and an agent often opens it with a `cd` into the repository
 * its shell is already in: `cd /home/me/app && pnpm test`. That `cd` does nothing and pushes the
 * command itself out of the row, so it is left out. A `cd` anywhere else stays.
 */
const withoutCdToRoot = (title: string, ctx: ProjectionContext) => {
  const match: RegExpExecArray | null = LEADING_CD_RE.exec(title);
  const dir = match?.[1]?.replace(QUOTES_RE, "");
  return match && dir?.startsWith("/") && ctx.relative(dir) === ""
    ? title.slice(match[0].length)
    : title;
};

const BOOLEAN_OPTIONS = [
  { name: "On", value: "true" },
  { name: "Off", value: "false" },
];

/** A select's choices, the groups an agent sorts them in (a model's providers) laid flat. */
const choicesOf = (options: SessionConfigSelectOptions) =>
  options
    .flatMap((o) => ("group" in o ? o.options : [o]))
    .map((x) => ({
      name: x.name,
      value: x.value,
      ...(x.description ? { description: x.description } : {}),
    }));

/**
 * Agents describe select and boolean options; the editor renders both as a list of choices, and
 * keeps which kind each is, so a boolean is set as one.
 */
export const mapConfigOptions = (
  options: readonly SessionConfigOption[] | null | undefined
): Thread["configOptions"] =>
  options?.map((opt) => ({
    id: opt.id,
    name: opt.name,
    ...(opt.category ? { category: opt.category } : {}),
    currentValue: String(opt.currentValue),
    options: opt.type === "boolean" ? BOOLEAN_OPTIONS : choicesOf(opt.options),
    type: opt.type,
  }));

/** An option's value as ACP sets it: a boolean's as a boolean, a select's as its choice. */
export const optionValue = (
  option: ConfigOption | undefined,
  value: string
): string | boolean => (option?.type === "boolean" ? value === "true" : value);

/**
 * An agent may offer its mode twice, as modes and as an option of category `mode`, and say a
 * change of it either way: whichever way it changes, both say the same.
 */
const isModeOption = (option: ConfigOption) => option.category === "mode";

/** The thread with its mode changed, the mode option with it. */
export const modeSet = (
  thread: Pick<Thread, "configOptions">,
  modeId: string
): Pick<Thread, "configOptions" | "currentModeId"> => ({
  currentModeId: modeId,
  ...(thread.configOptions?.some(isModeOption)
    ? {
        configOptions: thread.configOptions.map((o) =>
          isModeOption(o) ? { ...o, currentValue: modeId } : o
        ),
      }
    : {}),
});

/** The thread with its options changed, its mode with the mode option. */
export const optionsSet = (
  thread: Pick<Thread, "currentModeId">,
  options: readonly ConfigOption[]
): Pick<Thread, "configOptions" | "currentModeId"> => ({
  configOptions: options,
  currentModeId:
    options.find(isModeOption)?.currentValue ?? thread.currentModeId,
});

/** codex-acp's own accounting in a response's `_meta`, which claude-agent-acp copies. */
interface Quota {
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

const quotaOf = (response: PromptResponse): Quota | undefined => {
  const quota = response._meta?.quota;
  return Predicate.isObject(quota) ? (quota as Quota) : undefined;
};

/**
 * What a turn spent, as the agent reports it with its answer: ACP's typed `usage` where it
 * sends one, else what Codex says in `_meta.quota`, split by model where it says that. Agents
 * that keep no accounting send nothing, and the turn simply has no cost to show.
 */
export const turnUsage = (response: PromptResponse): TurnUsage | undefined => {
  const quota = quotaOf(response);
  const byModel = quota?.model_usage?.map((entry) => ({
    model: entry.model,
    tokens: entry.token_count?.totalTokens ?? 0,
  }));
  const split = byModel?.length ? { byModel } : {};
  const { usage } = response;
  if (usage) {
    return {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      ...(Predicate.isNumber(usage.cachedReadTokens)
        ? { cachedReadTokens: usage.cachedReadTokens }
        : {}),
      ...(Predicate.isNumber(usage.cachedWriteTokens)
        ? { cachedWriteTokens: usage.cachedWriteTokens }
        : {}),
      ...(Predicate.isNumber(usage.thoughtTokens)
        ? { thoughtTokens: usage.thoughtTokens }
        : {}),
      ...split,
    };
  }
  const total = quota?.token_count;
  if (!total) {
    return;
  }
  return {
    cachedReadTokens: total.cachedInputTokens ?? 0,
    inputTokens: total.inputTokens ?? 0,
    outputTokens: total.outputTokens ?? 0,
    totalTokens: total.totalTokens ?? 0,
    ...split,
  };
};

/** How full the context is, and what the session cost, from ACP's `usage_update`. */
const contextOf = (
  u: Extract<SessionUpdate, { sessionUpdate: "usage_update" }>
): ContextUsage => ({
  size: u.size,
  used: u.used,
  ...(u.cost
    ? { cost: { amount: u.cost.amount, currency: u.cost.currency } }
    : {}),
});

/** A streamed chunk extends the open item of its kind, or opens one and closes the other. */
const projectChunk = (
  kind: "agent" | "thought",
  text: string,
  ctx: ProjectionContext
): Projection => {
  const key = kind === "agent" ? "agentItemId" : "thoughtItemId";
  const other = kind === "agent" ? "thoughtItemId" : "agentItemId";
  const open = ctx.turn?.[key];
  if (open) {
    return unmoved([{ itemId: open, text, type: "append" }], ctx);
  }
  const item: ThreadItem = { at: ctx.now, id: ctx.newId(), kind, text };
  return {
    actions: [{ item, type: "push" }],
    turn: ctx.turn && { ...ctx.turn, [key]: item.id, [other]: null },
  };
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
  content: (u.content ?? []).map((c) => toolContent(c, ctx)),
  id: `tool_${u.toolCallId}`,
  kind: "tool",
  locations: toolLocations(u.locations ?? [], ctx),
  status: u.status ?? fallback.status,
  title: withoutCdToRoot(u.title ?? fallback.title, ctx),
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
                ? u.content.map((c) => toolContent(c, ctx))
                : i.content,
              locations: u.locations
                ? toolLocations(u.locations, ctx)
                : i.locations,
              status: u.status ?? i.status,
              title: u.title ? withoutCdToRoot(u.title, ctx) : i.title,
            }
          : i,
      type: "patch",
    },
  ];
};

const projectPlan = (plan: Plan, ctx: ProjectionContext): Projection => {
  const entries = plan.entries.map((e) => ({
    content: e.content,
    priority: e.priority,
    status: e.status,
  }));
  const open = ctx.turn?.planItemId;
  if (open) {
    return unmoved(
      [
        {
          itemId: open,
          patch: (i) => (i.kind === "plan" ? { ...i, entries } : i),
          type: "patch",
        },
      ],
      ctx
    );
  }
  const item: ThreadItem = {
    at: ctx.now,
    entries,
    id: ctx.newId(),
    kind: "plan",
  };
  return {
    actions: [{ item, type: "push" }],
    turn: ctx.turn && { ...ctx.turn, planItemId: item.id },
  };
};

export const projectUpdate = (
  u: SessionUpdate,
  ctx: ProjectionContext
): Projection => {
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
      const item = toolItem(u, ctx, { status: "pending", title: u.title });
      // The text after a tool call is a new message, not the one before it.
      return {
        actions: [{ item, type: "push" }],
        turn: ctx.turn && {
          ...ctx.turn,
          agentItemId: null,
          thoughtItemId: null,
        },
      };
    }
    case "tool_call_update":
      return unmoved(projectToolUpdate(u, ctx), ctx);
    // Not `plan_update` or `plan_removed`: unstable, shaped otherwise, and sent only to a client
    // that says it reads them, which this one does not.
    case "plan":
      return projectPlan(u, ctx);
    case "current_mode_update":
      return unmoved(
        [
          {
            patch: (thread) => modeSet(thread, u.currentModeId),
            type: "thread",
          },
        ],
        ctx
      );
    case "config_option_update":
      return unmoved(
        [
          {
            patch: (thread) =>
              optionsSet(thread, mapConfigOptions(u.configOptions) ?? []),
            type: "thread",
          },
        ],
        ctx
      );
    case "available_commands_update":
      return unmoved(
        [
          {
            patch: () => ({
              agentCommands: u.availableCommands.map((c) => ({
                description: c.description,
                name: c.name,
                ...(c.input?.hint ? { argument: c.input.hint } : {}),
              })),
            }),
            type: "thread",
          },
        ],
        ctx
      );
    case "usage_update":
      return unmoved(
        [{ patch: () => ({ context: contextOf(u) }), type: "thread" }],
        ctx
      );
    case "session_info_update":
      return unmoved(
        u.title
          ? [{ patch: () => ({ title: u.title ?? "" }), type: "thread" }]
          : [],
        ctx
      );
    default:
      return unmoved([], ctx);
  }
};
