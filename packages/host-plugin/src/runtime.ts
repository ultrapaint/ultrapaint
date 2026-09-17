/**
 * Runtime injected into every screen iframe. It has no dependency on the screen's React copy:
 * it reads React's fiber tree through the DevTools hook and DOM-attached fiber references,
 * and talks to the editor over `postMessage` using the protocol in
 * `@ultrapaint/contracts/preview`.
 */
import { toPng } from "html-to-image";

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

interface SourceLocation {
  col: number;
  file: string;
  line: number;
}

interface TreeNode {
  children: TreeNode[];
  editable: boolean;
  id: string;
  kind: "component" | "element" | "text";
  name: string;
  source: SourceLocation | null;
  summary: string;
}

interface Config {
  designsDir: string;
  screen: string;
}

const HOST_TAGS = new Set([5, 26, 27]);
const TEXT_TAG = 6;
const STAMP = "data-ed";

const WHITESPACE_RE = /\s+/;
const WHITESPACE_OUTSIDE_PARENS_RE = /\s+(?![^(]*\))/;
const COMMA_OUTSIDE_PARENS_RE = /,(?![^(]*\))/;
const BORDER_WIDTH_RE = /^\d|^(thin|medium|thick)$/;
const BORDER_STYLE_RE = /^(none|solid|dashed|dotted|double|hidden)$/;
const ROOT_SELECTOR_RE = /^:root|^:host|^html/;
const CLASS_SELECTOR_RE = /^\s*\.((?:\\.|[\w-])+)\s*$/;
const VAR_TOKEN_RE = /var\((--[\w-]+)/;

const config: Config = (window as unknown as { __ED_CONFIG__?: Config })
  .__ED_CONFIG__ ?? {
  designsDir: "",
  screen: "",
};

const roots = new Set<FiberRoot>();
let commitScheduled = false;

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
      scheduleAfterCommit();
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
installHook();

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
const parseStamp = (value: unknown): SourceLocation | null => {
  if (typeof value !== "string") {
    return null;
  }
  const idx = value.lastIndexOf(":");
  const idx2 = value.lastIndexOf(":", idx - 1);
  if (idx < 0 || idx2 < 0) {
    return null;
  }
  const line = Number(value.slice(idx2 + 1, idx));
  const col = Number(value.slice(idx + 1));
  if (!(Number.isInteger(line) && Number.isInteger(col))) {
    return null;
  }
  return { col, file: value.slice(0, idx2), line };
};

const stampOf = (fiber: Fiber): string | null => {
  const v = fiber.memoizedProps?.[STAMP];
  return typeof v === "string" ? v : null;
};

const isEditable = (source: SourceLocation | null): boolean =>
  !!source &&
  config.designsDir !== "" &&
  source.file.startsWith(`${config.designsDir}/`);

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
const directText = (el: Element): string | null => {
  let text = "";
  let hasText = false;
  for (const n of el.childNodes) {
    if (n.nodeType === Node.TEXT_NODE) {
      text += n.textContent ?? "";
      hasText = true;
    } else if (n.nodeType === Node.ELEMENT_NODE) {
      return null;
    }
  }
  return hasText ? text.trim() : null;
};

const shorten = (s: string, max = 24) =>
  s.length > max ? `${s.slice(0, max - 1)}…` : s;

const summaryFor = (fiber: Fiber, name: string): string => {
  if (isHost(fiber)) {
    const el = fiber.stateNode as Element;
    const classes = Array.from(el.classList).slice(0, 2);
    const text = directText(el);
    let s = name;
    if (classes.length) {
      s += `.${classes.join(".")}`;
    }
    if (text) {
      s += ` "${shorten(text)}"`;
    }
    return s;
  }
  const props = fiber.memoizedProps ?? {};
  const { children } = props;
  if (typeof children === "string") {
    return `${name} "${shorten(children)}"`;
  }
  return name;
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

const buildTree = (): TreeNode | null => {
  if (roots.size === 0) {
    findRootsFromDom();
  }
  const root = roots.values().next().value as FiberRoot | undefined;
  if (!root) {
    return null;
  }
  const nodes = buildNode(root.current);
  return {
    children: nodes,
    editable: false,
    id: "root",
    kind: "element",
    name: config.screen || "screen",
    source: null,
    summary: config.screen || "screen",
  };
};

// ---- DOM helpers ----
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

const unionRect = (els: Element[]) => {
  let x1 = Number.POSITIVE_INFINITY;
  let y1 = Number.POSITIVE_INFINITY;
  let x2 = Number.NEGATIVE_INFINITY;
  let y2 = Number.NEGATIVE_INFINITY;
  for (const el of els) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) {
      continue;
    }
    x1 = Math.min(x1, r.left);
    y1 = Math.min(y1, r.top);
    x2 = Math.max(x2, r.right);
    y2 = Math.max(y2, r.bottom);
  }
  if (!Number.isFinite(x1)) {
    return { height: 0, width: 0, x: 0, y: 0 };
  }
  return { height: y2 - y1, width: x2 - x1, x: x1, y: y1 };
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
  return top;
};

// ---- Styles and provenance ----
interface Decl {
  order: number;
  props: Record<string, string>;
}
let classRules: Map<string, Decl[]> | null = null;
let rootTokens: Map<string, string> | null = null;

const expandFour = (
  names: [string, string, string, string],
  parts: string[],
  value: string,
  out: Record<string, string>
) => {
  const a = parts[0] ?? value;
  const b = parts[1] ?? a;
  const c = parts[2] ?? a;
  const d = parts[3] ?? b;
  out[names[0]] = a;
  out[names[1]] = b;
  out[names[2]] = c;
  out[names[3]] = d;
};

const expandPair = (
  names: [string, string],
  parts: string[],
  value: string,
  out: Record<string, string>
) => {
  out[names[0]] = parts[0] ?? value;
  out[names[1]] = parts[1] ?? parts[0] ?? value;
};

const expandBorder = (parts: string[], out: Record<string, string>) => {
  for (const p of parts) {
    if (
      BORDER_WIDTH_RE.test(p) ||
      p.startsWith("calc") ||
      p.startsWith("var(--tw-border")
    ) {
      expandShorthand("border-width", p, out);
    } else if (BORDER_STYLE_RE.test(p)) {
      out["border-style"] = p;
    } else {
      expandShorthand("border-color", p, out);
    }
  }
};

const expandShorthand = (
  prop: string,
  value: string,
  out: Record<string, string>
) => {
  const parts = value.trim().split(WHITESPACE_OUTSIDE_PARENS_RE);
  const four = (names: [string, string, string, string]) =>
    expandFour(names, parts, value, out);
  const pair = (names: [string, string]) =>
    expandPair(names, parts, value, out);
  switch (prop) {
    case "padding":
      four(["padding-top", "padding-right", "padding-bottom", "padding-left"]);
      break;
    case "margin":
      four(["margin-top", "margin-right", "margin-bottom", "margin-left"]);
      break;
    case "padding-inline":
      pair(["padding-left", "padding-right"]);
      break;
    case "padding-block":
      pair(["padding-top", "padding-bottom"]);
      break;
    case "margin-inline":
      pair(["margin-left", "margin-right"]);
      break;
    case "margin-block":
      pair(["margin-top", "margin-bottom"]);
      break;
    case "gap":
      pair(["row-gap", "column-gap"]);
      break;
    case "border-radius":
      four([
        "border-top-left-radius",
        "border-top-right-radius",
        "border-bottom-right-radius",
        "border-bottom-left-radius",
      ]);
      break;
    case "border-width":
      four([
        "border-top-width",
        "border-right-width",
        "border-bottom-width",
        "border-left-width",
      ]);
      break;
    case "border-color":
      four([
        "border-top-color",
        "border-right-color",
        "border-bottom-color",
        "border-left-color",
      ]);
      break;
    case "border":
      expandBorder(parts, out);
      break;
    case "inset":
      four(["top", "right", "bottom", "left"]);
      break;
    default:
      out[LOGICAL[prop] ?? prop] = value;
  }
};

/** Chrome enumerates logical longhands for `padding-block` and friends; map them to physical. */
const LOGICAL: Record<string, string> = {
  "block-size": "height",
  "border-block-end-width": "border-bottom-width",
  "border-block-start-color": "border-top-color",
  "border-block-start-width": "border-top-width",
  "border-end-end-radius": "border-bottom-right-radius",
  "border-end-start-radius": "border-bottom-left-radius",
  "border-inline-end-width": "border-right-width",
  "border-inline-start-color": "border-left-color",
  "border-inline-start-width": "border-left-width",
  "border-start-end-radius": "border-top-right-radius",
  "border-start-start-radius": "border-top-left-radius",
  "inline-size": "width",
  "inset-block-end": "bottom",
  "inset-block-start": "top",
  "inset-inline-end": "right",
  "inset-inline-start": "left",
  "margin-block-end": "margin-bottom",
  "margin-block-start": "margin-top",
  "margin-inline-end": "margin-right",
  "margin-inline-start": "margin-left",
  "max-block-size": "max-height",
  "max-inline-size": "max-width",
  "min-block-size": "min-height",
  "min-inline-size": "min-width",
  "padding-block-end": "padding-bottom",
  "padding-block-start": "padding-top",
  "padding-inline-end": "padding-right",
  "padding-inline-start": "padding-left",
};

/** Reads a rule's declarations as physical longhands; root-level custom properties go to `tokens`. */
const readDeclarations = (
  rule: CSSStyleRule,
  tokens: Map<string, string>
): Record<string, string> => {
  const selector = rule.selectorText;
  const decls: Record<string, string> = {};
  for (const p of rule.style) {
    if (!p) {
      continue;
    }
    const v = rule.style.getPropertyValue(p);
    if (p.startsWith("--")) {
      if (ROOT_SELECTOR_RE.test(selector) || selector.includes(":root")) {
        tokens.set(p, v.trim());
      }
      continue;
    }
    expandShorthand(p, v, decls);
  }
  return decls;
};

const registerClassSelectors = (
  selector: string,
  order: number,
  props: Record<string, string>,
  into: Map<string, Decl[]>
) => {
  for (const single of selector.split(COMMA_OUTSIDE_PARENS_RE)) {
    const m: RegExpExecArray | null = CLASS_SELECTOR_RE.exec(single);
    if (!m?.[1]) {
      continue;
    }
    const cls = m[1].replaceAll(/\\(.)/g, "$1");
    const list = into.get(cls) ?? [];
    list.push({ order, props });
    into.set(cls, list);
  }
};

const collectStyleRule = (
  rule: CSSStyleRule,
  order: { n: number },
  into: Map<string, Decl[]>,
  tokens: Map<string, string>
) => {
  const decls = readDeclarations(rule, tokens);
  order.n += 1;
  if (Object.keys(decls).length) {
    registerClassSelectors(rule.selectorText, order.n, decls, into);
  }
  // Nested rules (CSS nesting) are variants; skipped for base provenance.
};

const collectRules = (
  rules: CSSRuleList,
  order: { n: number },
  into: Map<string, Decl[]>,
  tokens: Map<string, string>
) => {
  for (const rule of Array.from(rules)) {
    if (rule instanceof CSSStyleRule) {
      collectStyleRule(rule, order, into, tokens);
    } else if ("cssRules" in rule) {
      try {
        collectRules((rule as CSSGroupingRule).cssRules, order, into, tokens);
      } catch {
        /* cross-origin */
      }
    }
  }
};

const ensureRules = () => {
  if (classRules && rootTokens) {
    return;
  }
  classRules = new Map();
  rootTokens = new Map();
  const order = { n: 0 };
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      collectRules(sheet.cssRules, order, classRules, rootTokens);
    } catch {
      /* cross-origin sheet */
    }
  }
};

const invalidateRules = () => {
  classRules = null;
  rootTokens = null;
};

const INHERITED = new Set([
  "color",
  "font-family",
  "font-size",
  "font-weight",
  "line-height",
  "letter-spacing",
  "text-align",
  "font-style",
  "text-transform",
]);

const INSPECTED = [
  "display",
  "flex-direction",
  "flex-wrap",
  "align-items",
  "justify-content",
  "row-gap",
  "column-gap",
  "width",
  "height",
  "min-width",
  "max-width",
  "min-height",
  "max-height",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "font-family",
  "font-size",
  "font-weight",
  "line-height",
  "letter-spacing",
  "text-align",
  "color",
  "background-color",
  "border-top-width",
  "border-top-color",
  "border-top-left-radius",
  "opacity",
  "box-shadow",
] as const;

const tokenIn = (declared: string): string | undefined => {
  const m: RegExpExecArray | null = VAR_TOKEN_RE.exec(declared);
  return m?.[1];
};

interface Winner {
  cls: string;
  declared: string;
  order: number;
}

/** Which class sets which property: last declaration in stylesheet order wins. */
const winnersFor = (
  classes: string[],
  rules: Map<string, Decl[]>
): Record<string, Winner> => {
  const winner: Record<string, Winner> = {};
  for (const cls of classes) {
    for (const decl of rules.get(cls) ?? []) {
      for (const [p, v] of Object.entries(decl.props)) {
        const cur = winner[p];
        if (!cur || decl.order >= cur.order) {
          winner[p] = { cls, declared: v, order: decl.order };
        }
      }
    }
  }
  return winner;
};

const provenanceFor = (
  prop: string,
  inline: CSSStyleDeclaration,
  w: Winner | undefined,
  ownClasses: string[],
  editable: boolean
): Record<string, unknown> => {
  if (inline.getPropertyValue(prop)) {
    return { editable: false, kind: "inline" };
  }
  if (w) {
    return {
      className: w.cls,
      editable,
      kind: ownClasses.includes(w.cls) ? "utility" : "component",
      token: tokenIn(w.declared),
    };
  }
  if (INHERITED.has(prop)) {
    return { editable, kind: "inherited" };
  }
  return { editable, kind: "default" };
};

const serialiseProps = (fiber: Fiber): Record<string, unknown> => {
  const props: Record<string, unknown> = {};
  if (isComponent(fiber)) {
    for (const [k, v] of Object.entries(fiber.memoizedProps ?? {})) {
      if (k === "children" || k === STAMP) {
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

const textOf = (fiber: Fiber, el: Element): string | null => {
  if (isHost(fiber)) {
    return directText(el);
  }
  const children = fiber.memoizedProps?.children;
  return typeof children === "string" ? children : null;
};

const inspectFiber = (fiber: Fiber, id: string) => {
  ensureRules();
  const rules = classRules as Map<string, Decl[]>;
  const els = domNodesOf(fiber);
  const [el] = els;
  if (!el) {
    return null;
  }
  const stamp = stampOf(fiber);
  const source = parseStamp(stamp);
  const editable = isEditable(source);
  const ownClassName = fiber.memoizedProps?.className;
  const ownClasses =
    typeof ownClassName === "string"
      ? ownClassName.split(WHITESPACE_RE).filter(Boolean)
      : [];
  const classes = Array.from(el.classList);
  const computed = getComputedStyle(el);
  const styles: Record<
    string,
    { value: string; provenance: Record<string, unknown> }
  > = {};

  const winner = winnersFor(classes, rules);
  const inline = (el as HTMLElement).style;
  for (const prop of INSPECTED) {
    const value = computed.getPropertyValue(prop);
    const provenance = provenanceFor(
      prop,
      inline,
      winner[prop],
      ownClasses,
      editable
    );
    styles[prop] = { provenance, value };
  }

  return {
    classes,
    editable,
    editableAncestor: editable ? null : editableAncestorOf(fiber),
    kind: isHost(fiber) ? "element" : "component",
    name: isHost(fiber) ? String(fiber.type) : componentName(fiber),
    nodeId: id,
    ownClasses,
    props: serialiseProps(fiber),
    rect: unionRect(els),
    source,
    styles,
    text: textOf(fiber, el),
  };
};

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

// ---- Messaging ----
// Every message carries the screen id so the editor can route it without relying on window
// identity, which changes when the host restarts on another port.
const post = (msg: Record<string, unknown>) => {
  window.parent.postMessage({ ...msg, screen: config.screen }, "*");
};

const sendTree = () => {
  const tree = buildTree();
  if (tree) {
    post({ tree, type: "ed:tree" });
  }
};

let watched: string[] = [];
let rectsScheduled = false;
const sendRects = () => {
  rectsScheduled = false;
  if (watched.length === 0) {
    return;
  }
  const rects: Record<
    string,
    { x: number; y: number; width: number; height: number }
  > = {};
  for (const id of watched) {
    const f = fiberFor(id);
    if (f) {
      rects[id] = unionRect(domNodesOf(f));
    }
  }
  post({ rects, type: "ed:rects" });
};
const scheduleRects = () => {
  if (rectsScheduled) {
    return;
  }
  rectsScheduled = true;
  requestAnimationFrame(sendRects);
};

const scheduleAfterCommit = () => {
  if (commitScheduled) {
    return;
  }
  commitScheduled = true;
  queueMicrotask(() => {
    commitScheduled = false;
    sendTree();
    scheduleRects();
  });
};

// ---- Inline text editing ----
let editing: { el: HTMLElement; nodeId: string; original: string } | null =
  null;
const startTextEdit = (nodeId: string) => {
  const f = fiberFor(nodeId);
  if (!f) {
    return;
  }
  const el = domNodesOf(f)[0] as HTMLElement | undefined;
  if (!el) {
    return;
  }
  if (editing) {
    finishTextEdit(false);
  }
  editing = { el, nodeId, original: el.textContent ?? "" };
  el.contentEditable = "plaintext-only";
  el.focus();
  const range = document.createRange();
  range.selectNodeContents(el);
  getSelection()?.removeAllRanges();
  getSelection()?.addRange(range);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      finishTextEdit(true);
    } else if (e.key === "Escape") {
      e.preventDefault();
      finishTextEdit(false);
    }
  };
  const onBlur = () => finishTextEdit(true);
  el.addEventListener("keydown", onKey);
  el.addEventListener("blur", onBlur, { once: true });
  (editing as { cleanup?: () => void }).cleanup = () => {
    el.removeEventListener("keydown", onKey);
    el.removeEventListener("blur", onBlur);
  };
};
const finishTextEdit = (commit: boolean) => {
  if (!editing) {
    return;
  }
  const { el, nodeId, original } = editing;
  (editing as { cleanup?: () => void }).cleanup?.();
  editing = null;
  el.contentEditable = "false";
  el.removeAttribute("contenteditable");
  const text = el.textContent ?? "";
  if (commit && text !== original) {
    post({ nodeId, text, type: "ed:textCommit" });
  } else {
    el.textContent = original;
  }
};

// ---- Handlers ----
window.addEventListener("message", (ev) => {
  const msg = ev.data as ({ type?: string } & Record<string, unknown>) | null;
  if (!msg || typeof msg.type !== "string" || !msg.type.startsWith("ed:")) {
    return;
  }
  switch (msg.type) {
    case "ed:getTree":
      sendTree();
      break;
    case "ed:hitTest": {
      const x = msg.x as number;
      const y = msg.y as number;
      const el = document.elementFromPoint(x, y);
      const fiber = el ? selectableFiber(el, Boolean(msg.deepest)) : null;
      post({
        nodeId: fiber ? idFor(fiber) : null,
        requestId: msg.requestId,
        type: "ed:hit",
      });
      break;
    }
    case "ed:inspect": {
      const f = fiberFor(msg.nodeId as string);
      const result = f ? inspectFiber(f, msg.nodeId as string) : null;
      post({ requestId: msg.requestId, result, type: "ed:inspect" });
      break;
    }
    case "ed:watchRects":
      watched = msg.nodeIds as string[];
      scheduleRects();
      break;
    case "ed:hover":
    case "ed:select":
      break;
    case "ed:editText":
      startTextEdit(msg.nodeId as string);
      break;
    case "ed:scrollIntoView": {
      const f = fiberFor(msg.nodeId as string);
      domNodesOf(f ?? ({} as Fiber))[0]?.scrollIntoView({ block: "nearest" });
      break;
    }
    case "ed:screenshot": {
      toPng(document.body, { cacheBust: true, pixelRatio: 1 })
        .then((dataUrl) =>
          post({ dataUrl, requestId: msg.requestId, type: "ed:screenshot" })
        )
        .catch(() =>
          post({
            dataUrl: null,
            requestId: msg.requestId,
            type: "ed:screenshot",
          })
        );
      break;
    }
    case "ed:getTokens": {
      ensureRules();
      const tokens: Record<string, string> = {};
      const cs = getComputedStyle(document.documentElement);
      for (const [name, raw] of rootTokens ?? []) {
        const resolved = cs.getPropertyValue(name).trim();
        tokens[name] = resolved || raw;
      }
      post({ tokens, type: "ed:tokens" });
      break;
    }
    default:
      break;
  }
});

// ---- Observers ----
const mo = new MutationObserver(() => {
  invalidateRules();
  scheduleRects();
});
const start = () => {
  mo.observe(document.documentElement, {
    attributes: true,
    characterData: true,
    childList: true,
    subtree: true,
  });
  window.addEventListener("scroll", scheduleRects, true);
  window.addEventListener("resize", scheduleRects);
  new ResizeObserver(scheduleRects).observe(document.documentElement);
  window.addEventListener("error", (e) => {
    post({
      error: {
        file: e.filename,
        line: e.lineno,
        message: e.message,
        stack: e.error?.stack,
      },
      type: "ed:error",
    });
  });
  post({ screen: config.screen, type: "ed:ready" });
};
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start);
} else {
  start();
}

// Public surface for the generated entry module (HMR notifications, render errors).
(window as unknown as { __ED__: unknown }).__ED__ = {
  notifyHmr() {
    invalidateRules();
    post({ type: "ed:hmr" });
    scheduleAfterCommit();
  },
  reportError(error: {
    message: string;
    stack?: string;
    file?: string;
    line?: number;
  }) {
    post({ error, type: "ed:error" });
  },
};
