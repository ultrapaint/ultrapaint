import type {
  ComponentMeta,
  ElementSource,
  InspectResult,
  JsonValue,
  PropMeta,
} from "@ultrapaint/contracts";
import * as React from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OptionSelect } from "../components/option-select.tsx";
import { Row, Section } from "../components/panel.tsx";
import { useCatalogue } from "../state/catalogue.ts";

const HIDDEN = new Set(["children", "className", "key", "ref", "data-ed", "style"]);

/**
 * Editable props for a design-system component instance. Uses the catalogue for types when
 * available and falls back to the literal kinds found in the source.
 */
export const ComponentProps = ({
  inspect,
  source,
  onSet,
  disabled,
}: {
  inspect: InspectResult;
  source: ElementSource | null;
  onSet: (name: string, value: JsonValue) => void;
  disabled: boolean;
}) => {
  const catalogue = useCatalogue((s) => s.catalogue);
  const meta: ComponentMeta | undefined = catalogue?.components.find(
    (c) => c.name === inspect.name,
  );
  const sourceAttrs = new Map((source?.attributes ?? []).map((a) => [a.name, a]));
  const names = new Set<string>();
  for (const p of meta?.props ?? []) names.add(p.name);
  for (const [k] of sourceAttrs) names.add(k);
  for (const k of Object.keys(inspect.props)) names.add(k);
  const list = Array.from(names).filter(
    (n) => !HIDDEN.has(n) && !n.startsWith("on") && n !== "...",
  );
  if (list.length === 0) return null;

  return (
    <Section title={`${inspect.name} props`}>
      {list.map((name) => {
        const propMeta = meta?.props.find((p) => p.name === name);
        const attr = sourceAttrs.get(name);
        const runtime = inspect.props[name];
        const value: JsonValue = attr ? attr.value : ((runtime as JsonValue) ?? null);
        const isSet = !!attr;
        return (
          <Row key={name} label={name} className={isSet ? "" : "opacity-70"}>
            <PropControl
              name={name}
              meta={propMeta}
              value={value}
              raw={attr?.raw}
              onSet={onSet}
              disabled={disabled}
              variants={meta?.variants[name]}
            />
          </Row>
        );
      })}
    </Section>
  );
};

const PropControl = ({
  name,
  meta,
  value,
  raw,
  onSet,
  disabled,
  variants,
}: {
  name: string;
  meta?: PropMeta;
  value: JsonValue;
  raw?: string;
  onSet: (name: string, value: JsonValue) => void;
  disabled: boolean;
  variants?: readonly string[];
}) => {
  const [draft, setDraft] = React.useState<string | null>(null);
  const kind =
    meta?.type.kind ??
    (typeof value === "boolean"
      ? "boolean"
      : typeof value === "number"
        ? "number"
        : variants
          ? "enum"
          : "string");
  const members = variants ?? meta?.type.members;

  if (kind === "boolean") {
    return (
      <Label className="font-normal text-muted-foreground">
        <Checkbox
          disabled={disabled}
          checked={value === true}
          onCheckedChange={(checked) => onSet(name, checked ? true : null)}
        />
        {value === true ? "true" : value === false ? "false" : "unset"}
      </Label>
    );
  }
  if (kind === "enum" && members && members.length > 0) {
    return (
      <div className="flex min-w-0 flex-1 items-center gap-1">
        <OptionSelect
          disabled={disabled}
          size="sm"
          value={typeof value === "string" ? value : null}
          placeholder={
            meta?.defaultValue !== undefined ? `default (${String(meta.defaultValue)})` : "unset"
          }
          options={[
            ...members.map((m) => ({ value: m, label: m })),
            { value: "__unset", label: "unset (default)" },
          ]}
          onChange={(v) => onSet(name, v === "__unset" ? null : v)}
        />
      </div>
    );
  }
  if (kind === "number") {
    return (
      <Input
        className="h-6 md:text-[11px]"
        type="number"
        disabled={disabled}
        value={draft ?? (typeof value === "number" ? String(value) : "")}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft === null) return;
          const n = Number(draft);
          setDraft(null);
          if (draft === "") onSet(name, null);
          else if (Number.isFinite(n)) onSet(name, n);
        }}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
    );
  }
  if (kind === "node" || kind === "function" || kind === "object" || (raw && value === null)) {
    return (
      <span className="truncate font-mono text-[10px] text-muted-foreground" title={raw}>
        {raw ?? (kind === "node" ? "<node>" : "ƒ")}
      </span>
    );
  }
  return (
    <Input
      className="h-6 md:text-[11px]"
      disabled={disabled}
      placeholder={meta?.defaultValue !== undefined ? String(meta.defaultValue) : "unset"}
      value={draft ?? (typeof value === "string" ? value : "")}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft === null) return;
        setDraft(null);
        onSet(name, draft === "" ? null : draft);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setDraft(null);
      }}
    />
  );
};
