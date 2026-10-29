/** The inspector's own fields, and how a change reaches every node it inspects. */
import type { JsonValue } from "@ultrapaint/contracts/base";
import type { DesignNode, InstanceNode } from "@ultrapaint/contracts/document";
import { TriangleAlert } from "lucide-react";
import { createContext, type ReactNode, useContext, useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ValueField } from "../components/value-field.tsx";
import {
  setField,
  updateSelection,
  updateSelectionWith,
} from "../lib/node-actions.ts";
import { sharedField, type TokenValueField } from "../lib/node-fields.ts";
import {
  MIXED,
  type Shared,
  sharedValue,
  shownAs,
} from "../lib/shared-value.ts";
import {
  type FieldTokenKind,
  Swatch,
  useColorOf,
  useTokenOptions,
} from "../lib/token-options.tsx";

type SetField = (field: string, value: JsonValue) => void;

/**
 * What the inspector shows, as a key: its frame and its nodes. The inspector stays mounted from
 * one selection to the next, its fields updated in place; a draft is the key's it was typed for.
 */
export const InspectedKey = createContext("");

/**
 * A field's draft while it is typed, dropped once the inspector shows other nodes: a change
 * typed and left is committed on blur, which comes before the selection changes.
 */
export const useDraft = <T,>(): readonly [
  T | null,
  (draft: T | null) => void,
] => {
  const key = useContext(InspectedKey);
  const [draft, setDraft] = useState<{
    readonly key: string;
    readonly value: T;
  } | null>(null);
  return [
    draft?.key === key ? draft.value : null,
    (value) => setDraft(value === null ? null : { key, value }),
  ] as const;
};

/** Sets a field of every node inspected. */
export const set: SetField = (field, value) =>
  updateSelection({ [field]: value }, `Change ${field}`);

/** Sets fields of every node inspected, worked out from each: the rest of its border, its sides. */
export const setEach = (
  label: string,
  setOf: (node: DesignNode) => Record<string, JsonValue>
) => updateSelectionWith(setOf, label);

/** What the nodes have in a field: the value they share, or `MIXED`. */
export const sharedOf = <N extends DesignNode, T extends JsonValue>(
  nodes: readonly N[],
  read: (node: N) => T | undefined
): Shared<T> => sharedValue(nodes.map(read));

/** A choice's value for a segmented control or a select: none pressed when the nodes differ. */
export const nullIfMixed = <T extends JsonValue>(
  shared: Shared<T>
): T | null => (shared === MIXED || shared === undefined ? null : shared);

/** Whether every node is of one type, so that the fields of the type fit them all. */
export const allOf = <T extends DesignNode["type"]>(
  nodes: readonly DesignNode[],
  type: T
): nodes is readonly Extract<DesignNode, { type: T }>[] =>
  nodes.every((n) => n.type === type);

export type Stack = Extract<
  DesignNode,
  { type: "page" | "row" | "column" | "group" }
>;

const isStack = (node: DesignNode): node is Stack =>
  node.type === "page" ||
  node.type === "row" ||
  node.type === "column" ||
  node.type === "group";

export const allStacks = (
  nodes: readonly DesignNode[]
): nodes is readonly Stack[] => nodes.every(isStack);

/** Instances of one component, whose props are the same props. */
export const oneComponent = (
  nodes: readonly DesignNode[]
): nodes is readonly InstanceNode[] => {
  const [first] = nodes;
  return (
    first?.type === "instance" &&
    nodes.every(
      (n) =>
        n.type === "instance" &&
        n.component === first.component &&
        n.from === first.from
    )
  );
};

export const TextInput = ({
  value,
  onChange,
  placeholder,
  multiline = false,
}: {
  value: string | undefined;
  onChange: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
}) => {
  const [draft, setDraft] = useDraft<string>();
  const commit = () => {
    if (draft !== null && draft !== (value ?? "")) {
      onChange(draft);
    }
    setDraft(null);
  };
  const common = {
    onBlur: commit,
    placeholder,
    value: draft ?? value ?? "",
  };
  return multiline ? (
    <Textarea
      {...common}
      className="min-h-16 font-body"
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          (e.target as HTMLTextAreaElement).blur();
        }
      }}
    />
  ) : (
    <Input
      {...common}
      className="h-6 font-body"
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
};

/** A line under a section's fields about why what they say is not what is drawn. */
export const Warning = ({ children }: { children: ReactNode }) => (
  <p className="flex gap-1.5 font-body text-warning [&_svg]:mt-px [&_svg]:size-3 [&_svg]:shrink-0">
    <TriangleAlert />
    <span>{children}</span>
  </p>
);

export const TokenField = ({
  field,
  kind,
  value,
  placeholder,
  numeric = true,
  onChange,
  className,
  title,
}: {
  field: string;
  kind: FieldTokenKind;
  value: JsonValue | undefined;
  placeholder?: string;
  numeric?: boolean;
  /** Instead of setting the field on the node directly. */
  onChange?: (value: JsonValue) => void;
  className?: string;
  title?: string;
}) => {
  const options = useTokenOptions(kind);
  return (
    <ValueField
      accept={(q) => !numeric || CSS.supports("width", q)}
      className={className}
      onChange={(v) => (onChange ? onChange(v) : set(field, v))}
      options={options}
      placeholder={placeholder ?? "Default"}
      title={title}
      value={value}
    />
  );
};

/** A field of the table both the inspector and the toolbar edit, as the inspector draws it. */
export const NodeValueField = ({
  accept,
  field,
  leading,
  nodes,
  placeholder,
}: {
  accept?: (query: string) => boolean;
  field: TokenValueField;
  leading?: ReactNode;
  nodes: readonly DesignNode[];
  placeholder?: string;
}) => {
  const options = useTokenOptions(field.options);
  return (
    <ValueField
      accept={accept}
      leading={leading}
      onChange={(v) => setField(field, v)}
      options={options}
      {...shownAs(sharedField(field, nodes), placeholder)}
    />
  );
};

export const ColorField = ({
  field,
  nodes,
  placeholder,
}: {
  field: TokenValueField;
  nodes: readonly DesignNode[];
  placeholder?: string;
}) => {
  const shared = sharedField(field, nodes);
  const color = useColorOf(shared === MIXED ? undefined : shared);
  return (
    <NodeValueField
      accept={(q) => CSS.supports("color", q)}
      field={field}
      leading={<Swatch color={color} />}
      nodes={nodes}
      placeholder={placeholder ?? "None"}
    />
  );
};
