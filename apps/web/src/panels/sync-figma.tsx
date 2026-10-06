/**
 * Figma's tokens against the code's, in the Sync view (ADR 0025). Each of Figma's tokens is first
 * matched to the code's — by rules where it is certain, by an agent with the user, or by the user
 * here — and nothing unmatched is written. Then what Figma changed alone is taken into the code;
 * where Figma is behind, the code is kept; where both changed, or there is no earlier sync to
 * tell, the user picks, token by token or all at once. Applying writes the code and keeps where
 * the two agree, and the matches, for the next sync.
 */
import type {
  FigmaDecision,
  FigmaMatchInput,
  FigmaTokenComparison,
  FigmaTokenDiff,
  SyncPlan,
} from "@ultrapaint/contracts/sync";
import { baselineKey } from "@ultrapaint/contracts/sync";
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
import { startCommand } from "../lib/start-thread.ts";
import { api } from "../state/connection.ts";
import { reportError } from "../state/project.ts";
import { useSync } from "../state/sync.ts";

const LEAVE_OUT = "__leave-out";
const NEW_NAMED = "__new-named";
/** Matches listed before "Show all". */
const FIRST_MATCHES = 30;

const BY: Record<NonNullable<FigmaTokenDiff["by"]>, string> = {
  agent: "agent",
  rule: "rule",
  user: "you",
};

type Take = FigmaDecision["take"];
type Picks = Readonly<Record<string, Take>>;

const keyOf = (d: FigmaTokenDiff) => baselineKey(d.name, d.theme);

const labelOf = (d: FigmaTokenDiff) =>
  d.theme ? `${d.name} (${d.theme})` : d.name;

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

const outcomes = (comparison: FigmaTokenComparison) => {
  const by = (outcome: FigmaTokenDiff["outcome"]) =>
    comparison.diffs.filter((d) => d.outcome === outcome);
  const toCode = by("to-code");
  return {
    added: toCode.filter((d) => d.code === undefined),
    behind: by("figma-behind"),
    changed: toCode.filter((d) => d.code !== undefined),
    conflicts: by("conflict"),
    same: by("same"),
    toCode,
  };
};

/** One row per Figma token: its default theme's comparison stands for the others. */
const tokensOf = (comparison: FigmaTokenComparison) => {
  const seen = new Set<string>();
  return comparison.diffs.filter((d) => {
    if (seen.has(d.variable)) {
      return false;
    }
    seen.add(d.variable);
    return true;
  });
};

const unmatchedIn = (tokens: readonly FigmaTokenDiff[]) =>
  tokens.filter((d) => d.outcome === "unmatched");

/** Saves matches; what the server would not take is said, and the rest stays. */
const saveMatches = async (entries: readonly FigmaMatchInput[]) => {
  try {
    const { problems } = await api().request("sync.matchFigma", { entries });
    if (problems.length > 0) {
      toast.error(problems.join(" "));
    }
  } catch (error) {
    reportError(error);
  }
};

const choiceOf = (d: FigmaTokenDiff) => {
  if (d.outcome === "unmatched") {
    return "";
  }
  return d.outcome === "ignored" ? LEAVE_OUT : d.name;
};

const MatchRow = ({
  token,
  targets,
}: {
  targets: readonly string[];
  token: FigmaTokenDiff;
}) => {
  const matched = token.outcome !== "unmatched" && token.outcome !== "ignored";
  // A new token's name, Figma's own when nothing is matched yet.
  const fresh = targets.includes(token.name) ? null : token.name;
  const decide = async (choice: string) => {
    if (choice === NEW_NAMED) {
      const name = await promptDialog({
        confirmLabel: "Match",
        defaultValue: fresh ?? "",
        description: `What ${token.variable} is called in the code: lower case, words joined by dashes.`,
        title: "A new token",
      });
      if (name?.trim()) {
        await saveMatches([{ to: name.trim(), variable: token.variable }]);
      }
      return;
    }
    let to: string | null | undefined = choice;
    if (choice === "") {
      to = undefined;
    } else if (choice === LEAVE_OUT) {
      to = null;
    }
    await saveMatches([
      { ...(to !== undefined && { to }), variable: token.variable },
    ]);
  };
  return (
    <li className="flex flex-col gap-1 py-1.5">
      <span
        className="flex min-w-0 items-center gap-1.5"
        title={token.variable}
      >
        <Value kind={token.kind} value={token.figma} />
        <span className="ml-auto shrink-0 font-body text-muted-foreground">
          {token.by ? BY[token.by] : ""}
        </span>
      </span>
      <span className="truncate font-body text-muted-foreground">
        {token.variable}
        {token.alias ? ` → ${token.alias}` : ""}
      </span>
      <NativeSelect
        aria-label={`What ${token.variable} is in the code`}
        className="min-w-0"
        onChange={(e) => decide(e.target.value)}
        size="sm"
        value={choiceOf(token)}
      >
        <NativeSelectOption value="">Not matched</NativeSelectOption>
        <NativeSelectOption value={LEAVE_OUT}>
          Left out of the code
        </NativeSelectOption>
        {fresh ? (
          <NativeSelectOption value={fresh}>
            {matched ? `New: ${fresh}` : `New, as Figma names it: ${fresh}`}
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
 * What each of Figma's tokens is in the code. Open while some are unmatched; the agent, or the
 * user row by row, matches them, and the rest can be added or left out at once.
 */
const Matches = ({ comparison }: { comparison: FigmaTokenComparison }) => {
  const tokens = tokensOf(comparison);
  const unmatched = unmatchedIn(tokens);
  const [open, setOpen] = useState(unmatched.length > 0);
  const [all, setAll] = useState(false);
  // The unmatched first: they are what is left to do.
  const ordered = [
    ...unmatched,
    ...tokens.filter((d) => d.outcome !== "unmatched"),
  ];
  const shown = all ? ordered : ordered.slice(0, FIRST_MATCHES);
  const rest = (to: (d: FigmaTokenDiff) => string | null) =>
    saveMatches(unmatched.map((d) => ({ to: to(d), variable: d.variable })));
  return (
    <div className="flex flex-col gap-1">
      <span>
        {unmatched.length > 0
          ? `${unmatched.length} of ${plural(tokens.length, "Figma token")} not matched to the code yet: nothing of theirs is written.`
          : `All ${plural(tokens.length, "Figma token")} matched to the code or left out.`}
      </span>
      <div className="flex flex-wrap gap-1.5">
        <Button
          onClick={() => startCommand("/sync figma")}
          size="sm"
          variant={unmatched.length > 0 ? "default" : "outline"}
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
                Add the rest as Figma names them
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
const Names = ({ diffs }: { diffs: readonly FigmaTokenDiff[] }) => (
  <span className="font-code text-muted-foreground">
    {diffs.slice(0, 6).map(labelOf).join(", ")}
    {diffs.length > 6 ? ` and ${diffs.length - 6} more` : ""}
  </span>
);

const Listed = ({
  diffs,
  title,
}: {
  diffs: readonly FigmaTokenDiff[];
  title: string;
}) =>
  diffs.length > 0 ? (
    <div className="flex flex-col gap-0.5">
      <span>{title}</span>
      <Names diffs={diffs} />
    </div>
  ) : null;

const Conflicts = ({
  baseline,
  conflicts,
  onPick,
  picks,
}: {
  baseline: boolean;
  conflicts: readonly FigmaTokenDiff[];
  onPick: (picks: Picks) => void;
  picks: Picks;
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
        <Button onClick={() => all("figma")} size="sm" variant="outline">
          All from Figma
        </Button>
        <Button onClick={() => all("code")} size="sm" variant="outline">
          All from the code
        </Button>
      </div>
      <ul className="flex flex-col">
        {conflicts.map((d) => (
          <li className="flex flex-col gap-1 py-1.5" key={keyOf(d)}>
            <span className="truncate font-medium" title={d.variable}>
              {labelOf(d)}
            </span>
            <Segmented
              onChange={(take) => onPick({ ...picks, [keyOf(d)]: take })}
              options={[
                {
                  label: <Value kind={d.kind} value={d.figma} />,
                  title: `Figma: ${d.variable}`,
                  value: "figma" as const,
                },
                {
                  label: <Value kind={d.kind} value={d.code ?? "none"} />,
                  title: "The code",
                  value: "code" as const,
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

/** Writes what Figma changed and the conflicts given to it; true when it went through. */
const applyPicks = async (
  comparison: FigmaTokenComparison,
  conflicts: readonly FigmaTokenDiff[],
  picks: Picks
) => {
  const decisions: FigmaDecision[] = conflicts.flatMap((d) => {
    const take = picks[keyOf(d)];
    return take
      ? [{ name: d.name, take, ...(d.theme && { theme: d.theme }) }]
      : [];
  });
  try {
    const { files, written } = await api().request("sync.applyFigma", {
      decisions,
    });
    toast.success(
      written === 0
        ? `${comparison.file} and the code agree; the sync remembers it.`
        : `${plural(written, "token")} written to ${files.join(", ")}.`
    );
    await useSync.getState().load();
    return true;
  } catch (error) {
    reportError(error);
    return false;
  }
};

const applyLabel = (undecided: number, writes: number, unmatched: number) => {
  if (undecided > 0) {
    return `${undecided} left to pick`;
  }
  if (writes === 0 && unmatched > 0) {
    return "Nothing matched to write yet";
  }
  return `Write ${plural(writes, "token")} to the code`;
};

export const FigmaTokensStep = ({ plan }: { plan: SyncPlan }) => {
  const [comparison, setComparison] = useState<FigmaTokenComparison | null>(
    null
  );
  const [picks, setPicks] = useState<Picks>({});
  const [busy, setBusy] = useState(false);

  // Read again whenever the plan moves: a new import, the code changed.
  useEffect(() => {
    if (plan.at > 0) {
      api()
        .request("sync.figmaTokens", undefined)
        .then(setComparison)
        .catch(reportError);
    }
  }, [plan.at]);

  if (!comparison) {
    return <Spinner />;
  }
  const { added, behind, changed, conflicts, same, toCode } =
    outcomes(comparison);
  const undecided = conflicts.filter((d) => !picks[keyOf(d)]).length;
  const writes =
    toCode.length + conflicts.filter((d) => picks[keyOf(d)] === "figma").length;
  const unmatched = unmatchedIn(tokensOf(comparison)).length;
  const agreed =
    toCode.length + conflicts.length + unmatched === 0 && comparison.baseline;

  const apply = async () => {
    setBusy(true);
    if (await applyPicks(comparison, conflicts, picks)) {
      setPicks({});
    }
    setBusy(false);
  };

  if (agreed) {
    return (
      <div className="flex flex-col gap-2 font-body">
        <p className="flex items-center gap-1.5">
          <Check className="size-3.5 text-primary" />
          {plural(same.length, "token")} agree with {comparison.file}.
          {behind.length > 0
            ? ` The code changed ${behind.length} since; Figma is behind.`
            : ""}
        </p>
        <Matches comparison={comparison} />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2 font-body">
      {comparison.notes.map((note) => (
        <p className="text-muted-foreground" key={note}>
          {note}
        </p>
      ))}
      <Matches comparison={comparison} />
      <Listed diffs={added} title={`${added.length} new, added to the code:`} />
      <Listed
        diffs={changed}
        title={`${changed.length} changed in Figma, taken into the code:`}
      />
      <Listed
        diffs={behind}
        title={`${behind.length} changed in the code since; Figma is behind and the code is kept:`}
      />
      <Conflicts
        baseline={comparison.baseline}
        conflicts={conflicts}
        onPick={setPicks}
        picks={picks}
      />
      <Button
        className="self-start"
        disabled={busy || undecided > 0 || (writes === 0 && unmatched > 0)}
        onClick={apply}
        size="sm"
      >
        {busy ? <Spinner /> : null}
        {applyLabel(undecided, writes, unmatched)}
      </Button>
    </div>
  );
};
