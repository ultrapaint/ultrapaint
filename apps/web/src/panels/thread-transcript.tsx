/**
 * A thread's transcript: its messages, the agent's work grouped by turn, the tools it ran with
 * their output and diffs, and where each turn ended.
 */
import type { ThreadItem, ToolContent } from "@ultrapaint/contracts/threads";
import { cn } from "cn";
import {
  Check,
  ChevronDown,
  ChevronRight,
  ListTodo,
  Paperclip,
  Square,
  Zap,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";
import { Message, MessageContent } from "@/components/ui/message";
import { Markdown } from "../components/markdown.tsx";
import { isOpenQuestion } from "../lib/answers.ts";
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
import { requestDiff } from "../state/diff-request.ts";
import { useEditor } from "../state/editor.ts";
import { Permission, QuestionRecord } from "./thread-questions.tsx";

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
 * A run of tool calls and thoughts, folded into one line that counts what they were. It lights up
 * while the agent is still in it; opening it shows each call as before.
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
      <Disclosure className="w-full gap-1.5 border bg-muted/30">
        {/* The working line under the thread spins for the turn; the group only shimmers. */}
        <Zap className="text-muted-foreground" />
        <span className={cn("truncate", active && "text-shimmer")}>{text}</span>
        {failed > 0 && (
          <span className="shrink-0 text-destructive">· {failed} failed</span>
        )}
        <ChevronDown className="ml-auto transition-transform group-data-panel-open/button:rotate-180" />
      </Disclosure>
      <CollapsibleContent className="h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-200 ease-out data-ending-style:h-0 data-starting-style:h-0">
        <div className="mt-1 ml-2 flex flex-col gap-1 border-l pl-2">
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
    disabled={disabled}
    render={
      <Button
        className={cn(
          "justify-start font-normal text-muted-foreground",
          className
        )}
        size="sm"
        variant="ghost"
      />
    }
  >
    {children}
  </CollapsibleTrigger>
);

const disclosureChevron =
  "transition-transform group-data-panel-open/button:rotate-90";

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
  if (first) {
    requestDiff(first);
  }
  useEditor.getState().setLeftTab("changes");
};

/**
 * The end of a turn, in a quiet line: how long it took and, when it changed files, a way to the
 * changes panel where they are listed. It speaks up only when the agent did not finish on its own.
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
  return (
    <div className="flex items-center gap-1 font-body text-muted-foreground/70">
      {note ? (
        <span className="flex items-center gap-1 text-warning">
          <Square className="size-2.5 fill-current" />
          {note}
        </span>
      ) : (
        <span className="flex items-center gap-1">
          <Check className="size-3" />
          Done
          {since === undefined ? "" : ` in ${formatDuration(item.at - since)}`}
        </span>
      )}
      {count > 0 && (
        <>
          <span>·</span>
          <Button
            className="h-auto p-0 font-body text-muted-foreground/70 hover:text-foreground"
            onClick={() => openChanges(item.changedFiles)}
            size="xs"
            variant="link"
          >
            {count} file{count === 1 ? "" : "s"} changed
          </Button>
        </>
      )}
    </div>
  );
};

const DIFF_SIGNS = { added: "+", removed: "-", same: " " } as const;

const keyOfContent = (content: ToolContent, index: number) =>
  content.type === "diff"
    ? `diff:${content.path}:${index}`
    : `${content.type}:${index}`;

/** A terminal the agent is running: its output arrives while the command is still going. */
const TerminalView = ({
  terminalId,
  threadId,
}: {
  terminalId: string;
  threadId: string;
}) => {
  const output = useAgents(
    (s) => s.terminals[terminalKey(threadId, terminalId)]
  );
  const end = useRef<HTMLDivElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: follow the tail as it grows
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [output]);
  return (
    <pre className="max-h-48 select-text overflow-auto whitespace-pre-wrap px-2 py-1 font-code text-muted-foreground">
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
      <div className="flex items-center gap-2 px-2 pt-1 font-code text-muted-foreground">
        <span className="truncate">{content.path}</span>
        <span className="ml-auto shrink-0 text-success">+{added}</span>
        <span className="shrink-0 text-destructive">-{removed}</span>
      </div>
      <pre className="max-h-48 select-text overflow-auto px-2 py-1 font-code leading-4">
        {rows.map((row) => (
          <div
            className={cn(
              row.kind === "added" && "bg-success/15 text-success",
              row.kind === "removed" && "bg-destructive/15 text-destructive",
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
    return <TerminalView terminalId={content.terminalId} threadId={threadId} />;
  }
  return (
    <pre className="max-h-48 select-text overflow-auto whitespace-pre-wrap px-2 py-1 font-code text-muted-foreground">
      {content.text}
    </pre>
  );
};

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
      return (
        <Message align="end">
          <MessageContent>
            <Bubble align="end" className="max-w-[90%]" variant="secondary">
              <BubbleContent className="select-text whitespace-pre-wrap">
                {item.text}
              </BubbleContent>
            </Bubble>
            {item.attachments.length > 0 && (
              <div className="flex flex-wrap justify-end gap-1">
                {item.attachments.map((a) => (
                  <Badge key={a} variant="outline">
                    <Paperclip />
                    {a}
                  </Badge>
                ))}
              </div>
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
          <Disclosure className="-ml-2">
            <ChevronRight className={disclosureChevron} />
            thinking
          </Disclosure>
          <CollapsibleContent className="mt-1 select-text border-l pl-2 text-muted-foreground">
            <Markdown className="font-body" streaming={streaming}>
              {item.text}
            </Markdown>
          </CollapsibleContent>
        </Collapsible>
      );
    case "tool": {
      const hasDetails = item.locations.length + item.content.length > 0;
      return (
        <Collapsible className="rounded-md border bg-muted/30">
          <Disclosure className="w-full gap-1.5" disabled={!hasDetails}>
            <span
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                item.status === "completed" && "bg-success",
                item.status === "failed" && "bg-destructive",
                item.status === "in_progress" && "animate-pulse bg-brand",
                item.status === "pending" && "bg-muted-foreground"
              )}
            />
            <span className="truncate">{item.title}</span>
            {item.toolKind ? (
              <span className="ml-auto font-body text-muted-foreground/70">
                {item.toolKind}
              </span>
            ) : null}
          </Disclosure>
          <CollapsibleContent>
            <div className="border-t">
              {item.locations.length > 0 && (
                <div className="px-2 py-1 font-code text-muted-foreground">
                  {item.locations.map((l) => (
                    <div key={`${l.path}:${l.line ?? ""}`}>
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
    }
    case "plan":
      return (
        <div className="rounded-md border px-2 py-1.5">
          <Marker className="mb-1 font-heading-xsmall uppercase">
            <MarkerIcon>
              <ListTodo />
            </MarkerIcon>
            <MarkerContent>Plan</MarkerContent>
          </Marker>
          {keyedEntries(item.entries).map(({ entry, key }) => (
            <div
              className={cn(
                "flex items-start gap-1.5",
                entry.status === "completed" &&
                  "text-muted-foreground line-through"
              )}
              key={key}
            >
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-muted-foreground" />
              <span>{entry.content}</span>
            </div>
          ))}
        </div>
      );
    case "permission":
      return <Permission item={item} threadId={threadId} />;
    // A question still waiting sits over the composer; the thread keeps what came of it.
    case "question":
      return isOpenQuestion(item) ? null : <QuestionRecord item={item} />;
    case "status":
      return (
        <Marker>
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
