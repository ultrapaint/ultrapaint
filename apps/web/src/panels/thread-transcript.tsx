/**
 * A thread's transcript: its messages, the agent's work grouped by turn, the tools it ran with
 * their output and diffs, and where each turn ended.
 */
import type { ThreadItem, ToolContent } from "@ultrapaint/contracts/threads";
import {
  Check,
  ChevronRight,
  Circle,
  CircleDashed,
  Paperclip,
  Square,
  X,
} from "lucide-react";
import { type ReactNode, useContext, useEffect, useMemo, useRef } from "react";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Marker, MarkerContent } from "@/components/ui/marker";
import { Message, MessageContent } from "@/components/ui/message";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { CutText } from "../components/cut-text.tsx";
import { Markdown } from "../components/markdown.tsx";
import { isOpenQuestion } from "../lib/answers.ts";
import { isRunPlan } from "../lib/design-run.ts";
import {
  type DiffRow,
  diffCounts,
  diffHunks,
  lineDiff,
} from "../lib/line-diff.ts";
import {
  formatDuration,
  hasOpenCall,
  stopNote,
  type ThreadEntry,
  workSummary,
} from "../lib/thread-work.ts";
import { terminalKey, useAgents } from "../state/agents.ts";
import { showLeftPanel } from "../state/panels.ts";
import { Permission, QuestionRecord } from "./thread-questions.tsx";
import {
  inRunCard,
  ReviewRound,
  RunCard,
  RunContextValue,
} from "./thread-review.tsx";

/** A review round: inside its run's card when it has one, else a card of its own. */
const RoundItem = ({
  item,
}: {
  item: Extract<ThreadItem, { kind: "review" }>;
}) =>
  inRunCard(useContext(RunContextValue), item) ? null : (
    <ReviewRound item={item} />
  );

export const keyOfEntry = (entry: ThreadEntry) =>
  entry.kind === "work" ? entry.id : entry.item.id;

export const Entry = ({
  entry,
  last,
  running,
  threadId,
}: {
  entry: ThreadEntry;
  /** The last item of the thread, the one the agent is appending to while it runs. */
  last: ThreadItem | undefined;
  running: boolean;
  threadId: string;
}) => {
  switch (entry.kind) {
    case "work":
      return (
        <WorkGroup
          items={entry.items}
          running={running}
          streamingId={running ? last?.id : undefined}
          threadId={threadId}
        />
      );
    case "turn":
      return <TurnEnd item={entry.item} since={entry.since} />;
    default:
      return (
        <Item
          item={entry.item}
          streaming={running && entry.item === last}
          threadId={threadId}
        />
      );
  }
};

/**
 * A run of tool calls and thoughts, folded into one quiet line that counts what they were. It
 * shimmers while the agent is still in it; opening it shows each call, one line each.
 */
const WorkGroup = ({
  items,
  running,
  streamingId,
  threadId,
}: {
  items: readonly ThreadItem[];
  running: boolean;
  /** The item the agent is still appending to, if it is in this run. */
  streamingId: string | undefined;
  threadId: string;
}) => {
  const active =
    running && (hasOpenCall(items) || items.some((i) => i.id === streamingId));
  const { failed, text } = workSummary(items, active);
  return (
    <Collapsible>
      <Disclosure>
        <ChevronRight className={disclosureChevron} />
        {/* The working line under the thread spins for the turn; the group only shimmers. */}
        <span className={cn("truncate", active && "text-shimmer")}>{text}</span>
        {failed > 0 && (
          <span className="shrink-0 text-destructive">· {failed} failed</span>
        )}
      </Disclosure>
      <CollapsibleContent className="h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-200 ease-(--ease-enter) data-ending-style:h-0 data-starting-style:h-0">
        <div className="mt-0.5 ml-[7px] flex flex-col gap-0.5 border-l pl-2.5">
          {items.map((item) => (
            <Item
              item={item}
              key={item.id}
              streaming={item.id === streamingId}
              threadId={threadId}
            />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};

/** A quiet line that folds what is under it: muted small text, filled only under the pointer. */
const Disclosure = ({
  className,
  disabled,
  children,
}: {
  className?: string;
  disabled?: boolean;
  children: ReactNode;
}) => (
  <CollapsibleTrigger
    className={cn(
      "group/button -mx-1.5 flex h-7 w-[calc(100%+0.75rem)] min-w-0 items-center gap-1.5 rounded-md px-1.5 text-left font-body-small text-muted-foreground outline-none transition-colors duration-100 hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none [&_svg]:size-3.5 [&_svg]:shrink-0",
      className
    )}
    disabled={disabled}
  >
    {children}
  </CollapsibleTrigger>
);

const disclosureChevron =
  "transition-transform duration-150 group-data-panel-open/button:rotate-90";

/** Keys plan entries by content, numbering repeats so keys stay unique. */
const keyedEntries = <T extends { content: string }>(entries: readonly T[]) => {
  const seen = new Map<string, number>();
  return entries.map((entry) => {
    const n = seen.get(entry.content) ?? 0;
    seen.set(entry.content, n + 1);
    return { entry, key: `${entry.content}-${n}` };
  });
};

/** Opens the changes panel on the first of the files, where all of them are listed. */
const openChanges = (files: readonly string[]) => {
  const [first] = files;
  showLeftPanel(first ? { changes: first } : "changes");
};

/**
 * The end of a turn, in a quiet line: how long it took and, when it changed files, a way to the
 * changes panel where they are listed. Files changed during the turn by someone else while the
 * agent worked (another thread, the user) are counted apart, as changed during it rather than by
 * the agent. It speaks up only when the agent did not finish on its own.
 */
const TurnEnd = ({
  item,
  since,
}: {
  item: Extract<ThreadItem, { kind: "turn_end" }>;
  since: number | undefined;
}) => {
  const note = stopNote(item.stopReason);
  const count = item.changedFiles.length;
  const during = item.changedDuring ?? [];
  return (
    <div className="flex flex-wrap items-center gap-x-1.5 font-body-small text-muted-foreground">
      {note ? (
        <span className="flex items-center gap-1.5">
          <Square className="size-2.5 fill-warning text-warning" />
          {note}
        </span>
      ) : (
        <span className="flex items-center gap-1.5">
          <Check className="size-3.5" />
          {since === undefined
            ? "Done"
            : `Done in ${formatDuration(item.at - since)}`}
        </span>
      )}
      {count > 0 && (
        <>
          <span aria-hidden>·</span>
          <button
            className={quietLink}
            onClick={() => openChanges(item.changedFiles)}
            type="button"
          >
            {count === 1 ? "1 file changed" : `${count} files changed`}
          </button>
        </>
      )}
      {during.length > 0 && (
        <>
          <span aria-hidden>·</span>
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  className={quietLink}
                  onClick={() => openChanges(during)}
                  type="button"
                />
              }
            >
              {during.length === 1
                ? "1 other changed meanwhile"
                : `${during.length} others changed meanwhile`}
            </TooltipTrigger>
            <TooltipContent className="max-w-80">
              {during.join(", ")}
            </TooltipContent>
          </Tooltip>
        </>
      )}
    </div>
  );
};

/** A link in a line of metadata: muted like the line, underlined, the foreground under the pointer. */
const quietLink =
  "rounded-sm underline decoration-muted-foreground/40 underline-offset-3 outline-none transition-colors duration-100 hover:text-foreground hover:decoration-foreground/60 focus-visible:ring-2 focus-visible:ring-ring";

const DIFF_SIGNS = { added: "+", removed: "-", same: " " } as const;

const keyOfContent = (content: ToolContent, index: number) =>
  content.type === "diff"
    ? `diff:${content.path}:${index}`
    : `${content.type}:${index}`;

/**
 * A terminal the agent is running: its output arrives while the command is still going, and its
 * tail is kept with the tool call once the agent is done with it, for a page opened later.
 */
const TerminalView = ({
  kept,
  terminalId,
  threadId,
}: {
  kept: string | undefined;
  terminalId: string;
  threadId: string;
}) => {
  const live = useAgents((s) => s.terminals[terminalKey(threadId, terminalId)]);
  const output = live ?? kept;
  const end = useRef<HTMLDivElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: follow the tail as it grows
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [output]);
  return (
    <pre className="max-h-48 select-text overflow-auto whitespace-pre-wrap px-2.5 font-code text-muted-foreground">
      {output ?? "…"}
      <div ref={end} />
    </pre>
  );
};

/** Rows repeat in a diff (a closing brace, a blank line): the count makes each key its own. */
const withKeys = (rows: readonly DiffRow[]) => {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const base = `${row.kind}:${row.text}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return { ...row, key: `${base}:${n}` };
  });
};

/** What an agent's edit changes, worked out from the file before and after. */
const DiffContentView = ({
  content,
}: {
  content: Extract<ToolContent, { type: "diff" }>;
}) => {
  const { added, removed, rows } = useMemo(() => {
    const all = lineDiff(content.oldText ?? "", content.newText);
    return { ...diffCounts(all), rows: withKeys(diffHunks(all)) };
  }, [content.oldText, content.newText]);
  return (
    <div>
      <div className="flex items-center gap-2 px-2.5 font-body-small text-muted-foreground">
        <CutText className="min-w-0 truncate">{content.path}</CutText>
        <span className="ml-auto shrink-0 text-foreground tabular-nums">
          +{added}
        </span>
        <span className="shrink-0 text-destructive tabular-nums">
          −{removed}
        </span>
      </div>
      <pre className="max-h-48 select-text overflow-auto py-1 font-code">
        {rows.map((row) => (
          <div
            className={cn(
              "px-2.5",
              row.kind === "added" && "bg-accent text-foreground",
              row.kind === "removed" && "bg-destructive/10 text-destructive",
              row.kind === "same" && "text-muted-foreground"
            )}
            key={row.key}
          >
            {`${DIFF_SIGNS[row.kind]}${row.text || " "}`}
          </div>
        ))}
      </pre>
    </div>
  );
};

const ToolContentView = ({
  content,
  threadId,
}: {
  content: ToolContent;
  threadId: string;
}) => {
  if (content.type === "diff") {
    return <DiffContentView content={content} />;
  }
  if (content.type === "terminal") {
    return (
      <TerminalView
        kept={content.output}
        terminalId={content.terminalId}
        threadId={threadId}
      />
    );
  }
  return (
    <pre className="max-h-48 select-text overflow-auto whitespace-pre-wrap px-2.5 font-code text-muted-foreground">
      {content.text}
    </pre>
  );
};

/** A tool call's state, beside its title: done, failed, under way, waiting to start. */
const ToolStatus = ({ status }: { status: ToolItem["status"] }) => {
  switch (status) {
    case "completed":
      return <Check aria-label="Done" />;
    case "failed":
      return <X aria-label="Failed" className="text-destructive" />;
    case "in_progress":
      return <Spinner aria-label="Running" className="text-agent" />;
    default:
      return <CircleDashed aria-label="Waiting" />;
  }
};

type ToolItem = Extract<ThreadItem, { kind: "tool" }>;

/** One tool call, as a line; opening it shows where it worked and what it produced. */
const ToolCall = ({ item, threadId }: { item: ToolItem; threadId: string }) => {
  const hasDetails = item.locations.length + item.content.length > 0;
  return (
    <Collapsible>
      <Disclosure disabled={!hasDetails}>
        <ToolStatus status={item.status} />
        <span className="min-w-0 flex-1 truncate">{item.title}</span>
        {hasDetails ? (
          <ChevronRight
            className={cn(
              disclosureChevron,
              "opacity-0 group-hover/button:opacity-100 group-focus-visible/button:opacity-100 group-data-panel-open/button:opacity-100"
            )}
          />
        ) : null}
      </Disclosure>
      <CollapsibleContent>
        <div className="my-1 flex flex-col gap-1 overflow-hidden rounded-md bg-muted py-1">
          {item.locations.length > 0 && (
            <div className="px-2.5 font-code text-muted-foreground">
              {item.locations.map((l) => (
                <div className="truncate" key={`${l.path}:${l.line ?? ""}`}>
                  {l.line === undefined ? l.path : `${l.path}:${l.line}`}
                </div>
              ))}
            </div>
          )}
          {item.content.map((c, index) => (
            <ToolContentView
              content={c}
              key={keyOfContent(c, index)}
              threadId={threadId}
            />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};

type PlanItem = Extract<ThreadItem, { kind: "plan" }>;

/** A plan step's state: done, the one under way, to come. */
const PlanMark = ({
  status,
}: {
  status: PlanItem["entries"][number]["status"];
}) => {
  if (status === "completed") {
    return <Check className="size-3.5 text-muted-foreground" />;
  }
  return status === "in_progress" ? (
    <span className="flex size-3.5 items-center justify-center">
      <span className="size-1.5 rounded-full bg-agent" />
    </span>
  ) : (
    <Circle className="size-3.5 text-muted-foreground/60" />
  );
};

/** The agent's plan, its steps ticked off as it goes. */
const Plan = ({ item }: { item: PlanItem }) => (
  <div className="flex flex-col gap-1 rounded-lg border px-3 py-2.5">
    <span className="font-body-small text-muted-foreground">Plan</span>
    <ol className="flex flex-col gap-1">
      {keyedEntries(item.entries).map(({ entry, key }) => (
        <li
          className={cn(
            "flex items-start gap-2",
            entry.status === "completed" && "text-muted-foreground"
          )}
          key={key}
        >
          <span className="flex h-5 shrink-0 items-center">
            <PlanMark status={entry.status} />
          </span>
          <span className="min-w-0">{entry.content}</span>
        </li>
      ))}
    </ol>
  </div>
);

const Item = ({
  item,
  streaming,
  threadId,
}: {
  item: ThreadItem;
  /** The agent is still appending to this item, so its markdown may be cut mid-token. */
  streaming: boolean;
  threadId: string;
}) => {
  switch (item.kind) {
    case "user":
      // A round's findings sent to the designer: the round shows them.
      if (item.review !== undefined) {
        return null;
      }
      // The person's own words: filled and set in from the left, the agent's run the full width.
      return (
        <Message align="end" className="pl-8">
          <MessageContent className="gap-1">
            <Bubble align="end" className="max-w-full" variant="secondary">
              <BubbleContent className="select-text whitespace-pre-wrap px-3 py-2">
                {item.text}
              </BubbleContent>
            </Bubble>
            {item.attachments.length > 0 && (
              <span className="flex min-w-0 items-center justify-end gap-1 font-body-small text-muted-foreground">
                <Paperclip className="size-3 shrink-0" />
                <CutText className="truncate">
                  {item.attachments.join(", ")}
                </CutText>
              </span>
            )}
          </MessageContent>
        </Message>
      );
    case "agent":
      return (
        <Message>
          <MessageContent>
            <Bubble variant="ghost">
              <BubbleContent className="select-text">
                <Markdown streaming={streaming}>{item.text}</Markdown>
              </BubbleContent>
            </Bubble>
          </MessageContent>
        </Message>
      );
    case "thought":
      return (
        <Collapsible>
          <Disclosure>
            <ChevronRight className={disclosureChevron} />
            <span className={cn(streaming && "text-shimmer")}>Thinking</span>
          </Disclosure>
          <CollapsibleContent className="mt-0.5 mb-1 ml-[7px] select-text border-l pl-2.5 text-muted-foreground">
            <Markdown streaming={streaming}>{item.text}</Markdown>
          </CollapsibleContent>
        </Collapsible>
      );
    case "tool":
      return <ToolCall item={item} threadId={threadId} />;
    case "plan":
      return isRunPlan(item) ? <RunCard plan={item} /> : <Plan item={item} />;
    case "review":
      return <RoundItem item={item} />;
    case "permission":
      return <Permission item={item} threadId={threadId} />;
    // A question still waiting sits over the composer; the thread keeps what came of it.
    case "question":
      return isOpenQuestion(item) ? null : <QuestionRecord item={item} />;
    case "status":
      return (
        <Marker className="py-1" variant="separator">
          <MarkerContent>{item.text}</MarkerContent>
        </Marker>
      );
    // The end of a turn is laid out by the thread, which knows when the turn began.
    case "turn_end":
      return null;
    default:
      return null;
  }
};
