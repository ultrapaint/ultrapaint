/**
 * The inspector's Breakpoints section (ADR 0036): which breakpoint an edit lands at, what the node
 * sets at each breakpoint (dimmed when the view shows a smaller one), a reset for each, the widths
 * it is shown at (one rule, chosen from any view) and, in a view above the base, where it sits
 * among its siblings.
 */
import type { DesignNode } from "@ultrapaint/contracts/document";
import {
  type Breakpoint,
  type Visibility,
  visibilityOf,
} from "@ultrapaint/design-document/breakpoints";
import { cn } from "cn";
import { X } from "lucide-react";
import {
  OptionSelect,
  type SelectOption,
} from "../components/option-select.tsx";
import { Row, Section } from "../components/panel.tsx";
import { Segmented } from "../components/segmented.tsx";
import { useEditingBreakpoint } from "../lib/breakpoint-edits.ts";
import { resetAt, showBy } from "../lib/node-actions.ts";
import { useBreakpoints } from "../state/design-system.ts";
import { isNodeFrame, nodeIn, useDocuments } from "../state/documents.ts";
import { useEditor } from "../state/editor.ts";
import { useFrameBreakpoint } from "../state/selection.ts";
import { set } from "./inspector-fields.tsx";

/** What a node sets at a breakpoint, field by field; an instance's props one by one. */
const fieldsAt = (node: DesignNode, name: string): string[] => {
  const over = (
    node.at as Record<string, Record<string, unknown>> | undefined
  )?.[name];
  if (!over) {
    return [];
  }
  return Object.entries(over).flatMap(([key, value]) =>
    key === "props" && value && typeof value === "object"
      ? Object.keys(value).map((prop) => `props.${prop}`)
      : [key]
  );
};

/** What a rule is called in the select, and in the section's sentence. */
const phraseOf = (rule: Visibility): string => {
  switch (rule.kind) {
    case "every":
      return "Every width";
    case "none":
      return "Hidden everywhere";
    case "from":
      return `From ${rule.at} up`;
    case "below":
      return `Below ${rule.at}`;
    default:
      return "Custom";
  }
};

const choiceOf = (rule: Visibility) =>
  rule.kind === "from" || rule.kind === "below"
    ? `${rule.kind}:${rule.at}`
    : rule.kind;

const ruleOf = (value: string): Visibility => {
  const [kind, at] = value.split(":");
  if ((kind === "from" || kind === "below") && at) {
    return { at, kind };
  }
  return kind === "none" ? { kind: "none" } : { kind: "every" };
};

/**
 * The rules a node can be shown by, each with the class the code writes for it: every width,
 * none, and from or below each breakpoint. A rule the select cannot write (an agent's range) is
 * listed as Custom while it holds.
 */
const visibilityOptions = (
  breakpoints: readonly Breakpoint[],
  current: Visibility
): SelectOption[] => [
  { label: "Every width", value: "every" },
  { description: "hidden", label: "Hidden everywhere", value: "none" },
  ...breakpoints.map((b) => ({
    description: `max-${b.name}:hidden`,
    group: "From a breakpoint up",
    label: `From ${b.name} up (${b.min}px)`,
    value: `from:${b.name}`,
  })),
  ...breakpoints.map((b) => ({
    description: `${b.name}:hidden`,
    group: "Below a breakpoint",
    label: `Below ${b.name} (${b.min}px)`,
    value: `below:${b.name}`,
  })),
  ...(current.kind === "custom" ? [{ label: "Custom", value: "custom" }] : []),
];

/** Shows a node by the rule chosen, as one step. */
const showByChoice = (frame: string, node: DesignNode, value: string) => {
  if (value === "custom") {
    return;
  }
  const rule = ruleOf(value) as Exclude<Visibility, { kind: "custom" }>;
  showBy(
    { frame, nodeId: node.id },
    rule,
    `Show at ${phraseOf(rule).toLowerCase()}`
  );
};

const ORDER_OPTIONS = [
  { label: "First", title: "Before its siblings", value: "first" },
  { label: "In place", title: "Where the layers have it", value: "place" },
  { label: "Last", title: "After its siblings", value: "last" },
] as const;

type OrderChoice = (typeof ORDER_OPTIONS)[number]["value"];

const ORDER_VALUE: Record<OrderChoice, number> = {
  first: -1,
  last: 1,
  place: 0,
};

const orderChoice = (order: number | undefined): OrderChoice => {
  if (order === undefined || order === 0) {
    return "place";
  }
  return order < 0 ? "first" : "last";
};

export const BreakpointSection = ({
  frame,
  node,
}: {
  frame: string;
  /** The node as the frame draws it. */
  node: DesignNode;
}) => {
  const canvas = useEditor((s) => s.canvas);
  const own = useDocuments((s) => nodeIn(s.docs, canvas, frame, node.id));
  const breakpoints = useBreakpoints();
  const shown = useFrameBreakpoint(frame);
  const editing = useEditingBreakpoint(frame);
  if (!own || isNodeFrame(frame) || own.type === "page") {
    return null;
  }
  const used = breakpoints.filter((b) => fieldsAt(own, b.name).length > 0);
  const holding = new Set(
    shown === null
      ? []
      : breakpoints
          .slice(0, breakpoints.findIndex((b) => b.name === shown) + 1)
          .map((b) => b.name)
  );
  const visibility = visibilityOf(own, breakpoints);
  // What the eye already says, at every width, is left out of the sentence.
  const said =
    visibility.kind === "every" || visibility.kind === "none"
      ? null
      : `Shown ${phraseOf(visibility).toLowerCase()}.`;
  return (
    <Section title="Breakpoints">
      <p className="font-body text-muted-foreground">
        {editing === null ? (
          "Edits change every width."
        ) : (
          <>
            Edits land at{" "}
            <span className="font-code text-foreground">{editing}</span> and up.
          </>
        )}
        {said ? ` ${said}` : null}
      </p>
      {used.map((b) => (
        <Row key={b.name} label={b.name}>
          <div
            className={cn(
              "flex min-w-0 flex-wrap gap-1",
              !holding.has(b.name) && "opacity-50"
            )}
            title={
              holding.has(b.name)
                ? `Set from ${b.name} (${b.min}px) up`
                : `Set from ${b.name} (${b.min}px) up: not this view's width`
            }
          >
            {fieldsAt(own, b.name).map((field) => (
              <span
                className={cn(
                  "flex items-center gap-0.5 rounded bg-muted py-0.5 pr-0.5 pl-1.5 font-code",
                  b.name === shown && "bg-brand/15 text-foreground"
                )}
                key={field}
              >
                {field}
                <button
                  aria-label={`Reset ${field} at ${b.name}`}
                  className="flex size-4 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-background hover:text-foreground"
                  onClick={() =>
                    resetAt({ frame, nodeId: own.id }, b.name, field)
                  }
                  title={`Reset ${field} at ${b.name}: inherit it from below`}
                  type="button"
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>
        </Row>
      ))}
      <Row label="Shown at">
        <OptionSelect
          onChange={(v) => showByChoice(frame, own, v)}
          options={visibilityOptions(breakpoints, visibility)}
          size="sm"
          value={choiceOf(visibility)}
        />
      </Row>
      {editing === null ? null : (
        <Row label="Order">
          <Segmented
            onChange={(v) => set("order", ORDER_VALUE[v])}
            options={[...ORDER_OPTIONS]}
            value={orderChoice(node.order)}
          />
        </Row>
      )}
    </Section>
  );
};
