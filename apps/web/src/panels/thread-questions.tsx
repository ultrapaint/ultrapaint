/**
 * What an agent asks of the person: permissions to run a tool, and questions, answered on a card
 * in the transcript or, while they are open, over the composer.
 */
import {
  type Answer,
  isBusy,
  type ThreadItem,
} from "@ultrapaint/contracts/threads";
import { cn } from "cn";
import {
  Check,
  ChevronDown,
  CircleHelp,
  type LucideIcon,
  ShieldQuestion,
  Square,
} from "lucide-react";
import {
  type ChangeEvent,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import {
  type AnswerDraft,
  answeredWell,
  notANumber,
  openQuestionOf,
  type QuestionItem,
  type QuestionOf,
  takesTyping,
} from "../lib/answers.ts";
import { chordLabel } from "../lib/keys.ts";
import { useAgents } from "../state/agents.ts";
import {
  declineQuestions,
  draftOf,
  pick,
  sendAnswers,
  setOther,
  setStep,
  useAnswers,
} from "../state/answers.ts";
import { api } from "../state/connection.ts";
import { reportError } from "../state/project.ts";
import { isSendKey, type SendKey } from "../state/send-key.ts";

type PermissionItem = Extract<ThreadItem, { kind: "permission" }>;

/**
 * A card that waits on the user, as a question or a permission: neutral like every other card of
 * the thread, with the brand colour kept for its icon while it waits and for what is picked.
 */
const AskCard = ({
  children,
  icon: Icon,
  open,
  title,
}: {
  children: ReactNode;
  icon: LucideIcon;
  open: boolean;
  title: string;
}) => (
  <div className="flex flex-col gap-3 rounded-lg border bg-card p-3 font-body">
    <span className="flex items-center gap-1.5 text-muted-foreground">
      <Icon className={cn("size-3.5 shrink-0", open && "text-brand")} />
      {title}
    </span>
    {children}
  </div>
);

const PermissionOption = ({
  option,
  requestId,
  threadId,
}: {
  option: PermissionItem["options"][number];
  requestId: string;
  threadId: string;
}) => {
  const onClick = () =>
    api()
      .request("threads.permission", {
        optionId: option.optionId,
        requestId,
        threadId,
      })
      .catch(reportError);
  return (
    <Button
      onClick={onClick}
      size="sm"
      variant={option.kind.startsWith("allow") ? "default" : "outline"}
    >
      {option.name}
    </Button>
  );
};

export const Permission = ({
  item,
  threadId,
}: {
  item: PermissionItem;
  threadId: string;
}) => {
  const open = !item.decision;
  return (
    <AskCard
      icon={open ? ShieldQuestion : Check}
      open={open}
      title={open ? "Permission requested" : "Permission"}
    >
      <span
        className={cn(
          open ? "font-medium text-foreground" : "text-muted-foreground"
        )}
      >
        {item.title}
      </span>
      {item.detail ? (
        <pre className="max-h-24 select-text overflow-auto whitespace-pre-wrap rounded-md border bg-background px-2.5 py-1.5 font-code text-muted-foreground">
          {item.detail}
        </pre>
      ) : null}
      {open ? (
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {item.options.map((o) => (
            <PermissionOption
              key={o.optionId}
              option={o}
              requestId={item.requestId}
              threadId={threadId}
            />
          ))}
        </div>
      ) : (
        <span className="flex items-center gap-2 font-medium text-foreground">
          <Check className="size-3.5 shrink-0" />
          {item.options.find((o) => o.optionId === item.decision)?.name ??
            item.decision}
        </span>
      )}
    </AskCard>
  );
};

/** What an answer reads as once given: each option's label, or the text typed. */
const answerLabel = (question: QuestionOf, answer: Answer | undefined) => {
  const label = (one: string) =>
    question.options.find((o) => o.id === one)?.label ?? one;
  if (answer === undefined || answer.length === 0) {
    return "—";
  }
  return typeof answer === "string"
    ? label(answer)
    : answer.map(label).join(", ");
};

/** The options a question offers past this many have no key of their own. */
const KEYED_OPTIONS = 9;

/**
 * The choices of a question as full-width rows, each with its description under it and, on the
 * right, the key that picks it or the check that says it is picked. An answer typed in the
 * composer stands instead of them, so while there is one none shows as picked.
 */
const QuestionChoices = ({
  draft,
  itemId,
  question,
}: {
  draft: AnswerDraft;
  itemId: string;
  question: QuestionOf;
}) => {
  const typed =
    takesTyping(question) && Boolean(draft.other[question.id]?.trim());
  const chosen = typed ? [] : [draft.picked[question.id] ?? []].flat();
  return (
    <div className="flex flex-col gap-0.5">
      {question.options.map((o, i) => {
        const on = chosen.includes(o.id);
        return (
          <button
            aria-pressed={on}
            className={cn(
              "flex w-full items-start gap-3 rounded-md border border-transparent px-2.5 py-1.5 text-left outline-none transition-colors hover:bg-accent/60 focus-visible:border-ring",
              on && "bg-accent hover:bg-accent"
            )}
            key={o.id}
            onClick={() => pick(itemId, question, o.id)}
            type="button"
          >
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="font-medium text-foreground">{o.label}</span>
              {o.description ? (
                <span className="text-muted-foreground">{o.description}</span>
              ) : null}
            </span>
            <span className="flex h-5 w-4 shrink-0 items-center justify-center text-muted-foreground tabular-nums">
              {on ? <Check className="size-3.5 text-brand" /> : null}
              {!on && i < KEYED_OPTIONS ? i + 1 : null}
            </span>
          </button>
        );
      })}
    </div>
  );
};

/** What the card says it is, from asked to answered. */
const cardTitle = (item: QuestionItem) => {
  if (item.answers !== null) {
    return "Answered";
  }
  if (item.outcome === "declined") {
    return "Declined";
  }
  if (item.outcome === "cancelled") {
    return "No longer asked";
  }
  return item.elicitation?.message ?? "The agent asks";
};

/** What is said under a question: its own description, or how it is answered. */
const questionHint = (question: QuestionOf) => {
  if (question.description) {
    return question.description;
  }
  if (question.options.length === 0) {
    return "Type the answer in the box below.";
  }
  return question.multiple ? "Pick one or more." : undefined;
};

/** Whether the thread's agent is at work, so answers that go as a prompt have to wait. */
const useRunning = (threadId: string) =>
  useAgents((s) => isBusy(s.threads.find((t) => t.id === threadId)?.status));

/** Questions no longer waiting, as the thread keeps them: each with what came of it. */
export const QuestionRecord = ({ item }: { item: QuestionItem }) => {
  const answered = item.answers;
  return (
    <AskCard
      icon={answered ? Check : CircleHelp}
      open={false}
      title={cardTitle(item)}
    >
      {item.questions.map((q) => (
        <div className="flex flex-col gap-1" key={q.id}>
          <span className="text-muted-foreground">{q.question}</span>
          <span className="flex items-center gap-2 font-medium text-foreground">
            {answered ? <Check className="size-3.5 shrink-0" /> : null}
            {answerLabel(q, answered?.[q.id])}
          </span>
        </div>
      ))}
    </AskCard>
  );
};

/**
 * Questions put to the user, one at a time, on a card over the composer so they stay in sight
 * while the thread scrolls on: the card shows the question and its choices, and the composer
 * takes an answer of one's own and steps to the next question, then sends them. When the agent
 * waits for the answers within its turn they are answered (or declined) at once; otherwise they
 * are sent as the next prompt, so they wait until the agent's turn has ended.
 */
const QuestionCard = ({
  item,
  threadId,
}: {
  item: QuestionItem;
  threadId: string;
}) => {
  const running = useRunning(threadId);
  const draft = useAnswers((s) => draftOf(s.drafts, item.id));
  const [collapsed, setCollapsed] = useState(false);
  const question = item.questions[draft.step] ?? item.questions[0];
  if (!question) {
    return null;
  }
  const count = item.questions.length;
  const waiting = item.elicitation !== undefined;
  const hint = questionHint(question);
  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-card p-3 font-body">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <CircleHelp className="size-3.5 shrink-0 text-brand" />
        <span className="min-w-0 flex-1 truncate">{cardTitle(item)}</span>
        {waiting ? (
          <Button
            disabled={draft.busy}
            onClick={() => declineQuestions(item, threadId)}
            size="xs"
            variant="ghost"
          >
            Decline
          </Button>
        ) : null}
        {count > 1 ? (
          <span className="tabular-nums">
            {draft.step + 1}/{count}
          </span>
        ) : null}
        <Button
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Show the choices" : "Hide the choices"}
          className="text-muted-foreground"
          onClick={() => setCollapsed((c) => !c)}
          size="icon-xs"
          variant="ghost"
        >
          <ChevronDown
            className={cn("transition-transform", collapsed && "-rotate-90")}
          />
        </Button>
      </div>
      <div className="flex flex-col">
        <span className="font-medium text-foreground">
          {question.question}
          {question.optional ? (
            <span className="font-normal text-muted-foreground">
              {" "}
              (optional)
            </span>
          ) : null}
        </span>
        {hint && !collapsed ? (
          <span className="text-muted-foreground">{hint}</span>
        ) : null}
      </div>
      {/* Many choices scroll within the card rather than squeeze the thread above it. */}
      {collapsed ? null : (
        <div className="max-h-[40vh] overflow-y-auto">
          <QuestionChoices draft={draft} itemId={item.id} question={question} />
        </div>
      )}
      {running && !waiting ? (
        <span className="text-muted-foreground">
          The answers can be sent once the agent has finished its turn.
        </span>
      ) : null}
    </div>
  );
};

/** The open question card, what has been given to it, and the question on screen. */
interface Answering {
  asking: QuestionItem;
  draft: AnswerDraft;
  question: QuestionOf;
}

/** An agent's questions waiting for answers take the composer over, one question at a time. */
export const useAnswering = (threadId: string): Answering | null => {
  const asking = useAgents((s) => openQuestionOf(s.items[threadId] ?? []));
  const draft = useAnswers((s) =>
    asking ? draftOf(s.drafts, asking.id) : null
  );
  const question = asking?.questions[draft?.step ?? 0] ?? asking?.questions[0];
  return asking && draft && question ? { asking, draft, question } : null;
};

/** The card of the questions the composer answers, over it; keyed so each card opens anew. */
export const OpenQuestion = ({
  answering,
  threadId,
}: {
  answering: Answering | null;
  threadId: string;
}) =>
  answering ? (
    <QuestionCard
      item={answering.asking}
      key={answering.asking.id}
      threadId={threadId}
    />
  ) : null;

/** The answers can go: all given, and nothing in the way of sending them. */
const canSendAnswers = ({ asking, draft }: Answering, running: boolean) =>
  !(
    draft.busy ||
    // Answers that go as a prompt wait for the agent's turn to end.
    (running && asking.elicitation === undefined)
  ) && asking.questions.every((q) => answeredWell(draft, q));

/** On to the next question, or, on the last one, the answers go. */
const advance = (answering: Answering, threadId: string, running: boolean) => {
  const { asking, draft, question } = answering;
  if (!answeredWell(draft, question)) {
    return;
  }
  if (draft.step < asking.questions.length - 1) {
    setStep(asking, draft.step + 1);
  } else if (canSendAnswers(answering, running)) {
    sendAnswers(asking, threadId);
  }
};

/**
 * The composer's keys while it answers: the send key steps on, and with nothing typed 1–9 pick
 * the question's options, as the card shows.
 */
export const onAnswerKey = (
  e: KeyboardEvent<HTMLTextAreaElement>,
  answering: Answering,
  threadId: string,
  sendKey: SendKey,
  running: boolean
) => {
  const { asking, draft, question } = answering;
  if (isSendKey(e, sendKey)) {
    e.preventDefault();
    advance(answering, threadId, running);
    return;
  }
  const typed = draft.other[question.id] ?? "";
  const digit = Number(e.key);
  const option =
    Number.isInteger(digit) && digit >= 1
      ? question.options[digit - 1]
      : undefined;
  if (option && !typed && !(e.metaKey || e.ctrlKey || e.altKey)) {
    e.preventDefault();
    pick(asking.id, question, option.id);
  }
};

const answerPlaceholder = (question: QuestionOf) => {
  if (question.options.length === 0) {
    return "Type your answer…";
  }
  return question.allowOther
    ? "Type your own answer, or leave this blank to use the option picked"
    : "Pick an option above, or press its number";
};

/** The composer's box while it answers: an answer of one's own to the question on screen. */
export const AnswerField = ({
  answering: { asking, draft, question },
  onKeyDown,
}: {
  answering: Answering;
  onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
}) => {
  const typed = draft.other[question.id] ?? "";
  return (
    <textarea
      aria-invalid={notANumber(question, typed) || undefined}
      className="field-sizing-content max-h-60 min-h-24 w-full resize-none bg-transparent px-3 py-2 font-body outline-none placeholder:text-muted-foreground aria-invalid:text-destructive"
      inputMode={
        question.value === "number" || question.value === "integer"
          ? "decimal"
          : undefined
      }
      onChange={(e: ChangeEvent<HTMLTextAreaElement>) => {
        if (takesTyping(question)) {
          setOther(asking.id, question, e.target.value);
        }
      }}
      onKeyDown={onKeyDown}
      placeholder={answerPlaceholder(question)}
      readOnly={!takesTyping(question)}
      value={typed}
    />
  );
};

/** A click on a step button leaves the focus where it was, so typing goes on in the composer. */
const keepFocus = (e: ReactMouseEvent) => e.preventDefault();

/** Back a question, on to the next, and on the last one Send answers; Stop while the agent works. */
export const AnswerButtons = ({
  answering,
  onStop,
  running,
  threadId,
}: {
  answering: Answering;
  onStop: () => void;
  running: boolean;
  threadId: string;
}) => {
  const { asking, draft, question } = answering;
  const last = draft.step >= asking.questions.length - 1;
  const ready = last
    ? canSendAnswers(answering, running)
    : answeredWell(draft, question);
  return (
    <>
      {running ? (
        <Button
          aria-label="Stop"
          onClick={onStop}
          size="icon-sm"
          title="Stop"
          variant="outline"
        >
          <Square />
        </Button>
      ) : null}
      {draft.step > 0 ? (
        <Button
          onClick={() => setStep(asking, draft.step - 1)}
          onMouseDown={keepFocus}
          size="sm"
          variant="outline"
        >
          Previous
        </Button>
      ) : null}
      <Button
        disabled={!ready}
        onClick={() => advance(answering, threadId, running)}
        onMouseDown={keepFocus}
        size="sm"
        title={chordLabel("mod+enter")}
      >
        {last ? "Send answers" : "Next question"}
      </Button>
    </>
  );
};
