import type { JsonValue } from "@ultrapaint/contracts/base";
import type { ComponentMeta, PropMeta } from "@ultrapaint/contracts/catalogue";
import type { InstanceNode } from "@ultrapaint/contracts/document";
import type * as React from "react";
import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OptionSelect } from "../components/option-select.tsx";
import { Row, Section } from "../components/panel.tsx";
import { useCatalogue } from "../state/catalogue.ts";

const HIDDEN = new Set(["children", "className", "key", "ref", "style"]);

/** The catalogue's entry for an instance: the same export from the same module. */
export const useComponentMeta = (node: InstanceNode) =>
  useCatalogue(
    (s) =>
      s.catalogue?.components.find(
        (c) => c.name === node.component && c.importFrom === node.from
      ) ?? s.catalogue?.components.find((c) => c.name === node.component)
  );

/**
 * Editable props of an instance of the design system. The catalogue says what the component
 * takes and of which types; what the node sets that the catalogue does not know is listed too.
 */
export const ComponentProps = ({
  node,
  onSet,
}: {
  node: InstanceNode;
  onSet: (name: string, value: JsonValue) => void;
}) => {
  const meta: ComponentMeta | undefined = useComponentMeta(node);
  const props = node.props ?? {};
  const names = new Set<string>();
  for (const p of meta?.props ?? []) {
    names.add(p.name);
  }
  for (const k of Object.keys(props)) {
    names.add(k);
  }
  const list = Array.from(names).filter(
    (n) => !(HIDDEN.has(n) || n.startsWith("on")) && n !== "..."
  );
  if (list.length === 0) {
    return null;
  }
  const disabled = false;

  return (
    <Section title="Props">
      {list.map((name) => {
        const propMeta = meta?.props.find((p) => p.name === name);
        const value: JsonValue = props[name] ?? null;
        const isSet = name in props;
        return (
          <Row className={isSet ? "" : "opacity-70"} key={name} label={name}>
            <PropControl
              disabled={disabled}
              meta={propMeta}
              name={name}
              onSet={onSet}
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
  onSet,
  disabled,
  variants,
}: {
  name: string;
  meta?: PropMeta;
  value: JsonValue;
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
  if (kind === "node" || kind === "function" || kind === "object") {
    return (
      <span
        className="truncate font-mono text-[10px] text-muted-foreground"
        title={meta?.type.raw}
      >
        {value === null ? (meta?.type.raw ?? kind) : JSON.stringify(value)}
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
