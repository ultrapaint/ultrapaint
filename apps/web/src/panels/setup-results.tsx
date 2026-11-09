/**
 * What the steps of the design-system setup found and decided, as the Setup view shows them under
 * each step: the inventory and the audits (how much of each kind is the system's, the values most
 * used off it), Map's mapping with a choice per value, and Migrate's batches.
 */
import {
  defaultsOf,
  type MappingEntry,
  type MigrationBatch,
  USAGE_KINDS,
  type UsageInventory,
  type UsageKind,
  type UsageValue,
} from "@ultrapaint/contracts/design-system-setup";
import { tokenValues } from "@ultrapaint/design-document/tokens";
import { ChevronDown, RotateCcw } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/cn";
import { Segmented } from "../components/segmented.tsx";
import { mapTargetsOf } from "../lib/map-targets.ts";
import { useDesignSystem } from "../state/design-system.ts";
import { useDesignSystemSetup } from "../state/design-system-setup.ts";

/** Values listed before "Show all". */
const FIRST_VALUES = 12;
/** Mapping entries listed before "Show all". */
const FIRST_ENTRIES = 30;
const KEEP = "__keep";
/** The style system's own colours a design system may leave out, drawn all the same. */
const BASICS: Record<string, string> = {
  "color-black": "#000000",
  "color-white": "#ffffff",
};
const KIND_LABELS = Object.fromEntries(
  USAGE_KINDS.map(({ kind, label }) => [kind, label])
) as Record<UsageKind, string>;

const Bar = ({
  totals,
}: {
  totals: { default: number; raw: number; system: number };
}) => {
  const all = totals.system + totals.default + totals.raw;
  if (all === 0) {
    return null;
  }
  const width = (n: number) => `${(n / all) * 100}%`;
  return (
    <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <span className="bg-foreground" style={{ width: width(totals.system) }} />
      <span
        className="bg-muted-foreground/40"
        style={{ width: width(totals.default) }}
      />
      <span className="bg-warning" style={{ width: width(totals.raw) }} />
    </div>
  );
};

/**
 * A colour's swatch: a value written out is itself, a token is drawn with the value the design
 * system records, since the editor does not have the project's stylesheet.
 */
const Swatch = ({ kind, value }: { kind: UsageKind; value: string }) => {
  const designSystem = useDesignSystem((s) => s.designSystem);
  if (kind !== "color") {
    return null;
  }
  const background = value.startsWith("color-")
    ? (tokenValues(designSystem).get(value) ?? BASICS[value])
    : value;
  return background ? (
    <span
      className="size-3 shrink-0 rounded-sm border"
      style={{ background }}
    />
  ) : (
    <span className="size-3 shrink-0 rounded-sm border border-dashed" />
  );
};

const capitalised = (text: string) =>
  text.charAt(0).toUpperCase() + text.slice(1);

/** What a value off the system is, after how it is written. */
const noteOf = (value: UsageValue) => {
  if (!value.token) {
    return "";
  }
  return ` · is ${value.token}`;
};

const ValueRow = ({
  defaults,
  value,
}: {
  /** Whose the values of status `default` are: `Tailwind's`. */
  defaults: string;
  value: UsageValue;
}) => {
  const [where] = value.locations;
  return (
    <li
      className="flex flex-col gap-0.5 py-1"
      title={value.locations.map((l) => `${l.file}:${l.line}`).join("\n")}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <Swatch kind={value.kind} value={value.value} />
        <span className="truncate font-code">{value.value}</span>
        <span className="ml-auto shrink-0 font-body-small text-muted-foreground">
          {value.count}×
        </span>
      </span>
      <span className="truncate font-body-small text-muted-foreground">
        {value.status === "raw" ? "Written out" : capitalised(defaults)}
        {noteOf(value)}
        {where ? ` · ${where.file}:${where.line}` : ""}
      </span>
    </li>
  );
};

const ShowAll = ({
  all,
  count,
  first,
  onToggle,
}: {
  all: boolean;
  count: number;
  first: number;
  onToggle: () => void;
}) =>
  count > first ? (
    <Button className="self-start" onClick={onToggle} size="sm" variant="ghost">
      <ChevronDown className={cn(all && "rotate-180")} />
      {all ? "Show fewer" : `Show all ${count}`}
    </Button>
  ) : null;

export const InventoryResult = ({
  inventory,
}: {
  inventory: UsageInventory;
}) => {
  const [all, setAll] = useState(false);
  const off = inventory.values.filter((v) => v.status !== "system");
  const listed = all ? off : off.slice(0, FIRST_VALUES);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1.5">
        {USAGE_KINDS.map(({ kind, label }) => {
          const totals = inventory.totals.find((t) => t.kind === kind);
          if (!totals || totals.system + totals.default + totals.raw === 0) {
            return null;
          }
          return (
            <div className="flex flex-col gap-0.5" key={kind}>
              <span className="flex items-baseline justify-between font-body-small">
                <span>{label}</span>
                <span className="text-muted-foreground">
                  {`${totals.system} · ${totals.default} · ${totals.raw}`}
                </span>
              </span>
              <Bar totals={totals} />
            </div>
          );
        })}
        <span className="flex items-center gap-3 font-body-small text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="size-2 rounded-full bg-foreground" />
            The system's
          </span>
          <span className="flex items-center gap-1">
            <span className="size-2 rounded-full bg-muted-foreground/40" />
            {capitalised(defaultsOf(inventory))}
          </span>
          <span className="flex items-center gap-1">
            <span className="size-2 rounded-full bg-warning" />
            Written out
          </span>
        </span>
      </div>
      {off.length > 0 ? (
        <div className="flex flex-col">
          <span className="font-body font-medium">
            Most used off the system
          </span>
          <ul className="flex flex-col divide-y">
            {listed.map((v) => (
              <ValueRow
                defaults={defaultsOf(inventory)}
                key={`${v.kind}|${v.status}|${v.value}`}
                value={v}
              />
            ))}
          </ul>
          <ShowAll
            all={all}
            count={off.length}
            first={FIRST_VALUES}
            onToggle={() => setAll(!all)}
          />
        </div>
      ) : null}
    </div>
  );
};

const BY: Record<NonNullable<MappingEntry["by"]>, string> = {
  agent: "agent",
  rule: "rule",
  user: "you",
};

const choiceOf = (entry: MappingEntry) => {
  if (entry.keep) {
    return KEEP;
  }
  return entry.target ?? "";
};

const MappingRow = ({
  entry,
  targets,
}: {
  entry: MappingEntry;
  targets: readonly string[];
}) => {
  const options =
    entry.target && !targets.includes(entry.target)
      ? [entry.target, ...targets]
      : targets;
  const decide = (choice: string) =>
    useDesignSystemSetup.getState().setMapping({
      kind: entry.kind,
      value: entry.value,
      ...(choice === KEEP && { keep: true }),
      ...(choice !== KEEP && choice !== "" && { target: choice }),
    });
  return (
    <li
      className="flex flex-col gap-1 py-1.5"
      title={[entry.example, entry.note].filter(Boolean).join("\n")}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <Swatch kind={entry.kind} value={entry.value} />
        <span className="truncate font-code">{entry.value}</span>
        <span className="ml-auto shrink-0 font-body-small text-muted-foreground">
          {entry.count}×{entry.by ? ` · ${BY[entry.by]}` : ""}
        </span>
      </span>
      <span className="truncate font-body-small text-muted-foreground">
        {KIND_LABELS[entry.kind]}
        {entry.example && entry.example !== entry.value
          ? ` · ${entry.example}`
          : ""}
        {entry.where ? ` · ${entry.where}` : ""}
      </span>
      <span className="flex min-w-0 items-center gap-1.5">
        <Swatch kind={entry.kind} value={entry.target ?? ""} />
        <NativeSelect
          aria-label={`What ${entry.value} becomes`}
          className="min-w-0 flex-1"
          onChange={(e) => decide(e.target.value)}
          size="sm"
          value={choiceOf(entry)}
        >
          <NativeSelectOption value="">Undecided</NativeSelectOption>
          <NativeSelectOption value={KEEP}>Keep as it is</NativeSelectOption>
          {options.map((t) => (
            <NativeSelectOption key={t} value={t}>
              {t}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </span>
    </li>
  );
};

/** Map's mapping: what each value off the system becomes, which the user can change. */
export const MappingView = () => {
  const mapping = useDesignSystemSetup((s) => s.mapping);
  const designSystem = useDesignSystem((s) => s.designSystem);
  const [filter, setFilter] = useState<"open" | "all">("open");
  const [all, setAll] = useState(false);
  if (!mapping) {
    return null;
  }
  const open = mapping.entries.filter((e) => e.target === undefined && !e.keep);
  const shown = filter === "open" ? open : mapping.entries;
  const listed = all ? shown : shown.slice(0, FIRST_ENTRIES);
  const decided = mapping.entries.filter((e) => e.target !== undefined).length;
  const kept = mapping.entries.filter((e) => e.keep).length;
  return (
    <div className="flex flex-col gap-2">
      <span className="font-body-small text-muted-foreground">
        {decided} decided · {kept} kept · {open.length} undecided
      </span>
      <Segmented
        onChange={setFilter}
        options={[
          { label: `Undecided (${open.length})`, value: "open" },
          { label: `All (${mapping.entries.length})`, value: "all" },
        ]}
        value={filter}
      />
      <ul className="flex flex-col divide-y">
        {listed.map((entry) => (
          <MappingRow
            entry={entry}
            key={`${entry.kind}|${entry.value}`}
            targets={mapTargetsOf(entry.kind, designSystem)}
          />
        ))}
      </ul>
      {shown.length === 0 ? (
        <span className="font-body-small text-muted-foreground">
          Every value is decided.
        </span>
      ) : null}
      <ShowAll
        all={all}
        count={shown.length}
        first={FIRST_ENTRIES}
        onToggle={() => setAll(!all)}
      />
    </div>
  );
};

const BATCH_STATUS: Record<MigrationBatch["status"], string> = {
  active: "Under way",
  done: "Done",
  todo: "To do",
};

const BatchRow = ({ batch }: { batch: MigrationBatch }) => {
  const busy = useDesignSystemSetup((s) => s.busy === batch.id);
  return (
    <li className="flex flex-col gap-1 py-1.5" title={batch.files.join("\n")}>
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="truncate font-code">{batch.dir}</span>
        <span className="shrink-0 font-body-small text-muted-foreground">
          {batch.files.length} {batch.files.length === 1 ? "file" : "files"}
        </span>
        <Badge
          className="ml-auto"
          variant={batch.status === "done" ? "secondary" : "outline"}
        >
          {batch.status === "active" ? <Spinner /> : null}
          {BATCH_STATUS[batch.status]}
        </Badge>
      </span>
      {batch.summary || batch.changes !== undefined ? (
        <span className="font-body-small text-muted-foreground">
          {batch.changes === undefined ? "" : `${batch.changes} by the rules. `}
          {batch.summary}
        </span>
      ) : null}
      {batch.status === "todo" ? null : (
        <Button
          className="self-start"
          disabled={busy}
          onClick={() => useDesignSystemSetup.getState().revertBatch(batch.id)}
          size="sm"
          variant="ghost"
        >
          {busy ? <Spinner /> : <RotateCcw />}
          Revert
        </Button>
      )}
    </li>
  );
};

/** Migrate's batches, each with what was done to it and a way to undo it. */
export const BatchList = ({
  batches,
}: {
  batches: readonly MigrationBatch[];
}) => {
  if (batches.length === 0) {
    return null;
  }
  const done = batches.filter((b) => b.status === "done").length;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-col gap-0.5">
        <span className="font-body-small text-muted-foreground">
          {done} of {batches.length} batches done
        </span>
        <Bar
          totals={{ default: batches.length - done, raw: 0, system: done }}
        />
      </div>
      <ul className="flex flex-col divide-y">
        {batches.map((batch) => (
          <BatchRow batch={batch} key={batch.id} />
        ))}
      </ul>
    </div>
  );
};
