/**
 * A design chat as turns (ADR 0095): each prompt of the person's, then what the agent did for it,
 * up to their next prompt. The chat draws a turn as its prompt, one card (the page it changed, the
 * run's progress, the review, the steps folded) and the agent's last message; the steps are there
 * for whoever opens them. Pure, so the grouping is tested without the stores.
 */
import {
  isEditorMcpCall,
  type ThreadItem,
} from "@ultrapaint/contracts/threads";
import { isOpenQuestion } from "./answers.ts";
import { isRunPlan, type ReviewItem } from "./design-run.ts";

type ToolItem = Extract<ThreadItem, { kind: "tool" }>;
type AgentItem = Extract<ThreadItem, { kind: "agent" }>;
type PlanItem = Extract<ThreadItem, { kind: "plan" }>;
type TurnEndItem = Extract<ThreadItem, { kind: "turn_end" }>;
type UserItem = Extract<ThreadItem, { kind: "user" }>;

/** A prompt and all that came of it, or what came before any prompt. */
export interface Turn {
  /** The prompt's id, or the first item's when the turn has no prompt. */
  readonly id: string;
  readonly items: readonly ThreadItem[];
  readonly prompt: UserItem | undefined;
}

/** A prompt of the person's own: a round's findings sent to the designer are the review's. */
const isPrompt = (item: ThreadItem): item is UserItem =>
  item.kind === "user" && item.review === undefined;

export const splitTurns = (items: readonly ThreadItem[]): readonly Turn[] => {
  const turns: { items: ThreadItem[]; prompt: UserItem | undefined }[] = [];
  for (const item of items) {
    const last = turns.at(-1);
    if (isPrompt(item)) {
      turns.push({ items: [], prompt: item });
    } else if (last) {
      last.items.push(item);
    } else {
      turns.push({ items: [item], prompt: undefined });
    }
  }
  return turns.map((t) => ({
    id: (t.prompt ?? t.items[0])?.id ?? "",
    items: t.items,
    prompt: t.prompt,
  }));
};

/** The editor's own tools, by what the person would call what they do. */
const EDITOR_STEPS: Partial<Record<string, readonly [string, string]>> = {
  apply_operations: ["Editing a page", "Edited a page"],
  ask_user: ["Asking you", "Asked you"],
  create_canvas: ["Making a canvas", "Made a canvas"],
  create_page: ["Making a page", "Made a page"],
  delete_page: ["Deleting a page", "Deleted a page"],
  duplicate_page: ["Copying a page", "Copied a page"],
  focus: ["Choosing what to change", "Chose what to change"],
  get_component: ["Reading a component", "Read a component"],
  get_context: ["Reading your selection", "Read your selection"],
  get_document_format: ["Reading the page format", "Read the page format"],
  get_screenshot: ["Taking a screenshot", "Took a screenshot"],
  list_comments: ["Reading the comments", "Read the comments"],
  list_components: ["Reading the components", "Read the components"],
  list_pages: ["Listing the pages", "Listed the pages"],
  read_canvas: ["Reading the canvas", "Read the canvas"],
  read_design_system: ["Reading the design system", "Read the design system"],
  read_page: ["Reading a page", "Read a page"],
  rename_page: ["Renaming a page", "Renamed a page"],
  reply_to_comment: ["Replying to a comment", "Replied to a comment"],
  resolve_comment: ["Resolving a comment", "Resolved a comment"],
  set_frame: ["Sizing a page", "Sized a page"],
  write_design_system: [
    "Changing the design system",
    "Changed the design system",
  ],
};

/** What leads an editor tool's name in a call's title, as Claude Code or Codex writes it. */
const EDITOR_PREFIX_RE = /^.*?(?:mcp__ultrapaint__|mcp\.ultrapaint\.)/;
const TOOL_NAME_RE = /^[\w-]+/;

/**
 * A tool call in words: an editor tool by what it does ("Edited a page"), any other by the title
 * its agent gave it ("Read DESIGN.md"), as it happens and once it is done.
 */
export const stepTitle = (tool: ToolItem, active: boolean): string => {
  if (isEditorMcpCall(tool.title)) {
    const [name = ""] =
      tool.title.replace(EDITOR_PREFIX_RE, "").match(TOOL_NAME_RE) ?? [];
    const words = EDITOR_STEPS[name];
    if (words) {
      return words[active ? 0 : 1];
    }
    const said = name.replaceAll("_", " ");
    return said.charAt(0).toUpperCase() + said.slice(1);
  }
  return tool.title;
};

/** What a turn holds, as its card draws it. */
export interface TurnParts {
  /** The agent's last message, read under the card once the turn is over. */
  readonly answer: AgentItem | undefined;
  /** Files the turn's agent changed, each once. */
  readonly changed: readonly string[];
  /** When the turn's last part ended, once it is over. */
  readonly endedAt: number | undefined;
  /** Shown in the transcript as they are: an answered question, a permission, a notice. */
  readonly inline: readonly ThreadItem[];
  /** The run's plan (Outline, Build), when the agent kept one. */
  readonly plan: PlanItem | undefined;
  readonly rounds: readonly ReviewItem[];
  /** The steps folded in the card: tool calls, and the agent's words between them. */
  readonly steps: readonly (ToolItem | AgentItem)[];
  /** How the last turn of the agent's ended, when it did not finish on its own. */
  readonly stopped: TurnEndItem | undefined;
}

export const turnParts = (turn: Turn, over: boolean): TurnParts => {
  const agents = turn.items.filter(
    (i): i is AgentItem => i.kind === "agent" && i.text.trim() !== ""
  );
  const answer = over ? agents.at(-1) : undefined;
  const ends = turn.items.filter(
    (i): i is TurnEndItem => i.kind === "turn_end"
  );
  const lastEnd = ends.at(-1);
  const changed = [...new Set(ends.flatMap((e) => e.changedFiles))];
  const plans = turn.items.filter(
    (i): i is PlanItem => i.kind === "plan" && isRunPlan(i)
  );
  return {
    answer,
    changed,
    endedAt: over ? (turn.items.at(-1)?.at ?? lastEnd?.at) : undefined,
    inline: turn.items.filter(
      (i) =>
        (i.kind === "question" && !isOpenQuestion(i)) ||
        i.kind === "permission" ||
        i.kind === "status"
    ),
    plan: plans.at(-1),
    rounds: turn.items.filter((i): i is ReviewItem => i.kind === "review"),
    steps: turn.items.filter(
      (i): i is ToolItem | AgentItem =>
        i.kind === "tool" || (i.kind === "agent" && i !== answer)
    ),
    stopped: lastEnd && lastEnd.stopReason !== "end_turn" ? lastEnd : undefined,
  };
};

/** What the agent is doing now, in a few words, from the last thing it did. */
export const nowDoing = (turn: Turn): string => {
  if (turn.items.some((i) => i.kind === "question" && isOpenQuestion(i))) {
    return "Waiting for your answer";
  }
  const last = turn.items.findLast(
    (i) => i.kind === "tool" || i.kind === "thought" || i.kind === "agent"
  );
  if (last?.kind === "tool") {
    const open = last.status === "pending" || last.status === "in_progress";
    return open ? stepTitle(last, true) : "Working";
  }
  if (last?.kind === "thought") {
    return "Thinking";
  }
  return last?.kind === "agent" ? "Writing" : "Starting";
};
