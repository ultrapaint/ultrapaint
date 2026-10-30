import type { JsonValue } from "@ultrapaint/contracts/base";
import {
  type ComponentMeta,
  metaOf,
  type PropMeta,
  typeText,
} from "@ultrapaint/contracts/catalogue";
import type { InstanceNode } from "@ultrapaint/contracts/document";
import type * as React from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OptionSelect } from "../components/option-select.tsx";
import { Row, Section } from "../components/panel.tsx";
import { useComponents } from "../state/components.ts";
import { useDraft } from "./inspector-fields.tsx";

const NONE: ReadonlySet<string> = new Set();

/** The catalogue's entry for an instance. */
const useComponentMeta = (node: InstanceNode) =>
  useComponents((s) => metaOf(s.catalogue, node));

/**
 * Editable props of an instance. The catalogue says what the component takes and of which
 * types; what the node sets that the catalogue does not know is listed too, as it is.
 * For several instances of one component, `node` holds the props they share and `mixed` names
 * the ones they set differently, which read as mixed until one value is set on all of them.
 */
export const ComponentProps = ({
  node,
  mixed = NONE,
  onSet,
}: {
  node: InstanceNode;
  mixed?: ReadonlySet<string>;
  onSet: (name: string, value: JsonValue) => void;
}) => {
  const meta: ComponentMeta | undefined = useComponentMeta(node);
  const props = node.props ?? {};
  const names = new Set<string>();
  for (const p of meta?.props ?? []) {
    names.add(p.name);
  }
  for (const k of [...Object.keys(props), ...mixed]) {
    names.add(k);
  }
  if (names.size === 0) {
    return null;
  }
  return (
    <Section title="Props">
      {[...names].map((name) => {
        const propMeta = meta?.props.find((p) => p.name === name);
        const value: JsonValue = props[name] ?? null;
        const isSet = name in props || mixed.has(name);
        return (
          <Row className={isSet ? "" : "opacity-70"} key={name} label={name}>
            <PropControl
              meta={propMeta}
              mixed={mixed.has(name)}
              name={name}
              onSet={onSet}
              value={value}
            />
          </Row>
        );
      })}
    </Section>
  );
};

type SetProp = (name: string, value: JsonValue) => void;

/** What a control shows for a prop the instances set differently. */
const MIXED = "Mixed";

/** What a control shows while nothing is set: mixed, or the default the component falls to. */
const placeholderOf = (
  mixed: boolean,
  meta: PropMeta | undefined,
  show: (value: unknown) => string
) => {
  if (mixed) {
    return MIXED;
  }
  return meta?.defaultValue === undefined ? "unset" : show(meta.defaultValue);
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
  mixed,
  onSet,
}: {
  name: string;
  value: JsonValue;
  mixed: boolean;
  onSet: SetProp;
}) => {
  const onCheckedChange = (checked: boolean) =>
    onSet(name, checked ? true : null);
  return (
    <Label className="font-normal text-muted-foreground">
      <Checkbox checked={value === true} onCheckedChange={onCheckedChange} />
      {mixed ? MIXED : booleanLabel(value)}
    </Label>
  );
};

const EnumControl = ({
  name,
  meta,
  value,
  mixed,
  members,
  onSet,
}: {
  name: string;
  meta?: PropMeta;
  value: JsonValue;
  mixed: boolean;
  members: readonly string[];
  onSet: SetProp;
}) => {
  const onChange = (v: string) => onSet(name, v === "__unset" ? null : v);
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      <OptionSelect
        onChange={onChange}
        options={[
          ...members.map((m) => ({ label: m, value: m })),
          { label: "unset (default)", value: "__unset" },
        ]}
        placeholder={placeholderOf(
          mixed,
          meta,
          (d) => `default (${String(d)})`
        )}
        size="sm"
        value={typeof value === "string" ? value : null}
      />
    </div>
  );
};

const NumberControl = ({
  name,
  value,
  mixed,
  onSet,
}: {
  name: string;
  value: JsonValue;
  mixed: boolean;
  onSet: SetProp;
}) => {
  const [draft, setDraft] = useDraft<string>();
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
      className="h-6 font-body"
      onBlur={onBlur}
      onChange={onChange}
      onKeyDown={blurOnEnter}
      placeholder={mixed ? MIXED : undefined}
      type="number"
      value={draft ?? (typeof value === "number" ? String(value) : "")}
    />
  );
};

const TextControl = ({
  name,
  meta,
  value,
  mixed,
  onSet,
}: {
  name: string;
  meta?: PropMeta;
  value: JsonValue;
  mixed: boolean;
  onSet: SetProp;
}) => {
  const [draft, setDraft] = useDraft<string>();
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
      className="h-6 font-body"
      onBlur={onBlur}
      onChange={onChange}
      onKeyDown={onKeyDown}
      placeholder={placeholderOf(mixed, meta, String)}
      value={draft ?? (typeof value === "string" ? value : "")}
    />
  );
};

/** A prop's control, by its type; one the catalogue does not declare shown as it is. */
const PropControl = ({
  name,
  meta,
  value,
  mixed,
  onSet,
}: {
  name: string;
  meta?: PropMeta;
  value: JsonValue;
  mixed: boolean;
  onSet: SetProp;
}) => {
  const kind = meta?.type.kind;
  const members = meta?.type.members;

  if (kind === "boolean") {
    return (
      <BooleanControl mixed={mixed} name={name} onSet={onSet} value={value} />
    );
  }
  if (kind === "enum" && members && members.length > 0) {
    return (
      <EnumControl
        members={members}
        meta={meta}
        mixed={mixed}
        name={name}
        onSet={onSet}
        value={value}
      />
    );
  }
  if (kind === "number") {
    return (
      <NumberControl mixed={mixed} name={name} onSet={onSet} value={value} />
    );
  }
  if (kind !== "string") {
    let shown = value === null ? (kind ?? "") : JSON.stringify(value);
    if (mixed) {
      shown = MIXED;
    }
    return (
      <span
        className="truncate font-code text-muted-foreground"
        title={meta && typeText(meta.type)}
      >
        {shown}
      </span>
    );
  }
  return (
    <TextControl
      meta={meta}
      mixed={mixed}
      name={name}
      onSet={onSet}
      value={value}
    />
  );
};
