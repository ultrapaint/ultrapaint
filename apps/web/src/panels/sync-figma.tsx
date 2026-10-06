/**
 * Figma's tokens against the code's, in the Sync view (ADR 0025). What Figma changed alone is
 * taken into the code; where Figma is behind, the code is kept; where both changed, or there is
 * no earlier sync to tell, the user picks, token by token or all at once. Applying writes the
 * code and keeps where the two agree for the next sync.
 */
import type {
  FigmaDecision,
  FigmaTokenComparison,
  FigmaTokenDiff,
  SyncPlan,
} from "@ultrapaint/contracts/sync";
import { baselineKey } from "@ultrapaint/contracts/sync";
import { Check } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Segmented } from "../components/segmented.tsx";
import { api } from "../state/connection.ts";
import { reportError } from "../state/project.ts";
import { useSync } from "../state/sync.ts";

type Take = FigmaDecision["take"];
type Picks = Readonly<Record<string, Take>>;

const keyOf = (d: FigmaTokenDiff) => baselineKey(d.name, d.theme);

const labelOf = (d: FigmaTokenDiff) =>
  d.theme ? `${d.name} (${d.theme})` : d.name;

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

const outcomes = (comparison: FigmaTokenComparison) => {
  const by = (outcome: FigmaTokenDiff["outcome"]) =>
    comparison.diffs.filter((d) => d.outcome === outcome);
  return {
    behind: by("figma-behind"),
    conflicts: by("conflict"),
    same: by("same"),
    toCode: by("to-code"),
  };
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
  const { behind, conflicts, same, toCode } = outcomes(comparison);
  const undecided = conflicts.filter((d) => !picks[keyOf(d)]).length;
  const writes =
    toCode.length + conflicts.filter((d) => picks[keyOf(d)] === "figma").length;
  const agreed = toCode.length + conflicts.length === 0 && comparison.baseline;

  const apply = async () => {
    setBusy(true);
    if (await applyPicks(comparison, conflicts, picks)) {
      setPicks({});
    }
    setBusy(false);
  };

  if (agreed) {
    return (
      <p className="flex items-center gap-1.5 font-body">
        <Check className="size-3.5 text-primary" />
        {plural(same.length, "token")} agree with {comparison.file}.
        {behind.length > 0
          ? ` The code changed ${behind.length} since; Figma is behind.`
          : ""}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2 font-body">
      {comparison.notes.map((note) => (
        <p className="text-muted-foreground" key={note}>
          {note}
        </p>
      ))}
      <Listed
        diffs={toCode}
        title={`${toCode.length} changed in Figma, taken into the code:`}
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
        disabled={busy || undecided > 0}
        onClick={apply}
        size="sm"
      >
        {busy ? <Spinner /> : null}
        {undecided > 0
          ? `${undecided} left to pick`
          : `Write ${plural(writes, "token")} to the code`}
      </Button>
    </div>
  );
};
