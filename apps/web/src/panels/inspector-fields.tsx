/** The inspector's own fields, and how a change reaches every node it inspects. */
import type { JsonValue } from "@ultrapaint/contracts/base";
import type { DesignNode, InstanceNode } from "@ultrapaint/contracts/document";
import { Minus, Plus, TriangleAlert } from "lucide-react";
import { createContext, type ReactNode, useContext, useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/cn";
import { IconButton } from "../components/icon-button.tsx";
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

/**
 * A section of the inspector: its title, an action at the right (add or remove what it holds)
 * and its rows. A section with nothing set is its title and the action that adds it.
 */
export const Section = ({
  action,
  children,
  className,
  title,
}: {
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
  title: ReactNode;
}) => (
  <section
    className={cn(
      "flex flex-col gap-1 border-b px-3 py-2 last:border-b-0",
      className
    )}
  >
    <div className="flex h-7 items-center justify-between gap-2">
      <h3 className="min-w-0 truncate font-heading-xsmall">{title}</h3>
      {action ? (
        <div className="-mr-1 flex shrink-0 items-center gap-0.5">{action}</div>
      ) : null}
    </div>
    {children}
  </section>
);

/**
 * A row of a section: its label in a column of its own, muted, and its controls; two fields share
 * the row half and half. A row without a label lines its controls up under the ones above.
 */
export const Row = ({
  children,
  className,
  label,
}: {
  children: ReactNode;
  className?: string;
  label?: string;
}) => (
  <div
    className={cn(
      "grid min-h-7 grid-cols-[72px_minmax(0,1fr)] items-center gap-x-2",
      className
    )}
  >
    <span
      className="truncate font-body-small text-muted-foreground"
      title={label}
    >
      {label}
    </span>
    <div className="flex min-w-0 items-center gap-2">{children}</div>
  </div>
);

/** A section's action: a quiet icon, named by its tooltip. */
export const SectionAction = ({
  children,
  onClick,
  tooltip,
}: {
  children: ReactNode;
  onClick: () => void;
  tooltip: string;
}) => (
  <IconButton
    className="text-muted-foreground"
    onClick={onClick}
    size="icon-sm"
    tooltip={tooltip}
  >
    {children}
  </IconButton>
);

/** The + of a section with nothing set, or the − that takes what it holds off. */
export const AddOrRemove = ({
  name,
  onAdd,
  onRemove,
  present,
}: {
  /** What the section holds, in the tooltips: "fill", "border". */
  name: string;
  onAdd: () => void;
  onRemove: () => void;
  /** Whether the nodes have it, or its + was pressed. */
  present: boolean;
}) =>
  present ? (
    <SectionAction onClick={onRemove} tooltip={`Remove ${name}`}>
      <Minus />
    </SectionAction>
  ) : (
    <SectionAction onClick={onAdd} tooltip={`Add ${name}`}>
      <Plus />
    </SectionAction>
  );

/**
 * Whether a section shows the rows of something not set yet, its + pressed: until the inspector
 * shows other nodes.
 */
export const useReveal = (): readonly [boolean, (shown: boolean) => void] => {
  const [shown, setShown] = useDraft<boolean>();
  return [shown === true, (next) => setShown(next ? true : null)] as const;
};

/**
 * What a panel shows while it has nothing to show: a muted icon, what is missing, one sentence on
 * what will be here and how to fill it, and the one action that does.
 */
export const EmptyState = ({
  action,
  children,
  icon,
  title,
}: {
  action?: ReactNode;
  children: ReactNode;
  icon: ReactNode;
  title: string;
}) => (
  <div className="flex h-full min-h-48 flex-col items-center justify-center gap-3 px-6 py-8 text-center">
    <div className="flex flex-col items-center gap-1">
      <span className="mb-1 text-muted-foreground [&_svg]:size-5">{icon}</span>
      <p className="font-body font-medium">{title}</p>
      <p className="max-w-60 text-balance font-body-small text-muted-foreground">
        {children}
      </p>
    </div>
    {action}
  </div>
);

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
      className="min-h-16 resize-none font-body"
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
      className="font-body"
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
  <p className="flex gap-1.5 font-body-small text-muted-foreground [&_svg]:mt-0.5 [&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:text-warning">
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
  autoOpen,
  field,
  leading,
  nodes,
  placeholder,
}: {
  accept?: (query: string) => boolean;
  autoOpen?: boolean;
  field: TokenValueField;
  leading?: ReactNode;
  nodes: readonly DesignNode[];
  placeholder?: string;
}) => {
  const options = useTokenOptions(field.options);
  return (
    <ValueField
      accept={accept}
      autoOpen={autoOpen}
      leading={leading}
      onChange={(v) => setField(field, v)}
      options={options}
      {...shownAs(sharedField(field, nodes), placeholder)}
    />
  );
};

export const ColorField = ({
  autoOpen,
  field,
  nodes,
  placeholder,
}: {
  autoOpen?: boolean;
  field: TokenValueField;
  nodes: readonly DesignNode[];
  placeholder?: string;
}) => {
  const shared = sharedField(field, nodes);
  const color = useColorOf(shared === MIXED ? undefined : shared);
  return (
    <NodeValueField
      accept={(q) => CSS.supports("color", q)}
      autoOpen={autoOpen}
      field={field}
      leading={<Swatch color={color} />}
      nodes={nodes}
      placeholder={placeholder ?? "None"}
    />
  );
};
