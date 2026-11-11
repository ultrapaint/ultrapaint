/**
 * Settings › Agents › Review (ADR 0063): how much review a design gets and which models review it
 * in which order. Saved with the project's configuration, so the team shares it; a chat sets its
 * own level from the composer's Review chip.
 */
import {
  APPROVAL,
  type Approval,
  EACH_ROUND,
  type EachRound,
  levelOf,
  REVIEW_LEVELS,
  type ReviewLevel,
  type ReviewModel,
  type ReviewSettings,
  reviewSettingsOf,
  withLevel,
} from "@ultrapaint/contracts/review";
import {
  type AgentOptions,
  isEffortOption,
  isModelOption,
  namedChoices,
  withNamedChoices,
} from "@ultrapaint/contracts/threads";
import { ChevronDown, GripVertical, Search, X } from "lucide-react";
import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { selectTriggerClass } from "@/components/ui/select";
import { cn } from "@/lib/cn";
import { IconButton } from "../components/icon-button.tsx";
import { OptionSelect } from "../components/option-select.tsx";
import { Segmented } from "../components/segmented.tsx";
import { platform } from "../platform.ts";
import { useAgents } from "../state/agents.ts";
import { api } from "../state/connection.ts";
import { readiness, useMachineAgents } from "../state/machine-agents.ts";
import { reportError } from "../state/project.ts";
import { LEVEL_LINES, LEVEL_NAMES } from "./review-level.tsx";
import { Group, Row, rowField } from "./settings-group.tsx";

const EACH_ROUND_NAMES: Record<EachRound, string> = {
  all: "All",
  one: "One",
  rotate: "In turn",
};

const APPROVAL_NAMES: Record<Approval, string> = {
  all: "All review models",
  one: "The round’s reviewer",
};

/** Who looks each round at a named level (contracts' `LEVELS`). */
const LEVEL_ORDER: Record<ReviewLevel, EachRound | undefined> = {
  off: undefined,
  quick: "one",
  standard: "rotate",
  thorough: "all",
};

/** The settings with what is the default left out, absent when nothing is set. */
const tidy = (review: ReviewSettings): ReviewSettings | undefined => {
  const entries = Object.entries(review).filter(
    ([field, value]) =>
      value !== undefined &&
      !(field === "on" && value === true) &&
      !(field === "findingsLog" && value === false) &&
      !(Array.isArray(value) && value.length === 0) &&
      !(
        field === "goal" &&
        typeof value === "object" &&
        Object.keys(value as object).length === 0
      )
  );
  return entries.length === 0
    ? undefined
    : (Object.fromEntries(entries) as ReviewSettings);
};

/** Every agent's models and efforts, as their last session offered them; asked where unknown. */
const useAgentOptions = (open: boolean) => {
  const agents = useAgents((s) => s.agents);
  const [known, setKnown] = useState<readonly AgentOptions[]>([]);
  const [problems, setProblems] = useState<Record<string, string>>({});
  useEffect(() => {
    useAgents.getState().load();
    api()
      .request("agents.options", undefined)
      .then(setKnown)
      .catch(reportError);
  }, []);
  // The agents being asked: one's answer changes what is known, and must not ask the others,
  // which start a session each to answer, a second time.
  const asking = useRef(new Set<string>());
  useEffect(() => {
    if (!open) {
      return;
    }
    for (const agent of agents) {
      if (
        known.some((k) => k.agentId === agent.id) ||
        problems[agent.id] ||
        asking.current.has(agent.id)
      ) {
        continue;
      }
      asking.current.add(agent.id);
      api()
        .request("agents.discover", { agentId: agent.id })
        .then((options) =>
          setKnown((k) => [...k.filter((x) => x.agentId !== agent.id), options])
        )
        .catch((error: { message?: string }) =>
          setProblems((p) => ({
            ...p,
            [agent.id]: error.message ?? String(error),
          }))
        )
        .finally(() => asking.current.delete(agent.id));
    }
  }, [agents, known, open, problems]);
  /** Asks the agent again: after a sign-in, or when asking failed. */
  const retry = (agentId: string) =>
    setProblems(({ [agentId]: _dropped, ...rest }) => rest);
  return { agents, known, problems, retry };
};

interface Choices {
  /** The effort a model reviews with when none is chosen: the agent's own. */
  readonly defaultEffort: string | undefined;
  readonly efforts: readonly { name: string; value: string }[];
  readonly models: readonly { name: string; value: string }[];
}

const choicesOf = (options: AgentOptions | undefined): Choices => {
  // The agent's unnamed default stands for the value it names, as the composer shows it.
  const named = withNamedChoices(options?.configOptions ?? []);
  const model = named.find(isModelOption);
  const effort = named.find(isEffortOption);
  return {
    defaultEffort: effort?.currentValue,
    efforts: effort ? namedChoices(effort) : [],
    models: model ? namedChoices(model) : [],
  };
};

/** A review model's name as its agent names the model. */
const nameOf = (model: ReviewModel, known: readonly AgentOptions[]) =>
  choicesOf(known.find((k) => k.agentId === model.agentId)).models.find(
    (m) => m.value === model.model
  )?.name ?? model.model;

const same = (a: ReviewModel, b: ReviewModel) =>
  a.agentId === b.agentId && a.model === b.model;

/** One chosen model: its handle, name, agent, effort and removal. */
const ChosenRow = ({
  agentName,
  defaultEffort,
  efforts,
  model,
  name,
  onEffort,
  onMove,
  onRemove,
  onDragEnd,
  onDragStart,
  onDrop,
}: {
  agentName: string;
  defaultEffort: string | undefined;
  efforts: Choices["efforts"];
  model: ReviewModel;
  name: string;
  onEffort: (effort: string) => void;
  onMove: (step: -1 | 1) => void;
  onRemove: () => void;
  /** The drag is over, wherever it was let go. */
  onDragEnd: () => void;
  onDragStart: () => void;
  onDrop: () => void;
}) => {
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const step = { ArrowDown: 1, ArrowUp: -1 }[e.key] as -1 | 1 | undefined;
    if (step !== undefined) {
      e.preventDefault();
      onMove(step);
    }
  };
  return (
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: the drop target of a drag; the handle is the row's control
    <li
      className="flex h-8 items-center gap-1 rounded-md pr-1 hover:bg-accent/60"
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      <button
        aria-label={`Move ${name}`}
        className="flex size-6 shrink-0 cursor-grab items-center justify-center rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        draggable
        onDragEnd={onDragEnd}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", name);
          onDragStart();
        }}
        onKeyDown={onKeyDown}
        type="button"
      >
        <GripVertical className="size-3.5" />
      </button>
      <span className="min-w-0 flex-1 truncate font-body-medium">{name}</span>
      <span className="shrink-0 truncate font-body-small text-muted-foreground">
        {agentName}
      </span>
      {efforts.length > 0 ? (
        <OptionSelect
          aria-label={`Effort of ${name}`}
          className="w-fit"
          onChange={onEffort}
          options={efforts.map((e) => ({ label: e.name, value: e.value }))}
          size="sm"
          value={model.effort ?? defaultEffort ?? null}
        />
      ) : null}
      <IconButton onClick={onRemove} size="icon-sm" tooltip={`Remove ${name}`}>
        <X />
      </IconButton>
    </li>
  );
};

/**
 * The review models in turn order, and every model of every agent the editor has to add. The
 * first one is Quick's; Standard goes down the list.
 */
const ReviewModelsPicker = ({
  models,
  onChange,
  ordered,
}: {
  models: readonly ReviewModel[];
  onChange: (models: readonly ReviewModel[]) => void;
  /** They take turns, or Quick uses the first: their order says something. */
  ordered: boolean;
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [dragged, setDragged] = useState<number | null>(null);
  const setup = platform().agents;
  const { agents, known, problems, retry } = useAgentOptions(open);
  // Signing in happens in the browser; the agent's state is asked for again after it.
  const signIn = (
    agentId: Parameters<NonNullable<typeof setup>["signIn"]>[0]
  ) =>
    setup
      ?.signIn(agentId)
      .then(() => useMachineAgents.getState().load())
      .then(() => retry(agentId))
      .catch(reportError);
  const machine = useMachineAgents((s) => s.agents);
  const agentName = (id: string) => agents.find((a) => a.id === id)?.name ?? id;
  const names = models.map((m) => nameOf(m, known));
  const summary =
    names.length > 0 ? names.join(", ") : "Strongest of each agent";
  const move = (from: number, to: number) => {
    if (to < 0 || to >= models.length || from === to) {
      return;
    }
    const next = [...models];
    const [taken] = next.splice(from, 1);
    if (taken) {
      next.splice(to, 0, taken);
      onChange(next);
    }
  };
  const needle = query.trim().toLowerCase();
  const matches = (owner: string, modelName: string) =>
    needle === "" || `${modelName} ${owner}`.toLowerCase().includes(needle);
  const anyMatch = agents.some((agent) =>
    choicesOf(known.find((k) => k.agentId === agent.id)).models.some(
      (c) =>
        !models.some((m) => same(m, { agentId: agent.id, model: c.value })) &&
        matches(agent.name, c.name)
    )
  );
  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger
        aria-label={`Review models: ${summary}`}
        // A select's look, as the row's other controls: it opens the list of models.
        className={cn(selectTriggerClass, "w-full min-w-0", rowField)}
        data-size="default"
      >
        <span className="truncate">{summary}</span>
        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 gap-0 p-1" side="top">
        {models.length > 0 ? (
          <section className="flex flex-col gap-0.5 p-1">
            <h4 className="px-1 pb-1 font-body-small text-muted-foreground">
              {ordered ? "In turn order" : "Chosen"}
            </h4>
            <ol className="flex flex-col gap-0.5">
              {models.map((m, i) => {
                const { defaultEffort, efforts } = choicesOf(
                  known.find((k) => k.agentId === m.agentId)
                );
                return (
                  <ChosenRow
                    agentName={agentName(m.agentId)}
                    defaultEffort={defaultEffort}
                    efforts={efforts}
                    key={`${m.agentId}:${m.model}`}
                    model={m}
                    name={names[i] ?? m.model}
                    onDragEnd={() => setDragged(null)}
                    onDragStart={() => setDragged(i)}
                    onDrop={() => {
                      if (dragged !== null) {
                        move(dragged, i);
                      }
                      setDragged(null);
                    }}
                    onEffort={(effort) =>
                      onChange(
                        models.map((x, j) => (j === i ? { ...x, effort } : x))
                      )
                    }
                    onMove={(step) => move(i, i + step)}
                    onRemove={() => onChange(models.filter((_, j) => j !== i))}
                  />
                );
              })}
            </ol>
          </section>
        ) : null}
        <div
          className={cn(
            "flex flex-col gap-1 p-1",
            models.length > 0 && "mt-1 border-t pt-2"
          )}
        >
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Add a model"
              className="h-7 pl-7"
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Add a model"
              value={query}
            />
          </div>
          <div className="flex max-h-72 flex-col gap-2 overflow-y-auto pt-1">
            {agents.map((agent) => {
              const options = known.find((k) => k.agentId === agent.id);
              const here = machine[agent.id];
              const word = readiness(here);
              const unchosen = choicesOf(options).models.filter(
                (c) =>
                  !models.some((m) =>
                    same(m, { agentId: agent.id, model: c.value })
                  ) && matches(agent.name, c.name)
              );
              const problem = problems[agent.id];
              const waiting = !(options || problem);
              if (needle !== "" && unchosen.length === 0) {
                return null;
              }
              return (
                <section className="flex flex-col gap-0.5" key={agent.id}>
                  <h4 className="flex h-6 items-center justify-between px-1 font-body-small text-muted-foreground">
                    {agent.name}
                    {here?.state === "signed-out" &&
                    here.signInWith &&
                    setup ? (
                      <Button
                        className="h-6 px-1.5 font-body-small"
                        onClick={() => signIn(here.id)}
                        size="sm"
                        variant="ghost"
                      >
                        Sign in
                      </Button>
                    ) : null}
                  </h4>
                  {waiting ? (
                    <p className="px-1 py-1 font-body-small text-muted-foreground">
                      Asking {agent.name} for its models…
                    </p>
                  ) : null}
                  {problem ? (
                    <div className="flex items-start gap-2 rounded-md bg-destructive/10 px-2 py-1.5 font-body-small text-destructive">
                      <p className="min-w-0 flex-1">
                        {word ??
                          `${agent.name} couldn’t list its models: ${problem}`}
                      </p>
                      <Button
                        className="-my-0.5 h-6 shrink-0 px-1.5 font-body-small"
                        onClick={() => retry(agent.id)}
                        size="sm"
                        variant="ghost"
                      >
                        Try again
                      </Button>
                    </div>
                  ) : null}
                  {unchosen.map((c) => (
                    <button
                      className="flex h-7 items-center gap-2 rounded-md px-1 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                      disabled={word !== null}
                      key={c.value}
                      onClick={() =>
                        onChange([
                          ...models,
                          { agentId: agent.id, model: c.value },
                        ])
                      }
                      type="button"
                    >
                      <span
                        aria-hidden
                        className="size-4 shrink-0 rounded-sm border border-muted-foreground"
                      />
                      <span className="min-w-0 flex-1 truncate font-body-medium">
                        {c.name}
                      </span>
                      {word ? (
                        <span className="shrink-0 font-body-small text-muted-foreground">
                          {word}
                        </span>
                      ) : null}
                    </button>
                  ))}
                </section>
              );
            })}
            {needle !== "" && !anyMatch ? (
              <div className="flex items-center gap-2 px-1 py-1 font-body-small text-muted-foreground">
                <p className="min-w-0 flex-1 truncate">
                  No model matches “{query.trim()}”.
                </p>
                <Button
                  className="-my-0.5 h-6 shrink-0 px-1.5 font-body-small"
                  onClick={() => setQuery("")}
                  size="sm"
                  variant="ghost"
                >
                  Clear search
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};

/** A goal: until every review model approves, or a score each reaches. */
const GoalRow = ({
  onChange,
  score,
}: {
  onChange: (score: number | undefined) => void;
  score: number | undefined;
}) => {
  const [draft, setDraft] = useState(String(score ?? 90));
  return (
    <Row
      description={
        score === undefined
          ? "Each review model decides when the design is good enough."
          : "Every review model scores the design at least this, out of 100."
      }
      title="Goal"
    >
      <div className="flex items-center gap-2">
        {score === undefined ? null : (
          <Input
            aria-label="Score"
            className="h-7 w-16 text-right"
            inputMode="numeric"
            onBlur={() => {
              const n = Math.round(Number(draft));
              const valid = Number.isFinite(n) && n >= 1 && n <= 100;
              onChange(valid ? n : score);
              setDraft(String(valid ? n : score));
            }}
            onChange={(e) => setDraft(e.target.value)}
            value={draft}
          />
        )}
        <Segmented
          aria-label="Goal"
          onChange={(v) =>
            onChange(v === "score" ? Number(draft) || 90 : undefined)
          }
          options={[
            { label: "Until they approve", value: "approve" },
            { label: "A score", value: "score" },
          ]}
          value={score === undefined ? "approve" : "score"}
        />
      </div>
    </Row>
  );
};

/**
 * The Review group of Settings › Agents, editing the project’s `review`, saved as it changes
 * (ADR 0079); `message`, why a change wasn't saved.
 */
export const ReviewGroup = ({
  message,
  onChange,
  review,
}: {
  message?: ReactNode;
  onChange: (review: ReviewSettings | undefined) => void;
  review: ReviewSettings | undefined;
}) => {
  const level = levelOf(review);
  // Custom shows its rows when chosen, before any of them is changed, and keeps them once the
  // settings are Custom's, while a row is set to what a named level has: until a level is pressed.
  const [customOpen, setCustomOpen] = useState(level === "custom");
  if (level === "custom" && !customOpen) {
    setCustomOpen(true);
  }
  const shown = level === "custom" || customOpen ? "custom" : level;
  const merged = reviewSettingsOf(review);
  const set = (change: ReviewSettings) =>
    onChange(tidy({ ...review, ...change }));
  const onLevel = (next: ReviewLevel | "custom") => {
    if (next === "custom") {
      setCustomOpen(true);
      return;
    }
    setCustomOpen(false);
    onChange(tidy(withLevel(review, next)));
  };
  const score = merged.goal?.score;
  // What the models' order means at this level, said only where it means something.
  const eachRound = shown === "custom" ? merged.eachRound : LEVEL_ORDER[shown];
  const ordered = eachRound === "one" || eachRound === "rotate";
  const modelsLine = {
    all: undefined,
    one: "The first one reviews.",
    rotate: "They take turns in this order.",
  }[eachRound ?? "rotate"];
  return (
    <Group message={message} title="Review">
      <Row
        description={
          // Custom opened, nothing changed yet: the settings are still the level's.
          shown === "custom" && level !== "custom"
            ? `Choose the rounds, approval and goal. Until then, reviews run as ${LEVEL_NAMES[level]}.`
            : LEVEL_LINES[shown]
        }
        title="Level"
      >
        <Segmented
          aria-label="Level"
          className="@xl:w-auto"
          onChange={onLevel}
          options={[...REVIEW_LEVELS, "custom" as const].map((value) => ({
            label: LEVEL_NAMES[value],
            value,
          }))}
          value={shown}
        />
      </Row>
      {shown === "off" ? null : (
        <Row description={modelsLine} title="Review models">
          <ReviewModelsPicker
            models={review?.reviewModels ?? []}
            onChange={(reviewModels) =>
              set({ reviewModels: [...reviewModels] })
            }
            ordered={ordered}
          />
        </Row>
      )}
      {shown === "custom" ? (
        <>
          <Row title="Each round">
            <Segmented
              aria-label="Each round"
              className="@xl:w-auto"
              onChange={(next) => set({ eachRound: next, on: true })}
              options={EACH_ROUND.map((value) => ({
                label: EACH_ROUND_NAMES[value],
                value,
              }))}
              value={merged.eachRound ?? "rotate"}
            />
          </Row>
          <Row htmlFor="settings-review-approval" title="Approval">
            <OptionSelect
              className={rowField}
              id="settings-review-approval"
              onChange={(value) =>
                set({ approval: value as Approval, on: true })
              }
              options={APPROVAL.map((value) => ({
                label: APPROVAL_NAMES[value],
                value,
              }))}
              value={merged.approval ?? "all"}
            />
          </Row>
          <GoalRow
            // A score set elsewhere (Cancel, a level chosen) starts the field again.
            key={score ?? "approve"}
            onChange={(next) => {
              const { score: _score, ...rest } = merged.goal ?? {};
              set({
                goal: next === undefined ? rest : { ...rest, score: next },
                on: true,
              });
            }}
            score={score}
          />
        </>
      ) : null}
    </Group>
  );
};
