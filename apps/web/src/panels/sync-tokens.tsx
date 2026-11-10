/**
 * A source's tokens against the design system's, in the Sync view: a Figma import's (ADR 0025),
 * or DESIGN.md's front matter (ADR 0027). The design system holds the values (ADR 0028); while
 * there
 * is none yet, Figma's are compared with the code's, which it is then made from. Each of the
 * source's tokens is first matched — by rules where it is certain, by an agent with the user, or
 * by the user here — and nothing unmatched is taken. Then what the source changed alone is taken;
 * where it is behind, the design system is kept; where both changed, or there is no earlier
 * agreement to tell, the user picks, token by token or all at once. Applying keeps where the two
 * agree, and the matches, for the next sync.
 */
import type {
  SyncPlan,
  TokenComparison,
  TokenDecision,
  TokenDiff,
  TokenMatchInput,
  TokenSourceKind,
} from "@ultrapaint/contracts/sync";
import { baselineKey } from "@ultrapaint/contracts/sync";
import { TOKEN_NAME_SHAPE } from "@ultrapaint/contracts/token-table";
import { plural } from "@ultrapaint/shared/text";
import { Check, ChevronDown, Wand2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { promptDialog } from "../components/dialogs.tsx";
import { Segmented } from "../components/segmented.tsx";
import { startTask } from "../lib/start-thread.ts";
import { api } from "../state/connection.ts";
import { reportError } from "../state/project.ts";
import { useSync } from "../state/sync.ts";
import { useStepVariant } from "./design-system-setup.tsx";

const LEAVE_OUT = "__leave-out";
const NEW_NAMED = "__new-named";
/** Matches listed before "Show all". */
const FIRST_MATCHES = 30;

const BY: Record<NonNullable<TokenDiff["by"]>, string> = {
  agent: "agent",
  rule: "rule",
  user: "you",
};

type Take = TokenDecision["take"];
type Picks = Readonly<Record<string, Take>>;

/** What the user calls the source. */
const LABEL: Record<TokenSourceKind, string> = {
  code: "the code",
  designMd: "DESIGN.md",
  figma: "Figma",
};

/** Sources whose tokens are named their own way, and matched before anything is taken. */
const matchedSource = (source: TokenSourceKind) =>
  source === "figma" || source === "designMd";

const keyOf = (d: TokenDiff) => baselineKey(d.name, d.theme);

const labelOf = (d: TokenDiff) => (d.theme ? `${d.name} (${d.theme})` : d.name);

const outcomes = (comparison: TokenComparison) => {
  const by = (outcome: TokenDiff["outcome"]) =>
    comparison.diffs.filter((d) => d.outcome === outcome);
  const taken = by("to-design");
  return {
    added: taken.filter((d) => d.design === undefined),
    behind: by("source-behind"),
    changed: taken.filter((d) => d.design !== undefined),
    conflicts: by("conflict"),
    same: by("same"),
    taken,
  };
};

/** One row per token of the source: its default theme's comparison stands for the others. */
const tokensOf = (comparison: TokenComparison) => {
  const seen = new Set<string>();
  return comparison.diffs.filter((d) => {
    if (seen.has(d.variable)) {
      return false;
    }
    seen.add(d.variable);
    return true;
  });
};

const unmatchedIn = (tokens: readonly TokenDiff[]) =>
  tokens.filter((d) => d.outcome === "unmatched");

/** Saves matches; what the server would not take is said, and the rest stays. */
const saveMatches = async (
  source: TokenSourceKind,
  entries: readonly TokenMatchInput[]
) => {
  try {
    const { problems } = await api().request("sync.match", {
      entries,
      source,
    });
    if (problems.length > 0) {
      toast.error(problems.join(" "));
    }
  } catch (error) {
    reportError(error);
  }
};

const choiceOf = (d: TokenDiff) => {
  if (d.outcome === "unmatched") {
    return "";
  }
  return d.outcome === "ignored" ? LEAVE_OUT : d.name;
};

const MatchRow = ({
  source,
  target,
  token,
  targets,
}: {
  source: TokenSourceKind;
  /** What the tokens are matched to, as the user calls it: the design system, or the code. */
  target: string;
  targets: readonly string[];
  token: TokenDiff;
}) => {
  const matched = token.outcome !== "unmatched" && token.outcome !== "ignored";
  // A new token's name, the source's own when nothing is matched yet.
  const fresh = targets.includes(token.name) ? null : token.name;
  const decide = async (choice: string) => {
    if (choice === NEW_NAMED) {
      const name = await promptDialog({
        confirmLabel: "Match",
        defaultValue: fresh ?? "",
        description: `What ${token.variable} is called in ${target}: ${TOKEN_NAME_SHAPE}.`,
        title: "A new token",
      });
      if (name?.trim()) {
        await saveMatches(source, [
          { to: name.trim(), variable: token.variable },
        ]);
      }
      return;
    }
    let to: string | null | undefined = choice;
    if (choice === "") {
      to = undefined;
    } else if (choice === LEAVE_OUT) {
      to = null;
    }
    await saveMatches(source, [
      { ...(to !== undefined && { to }), variable: token.variable },
    ]);
  };
  return (
    <li className="flex flex-col gap-1 py-1.5">
      <span
        className="flex min-w-0 items-center gap-1.5"
        title={token.variable}
      >
        <Value kind={token.kind} value={token.source ?? ""} />
        <span className="ml-auto shrink-0 font-body-small text-muted-foreground">
          {token.by ? BY[token.by] : ""}
        </span>
      </span>
      <span className="truncate font-body-small text-muted-foreground">
        {token.variable}
        {token.alias ? ` → ${token.alias}` : ""}
      </span>
      <NativeSelect
        aria-label={`What ${token.variable} is in ${target}`}
        className="min-w-0"
        onChange={(e) => decide(e.target.value)}
        size="sm"
        value={choiceOf(token)}
      >
        <NativeSelectOption value="">Not matched</NativeSelectOption>
        <NativeSelectOption value={LEAVE_OUT}>Left out</NativeSelectOption>
        {fresh ? (
          <NativeSelectOption value={fresh}>
            {matched
              ? `New: ${fresh}`
              : `New, as ${LABEL[source]} names it: ${fresh}`}
          </NativeSelectOption>
        ) : null}
        <NativeSelectOption value={NEW_NAMED}>New, named…</NativeSelectOption>
        {targets.map((t) => (
          <NativeSelectOption key={t} value={t}>
            {t}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </li>
  );
};

/**
 * What each of the source's tokens is in the code. Open while some are unmatched; the agent, or
 * the user row by row, matches them, and the rest can be added or left out at once.
 */
const Matches = ({
  comparison,
  target,
}: {
  comparison: TokenComparison;
  target: string;
}) => {
  const { source } = comparison;
  const label = LABEL[source];
  const tokens = tokensOf(comparison);
  const unmatched = unmatchedIn(tokens);
  const [open, setOpen] = useState(unmatched.length > 0);
  const [all, setAll] = useState(false);
  const main = useStepVariant();
  // The unmatched first: they are what is left to do.
  const ordered = [
    ...unmatched,
    ...tokens.filter((d) => d.outcome !== "unmatched"),
  ];
  const shown = all ? ordered : ordered.slice(0, FIRST_MATCHES);
  const rest = (to: (d: TokenDiff) => string | null) =>
    saveMatches(
      source,
      unmatched.map((d) => ({ to: to(d), variable: d.variable }))
    );
  return (
    <div className="flex flex-col gap-1">
      <span>
        {unmatched.length > 0
          ? `${unmatched.length} of ${plural(tokens.length, `${label} token`)} not matched to ${target} yet: nothing of theirs is taken.`
          : `All ${plural(tokens.length, `${label} token`)} matched to ${target} or left out.`}
      </span>
      <div className="flex flex-wrap gap-1.5">
        <Button
          onClick={() =>
            startTask({
              _tag: "Sync",
              source: source === "designMd" ? "design" : source,
            })
          }
          size="sm"
          variant={unmatched.length > 0 ? main : "outline"}
        >
          <Wand2 />
          Match with an agent
        </Button>
        <Button onClick={() => setOpen(!open)} size="sm" variant="ghost">
          <ChevronDown className={open ? "rotate-180" : ""} />
          {open ? "Hide the matches" : "Review the matches"}
        </Button>
      </div>
      {open ? (
        <>
          {unmatched.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              <Button
                onClick={() => rest((d) => d.name)}
                size="sm"
                variant="outline"
              >
                Add the rest as {label} names them
              </Button>
              <Button
                onClick={() => rest(() => null)}
                size="sm"
                variant="outline"
              >
                Leave the rest out
              </Button>
            </div>
          ) : null}
          <ul className="flex flex-col">
            {shown.map((d) => (
              <MatchRow
                key={d.variable}
                source={source}
                target={target}
                targets={comparison.targets
                  .filter((t) => t.kind === d.kind)
                  .map((t) => t.name)}
                token={d}
              />
            ))}
          </ul>
          {ordered.length > shown.length ? (
            <Button
              className="self-start"
              onClick={() => setAll(true)}
              size="sm"
              variant="ghost"
            >
              Show all {ordered.length}
            </Button>
          ) : null}
        </>
      ) : null}
    </div>
  );
};

/** A value, with a swatch when it is a colour. */
const Value = ({ kind, value }: { kind: string; value: string }) => (
  <span className="flex min-w-0 items-center gap-1">
    {kind === "color" ? (
      <span
        className="size-3 shrink-0 rounded-sm border"
        style={{ background: value }}
      />
    ) : null}
    <span className="truncate font-code">{value}</span>
  </span>
);

/** A few of a list, by name, then how many more. */
const Names = ({ diffs }: { diffs: readonly TokenDiff[] }) => (
  <span className="font-code text-muted-foreground">
    {diffs.slice(0, 6).map(labelOf).join(", ")}
    {diffs.length > 6 ? ` and ${diffs.length - 6} more` : ""}
  </span>
);

const Listed = ({
  diffs,
  title,
}: {
  diffs: readonly TokenDiff[];
  title: string;
}) =>
  diffs.length > 0 ? (
    <div className="flex flex-col gap-0.5">
      <span>{title}</span>
      <Names diffs={diffs} />
    </div>
  ) : null;

export const Conflicts = ({
  baseline,
  conflicts,
  label,
  onPick,
  picks,
  target,
}: {
  baseline: boolean;
  conflicts: readonly TokenDiff[];
  label: string;
  onPick: (picks: Picks) => void;
  picks: Picks;
  /** The other side, as the user calls it: the design system, or the code. */
  target: string;
}) => {
  if (conflicts.length === 0) {
    return null;
  }
  const all = (take: Take) =>
    onPick(Object.fromEntries(conflicts.map((d) => [keyOf(d), take])));
  return (
    <div className="flex flex-col gap-1">
      <span>
        {baseline
          ? `${conflicts.length} changed on both sides: pick which to keep.`
          : `${conflicts.length} differ, and there is no earlier sync to tell which changed: pick which to keep.`}
      </span>
      <div className="flex gap-1.5">
        <Button onClick={() => all("source")} size="sm" variant="outline">
          All from {label}
        </Button>
        <Button onClick={() => all("design")} size="sm" variant="outline">
          All from {target}
        </Button>
      </div>
      <ul className="flex flex-col">
        {conflicts.map((d) => (
          <li className="flex flex-col gap-1 py-1.5" key={keyOf(d)}>
            <span className="truncate font-body-medium" title={d.variable}>
              {labelOf(d)}
            </span>
            <Segmented
              onChange={(take) => onPick({ ...picks, [keyOf(d)]: take })}
              options={[
                {
                  label: <Value kind={d.kind} value={d.source ?? "none"} />,
                  title: `${label}: ${d.variable}`,
                  value: "source" as const,
                },
                {
                  label: <Value kind={d.kind} value={d.design ?? "none"} />,
                  title: target,
                  value: "design" as const,
                },
              ]}
              value={picks[keyOf(d)] ?? null}
            />
          </li>
        ))}
      </ul>
    </div>
  );
};

/** Takes what the source changed and the conflicts given to it; true when it went through. */
export const applyPicks = async (
  comparison: TokenComparison,
  conflicts: readonly TokenDiff[],
  picks: Picks,
  only?: "export" | "import"
) => {
  const decisions: TokenDecision[] = conflicts.flatMap((d) => {
    const take = picks[keyOf(d)];
    return take
      ? [{ name: d.name, take, ...(d.theme && { theme: d.theme }) }]
      : [];
  });
  try {
    const { files, written } = await api().request("sync.apply", {
      decisions,
      ...(only && { only }),
      source: comparison.source,
    });
    toast.success(
      written === 0
        ? `${comparison.file} and the design agree; the sync remembers it.`
        : `${plural(written, "token")} written to ${files.join(", ")}.`
    );
    await useSync.getState().load();
    return true;
  } catch (error) {
    reportError(error);
    return false;
  }
};

const applyLabel = (
  undecided: number,
  writes: number,
  unmatched: number,
  target: string
) => {
  if (undecided > 0) {
    return `${undecided} left to pick`;
  }
  if (writes === 0 && unmatched > 0) {
    return "Nothing matched to take yet";
  }
  return `Take ${plural(writes, "token")} into ${target}`;
};

/**
 * A source's tokens against the design's, read again whenever the plan moves (a new import, the
 * design system, the code or the document changed). An answer to a read that is no longer the
 * last is dropped; a read that fails with nothing read before it says so, and `retry` reads again.
 */
export const useComparison = (plan: SyncPlan, source: TokenSourceKind) => {
  const [comparison, setComparison] = useState<TokenComparison | null>(null);
  const [failed, setFailed] = useState(false);
  const [asked, setAsked] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Try again asks once more.
  useEffect(() => {
    if (plan.at <= 0) {
      return;
    }
    let live = true;
    api()
      .request("sync.tokens", { source })
      .then(
        (read) => {
          if (live) {
            setComparison(read);
            setFailed(false);
          }
        },
        (error: unknown) => {
          if (live) {
            setFailed(true);
            reportError(error);
          }
        }
      );
    return () => {
      live = false;
    };
  }, [plan.at, source, asked]);

  const retry = () => {
    setFailed(false);
    setAsked((n) => n + 1);
  };
  return { comparison, failed, retry };
};

/** A comparison on its way, or one whose read failed: said in place, with the way to read again. */
export const Unread = ({
  failed,
  onRetry,
}: {
  failed: boolean;
  onRetry: () => void;
}) =>
  failed ? (
    <div className="flex items-center justify-between gap-2">
      <span className="truncate font-body-small text-muted-foreground">
        The tokens didn’t load
      </span>
      <Button onClick={onRetry} size="sm" variant="ghost">
        Try again
      </Button>
    </div>
  ) : (
    <Spinner />
  );

export const TokensStep = ({
  plan,
  source,
}: {
  plan: SyncPlan;
  source: TokenSourceKind;
}) => {
  const { comparison, failed, retry } = useComparison(plan, source);
  const [picks, setPicks] = useState<Picks>({});
  const [busy, setBusy] = useState(false);
  const main = useStepVariant();

  if (!comparison) {
    return <Unread failed={failed} onRetry={retry} />;
  }
  const label = LABEL[source];
  // Figma's tokens go into the code while there is no design system to take them (ADR 0028).
  const target = plan.facts.designSystem ? "the design system" : "the code";
  const { added, behind, changed, conflicts, same, taken } =
    outcomes(comparison);
  const undecided = conflicts.filter((d) => !picks[keyOf(d)]).length;
  const writes =
    taken.length + conflicts.filter((d) => picks[keyOf(d)] === "source").length;
  const unmatched = unmatchedIn(tokensOf(comparison)).length;
  const agreed =
    taken.length + conflicts.length + unmatched === 0 && comparison.baseline;

  const apply = async () => {
    setBusy(true);
    if (await applyPicks(comparison, conflicts, picks)) {
      setPicks({});
    }
    setBusy(false);
  };

  if (agreed) {
    return (
      <div className="flex flex-col gap-2 font-body-small">
        <p className="flex items-center gap-1.5">
          <Check className="size-3.5 text-success" />
          {plural(same.length, "token")} agree with {comparison.file}.
          {behind.length > 0
            ? ` ${target.charAt(0).toUpperCase()}${target.slice(1)} changed ${behind.length} since; ${label} is behind.`
            : ""}
        </p>
        {matchedSource(source) ? (
          <Matches comparison={comparison} target={target} />
        ) : null}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2 font-body-small">
      {comparison.notes.map((note) => (
        <p className="text-muted-foreground" key={note}>
          {note}
        </p>
      ))}
      {matchedSource(source) ? (
        <Matches comparison={comparison} target={target} />
      ) : null}
      <Listed diffs={added} title={`${added.length} new, added to ${target}`} />
      <Listed
        diffs={changed}
        title={`${changed.length} changed in ${label}, taken into ${target}`}
      />
      <Listed
        diffs={behind}
        title={
          source === "designMd"
            ? `${behind.length} changed in ${target} since; ${label} follows it:`
            : `${behind.length} changed in ${target} since; ${label} is behind and ${target} is kept:`
        }
      />
      <Conflicts
        baseline={comparison.baseline}
        conflicts={conflicts}
        label={label}
        onPick={setPicks}
        picks={picks}
        target={target}
      />
      <Button
        className="self-start"
        disabled={busy || undecided > 0 || (writes === 0 && unmatched > 0)}
        onClick={apply}
        size="sm"
        variant={main}
      >
        {busy ? <Spinner /> : null}
        {applyLabel(undecided, writes, unmatched, target)}
      </Button>
    </div>
  );
};
