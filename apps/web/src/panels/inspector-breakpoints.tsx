/**
 * The inspector's Breakpoints section (ADR 0036): which breakpoint an edit lands at, what the node
 * sets at each breakpoint (dimmed when the view shows a smaller one), a reset for each, and what
 * only a breakpoint decides: where the node is shown, and where it sits among its siblings.
 */
import type { DesignNode, DocOp } from "@ultrapaint/contracts/document";
import {
  type Breakpoint,
  breakpointAt,
  resolveAtBreakpoint,
} from "@ultrapaint/design-document/breakpoints";
import { cn } from "cn";
import { X } from "lucide-react";
import { Row, Section } from "../components/panel.tsx";
import { Segmented } from "../components/segmented.tsx";
import { useBreakpoints } from "../state/design-system.ts";
import {
  applyOps,
  docOfFrame,
  isNodeFrame,
  nodeIn,
  pageOfFrame,
  useDocuments,
} from "../state/documents.ts";
import { useEditor } from "../state/editor.ts";
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

/** Takes a field a breakpoint sets away: the node shows what it inherits there again. */
const resetAt = (
  frame: string,
  node: DesignNode,
  at: string,
  field: string
) => {
  const { canvas } = useEditor.getState();
  const op: DocOp = field.startsWith("props.")
    ? {
        at,
        id: node.id,
        op: "setProps",
        props: { [field.slice("props.".length)]: null },
      }
    : { at, id: node.id, op: "update", set: { [field]: null } };
  applyOps(docOfFrame(frame, canvas), [op], `Reset ${field} at ${at}`);
};

/**
 * Where a node is shown, as one phrase: "Shown from md up", "Shown below lg", nothing when it is
 * shown at every width.
 */
export const visibilityOf = (
  node: DesignNode,
  breakpoints: readonly Breakpoint[]
): string | null => {
  const levels = [null, ...breakpoints.map((b) => b.name)];
  const shown = levels.map(
    (name) => !resolveAtBreakpoint(node, breakpoints, name).hidden
  );
  if (shown.every(Boolean)) {
    return null;
  }
  if (!shown.some(Boolean)) {
    return "Hidden at every width";
  }
  const from = shown.indexOf(true);
  const until = shown.indexOf(false, from);
  const contiguous = until < 0 || !shown.slice(until).some(Boolean);
  if (!contiguous) {
    return "Shown at some widths";
  }
  const start = levels[from];
  const end = until < 0 ? null : levels[until];
  if (start === null) {
    return `Shown below ${end}`;
  }
  return end === null
    ? `Shown from ${start} up`
    : `Shown from ${start} to below ${end}`;
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
  const width = useEditor((s) => s.frames[frame]?.width);
  const views = useEditor(
    (s) => (s.frames[pageOfFrame(frame)]?.views?.length ?? 0) > 0
  );
  if (!own || isNodeFrame(frame) || own.type === "page") {
    return null;
  }
  const shown =
    width === undefined
      ? null
      : (breakpointAt(breakpoints, width)?.name ?? null);
  const editing = views ? shown : null;
  const used = breakpoints.filter((b) => fieldsAt(own, b.name).length > 0);
  if (!views && used.length === 0) {
    return null;
  }
  const holding = new Set(
    shown === null
      ? []
      : breakpoints
          .slice(0, breakpoints.findIndex((b) => b.name === shown) + 1)
          .map((b) => b.name)
  );
  const visibility = visibilityOf(own, breakpoints);
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
        {visibility ? ` ${visibility}.` : null}
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
                  onClick={() => resetAt(frame, own, b.name, field)}
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
      {editing === null ? null : (
        <>
          <Row label="Here">
            <Segmented
              onChange={(v) => set("hidden", v === "hidden")}
              options={[
                {
                  label: "Shown",
                  title: `Shown from ${editing} up`,
                  value: "shown",
                },
                {
                  label: "Hidden",
                  title: `Hidden from ${editing} up`,
                  value: "hidden",
                },
              ]}
              value={node.hidden ? "hidden" : "shown"}
            />
          </Row>
          <Row label="Order">
            <Segmented
              onChange={(v) => set("order", ORDER_VALUE[v])}
              options={[...ORDER_OPTIONS]}
              value={orderChoice(node.order)}
            />
          </Row>
        </>
      )}
    </Section>
  );
};
