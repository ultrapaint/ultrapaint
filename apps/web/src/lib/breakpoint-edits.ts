/**
 * Where an edit lands (ADR 0036). A page with views is drawn at several widths, and an edit made
 * in one of them holds from the breakpoint its width falls in up: the base, below the first
 * breakpoint, writes the node's own fields, which every view shows; any other writes the node's
 * `at`. A field set back to what it inherits from below loses the override. A page without views
 * is edited at the base, as it always was, unless the field shown is set at the breakpoint the
 * frame is drawn at: the edit goes where the value comes from, so what changes is what is seen.
 */
import type { JsonValue } from "@ultrapaint/contracts/base";
import type { DesignNode, DocOp } from "@ultrapaint/contracts/document";
import {
  breakpointBelow,
  FIXED_FIELDS,
  resolveAtBreakpoint,
  sourceOf,
} from "@ultrapaint/design-document/breakpoints";
import { currentBreakpoints } from "../state/design-system.ts";
import { pageOfFrame } from "../state/documents.ts";
import { type EditorState, useEditor } from "../state/editor.ts";
import { frameBreakpoint, useFrameBreakpoint } from "../state/selection.ts";

const viewsIn = (frames: EditorState["frames"], frame: string) =>
  (frames[pageOfFrame(frame)]?.views?.length ?? 0) > 0;

/** Whether the page a frame shows is drawn in views: its edits then land where they are made. */
export const hasViews = (frame: string) =>
  viewsIn(useEditor.getState().frames, frame);

/** The breakpoint what is edited in a frame lands at: null for the node's own fields. */
export const editingBreakpoint = (frame: string): string | null =>
  hasViews(frame) ? frameBreakpoint(frame) : null;

/** `editingBreakpoint` for a component. */
export const useEditingBreakpoint = (frame: string): string | null => {
  const shown = useFrameBreakpoint(frame);
  return useEditor((s) => viewsIn(s.frames, frame)) ? shown : null;
};

const sameJson = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

type Fields = Record<string, JsonValue>;

/** Fields set together into one operation each: the node's own, and each breakpoint's. */
const groupBy = (
  entries: readonly (readonly [string, JsonValue, string | null])[]
) => {
  const groups = new Map<string | null, Fields>();
  for (const [key, value, at] of entries) {
    groups.set(at, { ...groups.get(at), [key]: value });
  }
  return groups;
};

/**
 * The operations that set `set` on `node` as edited in `frame`: at the frame's breakpoint, the
 * node's own fields, or where each field's value comes from, as the module says.
 */
export const updateOpsAt = (
  node: DesignNode,
  frame: string,
  set: Fields
): DocOp[] => {
  const breakpoints = currentBreakpoints();
  const shown = frameBreakpoint(frame);
  const target = hasViews(frame) ? shown : null;
  const below = target === null ? null : breakpointBelow(breakpoints, target);
  const inherited =
    target === null
      ? null
      : (resolveAtBreakpoint(node, breakpoints, below) as unknown as Fields);
  const entries = Object.entries(set).map(([key, value]) => {
    if (FIXED_FIELDS.has(key) || (key === "type" && !isStack(node))) {
      return [key, value, null] as const;
    }
    if (target === null) {
      // No views: the base, or the breakpoint the value shown comes from.
      const from =
        shown === null ? null : sourceOf(node, key, breakpoints, shown);
      return [key, value, from] as const;
    }
    // Shown again at a breakpoint is `hidden: false` there, not the field taken away.
    if (key === "hidden") {
      const hides = value === true;
      const hiddenBelow = inherited?.hidden === true;
      return [key, hides === hiddenBelow ? null : hides, target] as const;
    }
    // Back to what it inherits: the breakpoint no longer sets it.
    const same = value !== null && sameJson(inherited?.[key], value);
    return [key, same ? null : value, target] as const;
  });
  return [...groupBy(entries)].map(([at, fields]) => ({
    ...(at !== null && { at }),
    id: node.id,
    op: "update",
    set: fields,
  }));
};

/** An instance's props set as edited in `frame`, as `updateOpsAt` sets fields. */
export const propsOpsAt = (
  node: DesignNode,
  frame: string,
  props: Fields
): DocOp[] => {
  if (node.type !== "instance") {
    return [];
  }
  const breakpoints = currentBreakpoints();
  const shown = frameBreakpoint(frame);
  const target = hasViews(frame) ? shown : null;
  const inheritedProps =
    target === null
      ? undefined
      : (
          resolveAtBreakpoint(
            node,
            breakpoints,
            breakpointBelow(breakpoints, target)
          ) as typeof node
        ).props;
  const entries = Object.entries(props).map(([key, value]) => {
    if (target === null) {
      const from =
        shown === null
          ? null
          : sourceOf(node, `props.${key}`, breakpoints, shown);
      return [key, value, from] as const;
    }
    const same = value !== null && sameJson(inheritedProps?.[key], value);
    return [key, same ? null : value, target] as const;
  });
  return [...groupBy(entries)].map(([at, fields]) => ({
    ...(at !== null && { at }),
    id: node.id,
    op: "setProps",
    props: fields,
  }));
};

const isStack = (node: DesignNode) =>
  node.type === "row" || node.type === "column";

/**
 * A node inserted while a view above the base is edited: hidden below that view's breakpoint, so
 * the smaller screens it was not designed for go on as they were.
 */
export const insertedAt = (node: DesignNode, frame: string): DesignNode => {
  const at = editingBreakpoint(frame);
  if (at === null) {
    return node;
  }
  const own = (node.at ?? {}) as Record<string, Record<string, unknown>>;
  return {
    ...node,
    at: { ...own, [at]: { ...own[at], hidden: false } },
    hidden: true,
  } as DesignNode;
};
