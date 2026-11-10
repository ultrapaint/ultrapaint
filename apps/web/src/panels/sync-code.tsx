/**
 * The code against the design system, in the Sync view (ADR 0028). The design holds the values;
 * the stylesheets follow it on export. What the design changed alone waits for the code; what the
 * code changed alone is offered to the design; where both changed, the user picks. The two
 * directions are applied apart or together, and a setting writes every token edit to the code at
 * once instead, as it was before the design held the values.
 */
import type {
  SyncPlan,
  TokenDecision,
  TokenDiff,
} from "@ultrapaint/contracts/sync";
import { baselineKey } from "@ultrapaint/contracts/sync";
import { plural } from "@ultrapaint/shared/text";
import { Check, Wand2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { CutText } from "../components/cut-text.tsx";
import { save } from "../lib/settings-actions.ts";
import { startTask } from "../lib/start-thread.ts";
import { reportError, useProject } from "../state/project.ts";
import { useStepVariant } from "./design-system-setup.tsx";
import {
  applyPicks,
  Conflicts,
  Unread,
  useComparison,
} from "./sync-tokens.tsx";

type Picks = Readonly<Record<string, TokenDecision["take"]>>;

const keyOf = (d: TokenDiff) => baselineKey(d.name, d.theme);

/** A token, its value on each side. */
const Row = ({ diff }: { diff: TokenDiff }) => (
  <li className="flex min-w-0 items-center gap-1.5 py-0.5">
    <CutText className="truncate font-code">
      {diff.theme ? `${diff.name} (${diff.theme})` : diff.name}
    </CutText>
    <span className="ml-auto flex shrink-0 items-center gap-1 font-code text-muted-foreground">
      {[diff.source ?? "none", diff.design ?? "none"].map((value, i) => (
        <span
          className="flex items-center gap-1"
          key={i === 0 ? "code" : "design"}
        >
          {i === 1 ? "→ " : ""}
          {diff.kind === "color" && value !== "none" ? (
            <span
              className="size-3 rounded-sm border"
              style={{ background: value }}
            />
          ) : null}
          {value}
        </span>
      ))}
    </span>
  </li>
);

const List = ({
  diffs,
  title,
}: {
  diffs: readonly TokenDiff[];
  title: string;
}) =>
  diffs.length > 0 ? (
    <div className="flex flex-col gap-0.5">
      <span>{title}</span>
      <ul className="flex flex-col">
        {diffs.slice(0, 12).map((d) => (
          <Row diff={d} key={keyOf(d)} />
        ))}
      </ul>
      {diffs.length > 12 ? (
        <span className="text-muted-foreground">{diffs.length - 12} more</span>
      ) : null}
    </div>
  ) : null;

/** Whether token edits reach the stylesheets at once (`codeTokens: auto`). */
const AutoExport = () => {
  const settings = useProject((s) => s.settings);
  if (!settings) {
    return null;
  }
  const auto = settings.codeTokens === "auto";
  const toggle = async (on: boolean) => {
    try {
      const problems = await save({
        ...settings,
        codeTokens: on ? "auto" : "manual",
      });
      if (problems.length > 0) {
        toast.error(problems.join(" "));
      }
    } catch (error) {
      reportError(error);
    }
  };
  return (
    <div className="flex items-center gap-2 text-muted-foreground">
      <Switch
        aria-label="Write token changes to the code at once"
        checked={auto}
        onCheckedChange={toggle}
        size="sm"
      />
      Write token changes to the code at once
    </div>
  );
};

export const CodeTokensStep = ({ plan }: { plan: SyncPlan }) => {
  const { comparison, failed, retry } = useComparison(plan, "code");
  const [picks, setPicks] = useState<Picks>({});
  const [busy, setBusy] = useState<"export" | "import" | "both" | null>(null);
  const main = useStepVariant();

  if (!comparison) {
    return <Unread failed={failed} onRetry={retry} />;
  }
  const by = (outcome: TokenDiff["outcome"]) =>
    comparison.diffs.filter((d) => d.outcome === outcome);
  const toCode = by("source-behind");
  const toDesign = by("to-design");
  const conflicts = by("conflict");
  const undecided = conflicts.filter((d) => !picks[keyOf(d)]).length;

  const apply = async (only?: "export" | "import") => {
    setBusy(only ?? "both");
    if (await applyPicks(comparison, conflicts, picks, only)) {
      setPicks({});
    }
    setBusy(null);
  };

  if (toCode.length + toDesign.length + conflicts.length === 0) {
    return (
      <div className="flex flex-col gap-2 font-body-small">
        <p className="flex items-center gap-1.5">
          <Check className="size-3.5 text-success" />
          The code has every value of the design.
        </p>
        <AutoExport />
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
      <List
        diffs={toCode}
        title={`${plural(toCode.length, "token")} to export, the code’s value → the design’s`}
      />
      {toCode.length > 0 ? (
        <Button
          className="self-start"
          disabled={busy !== null}
          onClick={() => apply("export")}
          size="sm"
          variant={main}
        >
          {busy === "export" ? <Spinner /> : null}
          Export {plural(toCode.length, "token")} to the code
        </Button>
      ) : null}
      <List
        diffs={toDesign}
        title={`${plural(toDesign.length, "token")} changed in the code alone`}
      />
      {toDesign.length > 0 ? (
        <Button
          className="self-start"
          disabled={busy !== null}
          onClick={() => apply("import")}
          size="sm"
          variant="outline"
        >
          {busy === "import" ? <Spinner /> : null}
          Take {plural(toDesign.length, "token")} into the design
        </Button>
      ) : null}
      <Conflicts
        baseline={comparison.baseline}
        conflicts={conflicts}
        label="the code"
        onPick={setPicks}
        picks={picks}
        target="the design"
      />
      {conflicts.length > 0 ? (
        <Button
          className="self-start"
          disabled={busy !== null || undecided > 0}
          onClick={() => apply()}
          size="sm"
          variant={toCode.length > 0 ? "outline" : main}
        >
          {busy === "both" ? <Spinner /> : null}
          {undecided > 0 ? `${undecided} left to pick` : "Bring them together"}
        </Button>
      ) : null}
      {toDesign.length + conflicts.length > 0 ? (
        <Button
          className="self-start"
          disabled={busy !== null}
          onClick={() => startTask({ _tag: "Sync", source: "code" })}
          size="sm"
          variant="ghost"
        >
          <Wand2 />
          Settle them with an agent
        </Button>
      ) : null}
      <AutoExport />
    </div>
  );
};
