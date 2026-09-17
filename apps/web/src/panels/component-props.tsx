import type { JsonValue } from "@ultrapaint/contracts/base";
import type { ComponentMeta, PropMeta } from "@ultrapaint/contracts/catalogue";
import type { ElementSource } from "@ultrapaint/contracts/edit";
import type { InspectResult } from "@ultrapaint/contracts/preview";
import type * as React from "react";
import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OptionSelect } from "../components/option-select.tsx";
import { Row, Section } from "../components/panel.tsx";
import { useCatalogue } from "../state/catalogue.ts";

const HIDDEN = new Set([
  "children",
  "className",
  "key",
  "ref",
  "data-ed",
  "style",
]);

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
    (c) => c.name === inspect.name
  );
  const sourceAttrs = new Map(
    (source?.attributes ?? []).map((a) => [a.name, a])
  );
  const names = new Set<string>();
  for (const p of meta?.props ?? []) {
    names.add(p.name);
  }
  for (const [k] of sourceAttrs) {
    names.add(k);
  }
  for (const k of Object.keys(inspect.props)) {
    names.add(k);
  }
  const list = Array.from(names).filter(
    (n) => !(HIDDEN.has(n) || n.startsWith("on")) && n !== "..."
  );
  if (list.length === 0) {
    return null;
  }

  return (
    <Section title={`${inspect.name} props`}>
      {list.map((name) => {
        const propMeta = meta?.props.find((p) => p.name === name);
        const attr = sourceAttrs.get(name);
        const runtime = inspect.props[name];
        const value: JsonValue = attr
          ? attr.value
          : ((runtime as JsonValue) ?? null);
        const isSet = !!attr;
        return (
          <Row className={isSet ? "" : "opacity-70"} key={name} label={name}>
            <PropControl
              disabled={disabled}
              meta={propMeta}
              name={name}
              onSet={onSet}
              raw={attr?.raw}
              value={value}
              variants={meta?.variants[name]}
            />
          </Row>
        );
      })}
    </Section>
  );
};

type SetProp = (name: string, value: JsonValue) => void;

const inferKind = (value: JsonValue, variants?: readonly string[]) => {
  if (typeof value === "boolean") {
    return "boolean";
  }
  if (typeof value === "number") {
    return "number";
  }
  return variants ? "enum" : "string";
};

const booleanLabel = (value: JsonValue) => {
  if (value === true) {
    return "true";
  }
  return value === false ? "false" : "unset";
};

const blurOnEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
  if (e.key === "Enter") {
    (e.target as HTMLInputElement).blur();
  }
};

const BooleanControl = ({
  name,
  value,
  onSet,
  disabled,
}: {
  name: string;
  value: JsonValue;
  onSet: SetProp;
  disabled: boolean;
}) => {
  const onCheckedChange = (checked: boolean) =>
    onSet(name, checked ? true : null);
  return (
    <Label className="font-normal text-muted-foreground">
      <Checkbox
        checked={value === true}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
      />
      {booleanLabel(value)}
    </Label>
  );
};

const EnumControl = ({
  name,
  meta,
  value,
  members,
  onSet,
  disabled,
}: {
  name: string;
  meta?: PropMeta;
  value: JsonValue;
  members: readonly string[];
  onSet: SetProp;
  disabled: boolean;
}) => {
  const onChange = (v: string) => onSet(name, v === "__unset" ? null : v);
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      <OptionSelect
        disabled={disabled}
        onChange={onChange}
        options={[
          ...members.map((m) => ({ label: m, value: m })),
          { label: "unset (default)", value: "__unset" },
        ]}
        placeholder={
          meta?.defaultValue === undefined
            ? "unset"
            : `default (${String(meta.defaultValue)})`
        }
        size="sm"
        value={typeof value === "string" ? value : null}
      />
    </div>
  );
};

const NumberControl = ({
  name,
  value,
  onSet,
  disabled,
}: {
  name: string;
  value: JsonValue;
  onSet: SetProp;
  disabled: boolean;
}) => {
  const [draft, setDraft] = useState<string | null>(null);
  const onBlur = () => {
    if (draft === null) {
      return;
    }
    const n = Number(draft);
    setDraft(null);
    if (draft === "") {
      onSet(name, null);
    } else if (Number.isFinite(n)) {
      onSet(name, n);
    }
  };
  const onChange = (e: React.ChangeEvent<HTMLInputElement>) =>
    setDraft(e.target.value);
  return (
    <Input
      className="h-6 md:text-[11px]"
      disabled={disabled}
      onBlur={onBlur}
      onChange={onChange}
      onKeyDown={blurOnEnter}
      type="number"
      value={draft ?? (typeof value === "number" ? String(value) : "")}
    />
  );
};

const TextControl = ({
  name,
  meta,
  value,
  onSet,
  disabled,
}: {
  name: string;
  meta?: PropMeta;
  value: JsonValue;
  onSet: SetProp;
  disabled: boolean;
}) => {
  const [draft, setDraft] = useState<string | null>(null);
  const onBlur = () => {
    if (draft === null) {
      return;
    }
    setDraft(null);
    onSet(name, draft === "" ? null : draft);
  };
  const onChange = (e: React.ChangeEvent<HTMLInputElement>) =>
    setDraft(e.target.value);
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      (e.target as HTMLInputElement).blur();
    }
    if (e.key === "Escape") {
      setDraft(null);
    }
  };
  return (
    <Input
      className="h-6 md:text-[11px]"
      disabled={disabled}
      onBlur={onBlur}
      onChange={onChange}
      onKeyDown={onKeyDown}
      placeholder={
        meta?.defaultValue === undefined ? "unset" : String(meta.defaultValue)
      }
      value={draft ?? (typeof value === "string" ? value : "")}
    />
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
  onSet: SetProp;
  disabled: boolean;
  variants?: readonly string[];
}) => {
  const kind = meta?.type.kind ?? inferKind(value, variants);
  const members = variants ?? meta?.type.members;

  if (kind === "boolean") {
    return (
      <BooleanControl
        disabled={disabled}
        name={name}
        onSet={onSet}
        value={value}
      />
    );
  }
  if (kind === "enum" && members && members.length > 0) {
    return (
      <EnumControl
        disabled={disabled}
        members={members}
        meta={meta}
        name={name}
        onSet={onSet}
        value={value}
      />
    );
  }
  if (kind === "number") {
    return (
      <NumberControl
        disabled={disabled}
        name={name}
        onSet={onSet}
        value={value}
      />
    );
  }
  if (
    kind === "node" ||
    kind === "function" ||
    kind === "object" ||
    (raw && value === null)
  ) {
    return (
      <span
        className="truncate font-mono text-[10px] text-muted-foreground"
        title={raw}
      >
        {raw ?? (kind === "node" ? "<node>" : "ƒ")}
      </span>
    );
  }
  return (
    <TextControl
      disabled={disabled}
      meta={meta}
      name={name}
      onSet={onSet}
      value={value}
    />
  );
};
