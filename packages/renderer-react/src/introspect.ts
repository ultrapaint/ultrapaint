/**
 * Reads React's component tree for the preview core. It has no dependency on the screen's
 * React copy: it learns about roots and commits through the DevTools hook and reaches fibers
 * through the references React attaches to DOM nodes. Works with React 18 and 19.
 */
import type { SourceLocation } from "@ultrapaint/contracts/base";
import type { TreeNode } from "@ultrapaint/contracts/preview";
import type {
  Introspector,
  NodeFacts,
  PreviewContext,
} from "@ultrapaint/framework-api/browser";
import {
  drawsItsOwnBox,
  drawsOnScreen,
  elementSummary,
  shorten,
} from "@ultrapaint/preview-core/dom";

interface Fiber {
  alternate: Fiber | null;
  child: Fiber | null;
  elementType: unknown;
  key: string | null;
  memoizedProps: Record<string, unknown> | null;
  return: Fiber | null;
  sibling: Fiber | null;
  stateNode: unknown;
  tag: number;
  type: unknown;
}

interface FiberRoot {
  containerInfo: Element;
  current: Fiber;
}

const HOST_TAGS = new Set([5, 26, 27]);
const TEXT_TAG = 6;
const PORTAL_TAG = 4;
const WHITESPACE_RE = /\s+/;

const roots = new Set<FiberRoot>();
let context: PreviewContext | null = null;

const isEditable = (source: SourceLocation | null) =>
  context?.isEditable(source) ?? false;
const parseStamp = (value: unknown) => context?.parseStamp(value) ?? null;

// ---- React DevTools hook: the reliable way to learn about roots and commits. ----
const installHook = () => {
  const w = window as unknown as { __REACT_DEVTOOLS_GLOBAL_HOOK__?: unknown };
  if (w.__REACT_DEVTOOLS_GLOBAL_HOOK__) {
    return;
  }
  const renderers = new Map<number, unknown>();
  let nextId = 1;
  const hook = {
    checkDCE() {
      // Stub: React calls this to detect dead-code elimination; nothing to check here.
    },
    emit() {
      // Stub: no DevTools frontend is listening.
    },
    inject(renderer: unknown) {
      const id = nextId;
      nextId += 1;
      renderers.set(id, renderer);
      return id;
    },
    isDisabled: false,
    off() {
      // Stub: no listeners are ever registered.
    },
    on() {
      // Stub: no DevTools frontend is listening.
    },
    onCommitFiberRoot(_id: number, root: FiberRoot) {
      roots.add(root);
      context?.onCommit();
    },
    onCommitFiberUnmount() {
      // Stub: ids are tracked per fiber in a WeakMap, so unmounts need no bookkeeping.
    },
    onPostCommitFiberRoot() {
      // Stub: `onCommitFiberRoot` already schedules the refresh.
    },
    renderers,
    sub() {
      return () => {
        // Stub: nothing was subscribed, so there is nothing to unsubscribe.
      };
    },
    supportsFiber: true,
  };
  w.__REACT_DEVTOOLS_GLOBAL_HOOK__ = hook;
};

const findRootsFromDom = () => {
  const container = document.getElementById("root");
  if (!container) {
    return;
  }
  for (const key of Object.keys(container)) {
    if (key.startsWith("__reactContainer$")) {
      const fiber = (container as unknown as Record<string, Fiber>)[key];
      if (fiber?.stateNode) {
        roots.add(fiber.stateNode as FiberRoot);
      }
    }
  }
};

// ---- Ids ----
const fiberIds = new WeakMap<Fiber, string>();
const idToFiber = new Map<string, Fiber>();
let idCounter = 0;

const idFor = (fiber: Fiber): string => {
  let id =
    fiberIds.get(fiber) ??
    (fiber.alternate ? fiberIds.get(fiber.alternate) : undefined);
  if (!id) {
    idCounter += 1;
    id = `n${idCounter}`;
  }
  fiberIds.set(fiber, id);
  if (fiber.alternate) {
    fiberIds.set(fiber.alternate, id);
  }
  idToFiber.set(id, fiber);
  return id;
};

const fiberFor = (id: string): Fiber | null => idToFiber.get(id) ?? null;

// ---- Source ----
const stampOf = (fiber: Fiber): string | null => {
  const v = context ? fiber.memoizedProps?.[context.stampAttribute] : null;
  return typeof v === "string" ? v : null;
};

const componentName = (fiber: Fiber): string => {
  const t = fiber.type as {
    displayName?: string;
    name?: string;
    render?: { name?: string };
    type?: { name?: string };
  } | null;
  if (!t) {
    return "Anonymous";
  }
  if (typeof t === "string") {
    return t;
  }
  return (
    t.displayName || t.name || t.render?.name || t.type?.name || "Anonymous"
  );
};

const isHost = (f: Fiber) => HOST_TAGS.has(f.tag);
const isComponent = (f: Fiber) =>
  f.tag === 0 || f.tag === 1 || f.tag === 11 || f.tag === 14 || f.tag === 15;

// ---- Tree ----
const summaryFor = (fiber: Fiber, name: string): string => {
  if (isHost(fiber)) {
    return elementSummary(fiber.stateNode as Element, name);
  }
  const children = fiber.memoizedProps?.children;
  return typeof children === "string" ? `${name} "${shorten(children)}"` : name;
};

const buildNode = (
  fiber: Fiber,
  parentStamp: string | null = null
): TreeNode[] => {
  const stamp = stampOf(fiber);
  const source = parseStamp(stamp);
  const ownStamp = isComponent(fiber) && stamp ? stamp : parentStamp;
  const children: TreeNode[] = [];
  for (let c = fiber.child; c; c = c.sibling) {
    children.push(...buildNode(c, ownStamp));
  }

  if (isHost(fiber)) {
    const name = String(fiber.type);
    return [
      {
        children,
        editable: isEditable(source),
        id: idFor(fiber),
        kind: "element",
        name,
        source,
        summary: summaryFor(fiber, name),
      },
    ];
  }
  // A component that merely forwards the instance's props (same stamp as its component
  // ancestor) is an implementation detail of that instance; keep the tree at instance level.
  if (isComponent(fiber) && stamp && stamp !== parentStamp) {
    const name = componentName(fiber);
    return [
      {
        children,
        editable: isEditable(source),
        id: idFor(fiber),
        kind: "component",
        name,
        source,
        summary: summaryFor(fiber, name),
      },
    ];
  }
  if (fiber.tag === TEXT_TAG) {
    return [];
  }
  // Transparent: fragments, providers, unstamped components.
  return children;
};

const tree = (): TreeNode[] | null => {
  if (roots.size === 0) {
    findRootsFromDom();
  }
  const root = roots.values().next().value as FiberRoot | undefined;
  return root ? buildNode(root.current) : null;
};

// ---- DOM ----
const fiberOfDom = (node: Node): Fiber | null => {
  for (const key of Object.keys(node)) {
    if (key.startsWith("__reactFiber$")) {
      return (node as unknown as Record<string, Fiber>)[key] ?? null;
    }
  }
  return null;
};

const domNodesOf = (fiber: Fiber): Element[] => {
  if (isHost(fiber)) {
    return [fiber.stateNode as Element];
  }
  const out: Element[] = [];
  for (let c = fiber.child; c; c = c.sibling) {
    out.push(...domNodesOf(c));
  }
  return out;
};

/** The portal that renders this fiber, if any; null when it is rendered in place. */
const portalOf = (fiber: Fiber): Fiber | null => {
  for (let f: Fiber | null = fiber; f; f = f.return) {
    if (f.tag === PORTAL_TAG) {
      return f;
    }
  }
  return null;
};

/**
 * Whether anything the fiber puts on the screen lands outside the given portal. The root a
 * library appends to the body to hang its popup in does not count: it is an empty line at the
 * end of the page, and every portal has one.
 */
const rendersOutside = (fiber: Fiber, portal: Fiber): boolean => {
  if (fiber === portal) {
    return false;
  }
  if (isHost(fiber) && drawsOnScreen(fiber.stateNode as Element)) {
    return true;
  }
  for (let c = fiber.child; c; c = c.sibling) {
    if (rendersOutside(c, portal)) {
      return true;
    }
  }
  return false;
};

/**
 * The node inside `portal` a click in it means. A library hangs its popup in one or two
 * transparent wrappers that do nothing but place it on the screen, so the outermost node is
 * rarely the one a designer is pointing at: the answer is the outermost that paints a box of its
 * own — the menu, the card, the tooltip — and the outermost of all when none of them paints.
 */
const popupNode = (fiber: Fiber, portal: Fiber): Fiber => {
  const chain: Fiber[] = [];
  for (let f: Fiber | null = fiber; f && f !== portal; f = f.return) {
    if (isHost(f) || (isComponent(f) && stampOf(f))) {
      chain.unshift(f);
    }
  }
  return (
    chain.find((f) => domNodesOf(f).some(drawsItsOwnBox)) ?? chain[0] ?? fiber
  );
};

/** Given a DOM element, pick the fiber the user most likely means. */
const selectableFiber = (el: Element, deepest: boolean): Fiber | null => {
  let fiber = fiberOfDom(el);
  // Climb to the host fiber of this element (text fibers etc.).
  while (fiber && !isHost(fiber)) {
    fiber = fiber.return;
  }
  if (!fiber) {
    return null;
  }
  if (deepest) {
    return fiber;
  }
  // Find the nearest ancestor with an editable stamp; then climb while the stamp is the same,
  // so a design-system instance is selected instead of the host element it forwards props to.
  let f: Fiber | null = fiber;
  while (f) {
    const s = stampOf(f);
    if (s && isEditable(parseStamp(s)) && (isHost(f) || isComponent(f))) {
      break;
    }
    f = f.return;
  }
  if (!f) {
    return fiber;
  }
  const stamp = stampOf(f);
  let top = f;
  for (let p = f.return; p; p = p.return) {
    if (stampOf(p) === stamp && isComponent(p)) {
      top = p;
    } else if (isHost(p) || (isComponent(p) && stampOf(p))) {
      break;
    }
  }
  // A portal is a boundary. The instance that owns an open dropdown also owns the trigger left
  // behind in the layout and the sheet the library spreads over the screen, so selecting it from
  // a click on the popup would outline the whole page and the popup itself would be reachable
  // only through the layers panel. A click inside a portal picks the box the portal holds
  // instead. An instance that renders nothing but its portal — a dialog written in the design —
  // is already that box and is kept.
  const portal = portalOf(fiber);
  return portal && rendersOutside(top, portal) ? popupNode(fiber, portal) : top;
};

// ---- Facts ----
const serialise = (v: unknown): unknown => {
  if (v === null || v === undefined) {
    return null;
  }
  if (
    typeof v === "string" ||
    typeof v === "number" ||
    typeof v === "boolean"
  ) {
    return v;
  }
  if (typeof v === "function") {
    return "ƒ";
  }
  if (Array.isArray(v)) {
    return v.map(serialise);
  }
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("$$typeof" in o) {
      return "<element>";
    }
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(o)) {
      out[k] = serialise(val);
    }
    return out;
  }
  return String(v);
};

const serialiseProps = (fiber: Fiber): Record<string, unknown> => {
  const props: Record<string, unknown> = {};
  if (isComponent(fiber)) {
    for (const [k, v] of Object.entries(fiber.memoizedProps ?? {})) {
      if (k === "children" || k === context?.stampAttribute) {
        continue;
      }
      props[k] = serialise(v);
    }
  }
  return props;
};

const editableAncestorOf = (
  fiber: Fiber
): { nodeId: string; name: string; source: SourceLocation } | null => {
  for (let p = fiber.return; p; p = p.return) {
    const s = parseStamp(stampOf(p));
    if (s && isEditable(s) && (isHost(p) || isComponent(p))) {
      return {
        name: isHost(p) ? String(p.type) : componentName(p),
        nodeId: idFor(p),
        source: s,
      };
    }
  }
  return null;
};

const describe = (nodeId: string): NodeFacts | null => {
  const fiber = fiberFor(nodeId);
  if (!fiber) {
    return null;
  }
  const source = parseStamp(stampOf(fiber));
  const editable = isEditable(source);
  const ownClassName = fiber.memoizedProps?.className;
  const children = fiber.memoizedProps?.children;
  return {
    editable,
    editableAncestor: editable ? null : editableAncestorOf(fiber),
    kind: isHost(fiber) ? "element" : "component",
    name: isHost(fiber) ? String(fiber.type) : componentName(fiber),
    ownClasses:
      typeof ownClassName === "string"
        ? ownClassName.split(WHITESPACE_RE).filter(Boolean)
        : [],
    props: serialiseProps(fiber),
    source,
    text: typeof children === "string" ? children : null,
  };
};

export const reactIntrospector: Introspector = {
  describe,
  elementsOf: (nodeId) => {
    const fiber = fiberFor(nodeId);
    return fiber ? domNodesOf(fiber) : [];
  },
  install: (ctx) => {
    context = ctx;
    installHook();
  },
  selectable: (element, deepest) => {
    const fiber = selectableFiber(element, deepest);
    return fiber ? idFor(fiber) : null;
  },
  tree,
};
