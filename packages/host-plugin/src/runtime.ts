/**
 * Runtime injected into every screen iframe. It has no dependency on the screen's React copy:
 * it reads React's fiber tree through the DevTools hook and DOM-attached fiber references,
 * and talks to the editor over `postMessage` using the protocol in
 * `@ultrapaint/contracts/preview`.
 */
import { toPng } from "html-to-image";

type Fiber = {
  tag: number;
  type: unknown;
  elementType: unknown;
  stateNode: unknown;
  memoizedProps: Record<string, unknown> | null;
  child: Fiber | null;
  sibling: Fiber | null;
  return: Fiber | null;
  alternate: Fiber | null;
  key: string | null;
};

type FiberRoot = { current: Fiber; containerInfo: Element };

interface SourceLocation {
  file: string;
  line: number;
  col: number;
}

interface TreeNode {
  id: string;
  kind: "component" | "element" | "text";
  name: string;
  summary: string;
  source: SourceLocation | null;
  editable: boolean;
  children: TreeNode[];
}

interface Config {
  screen: string;
  designsDir: string;
}

const HOST_TAGS = new Set([5, 26, 27]);
const TEXT_TAG = 6;
const STAMP = "data-ed";

const config: Config = (window as unknown as { __ED_CONFIG__?: Config }).__ED_CONFIG__ ?? {
  screen: "",
  designsDir: "",
};

const roots = new Set<FiberRoot>();
let commitScheduled = false;

// ---- React DevTools hook: the reliable way to learn about roots and commits. ----
const installHook = () => {
  const w = window as unknown as { __REACT_DEVTOOLS_GLOBAL_HOOK__?: unknown };
  if (w.__REACT_DEVTOOLS_GLOBAL_HOOK__) return;
  const renderers = new Map<number, unknown>();
  let nextId = 1;
  const hook = {
    renderers,
    supportsFiber: true,
    isDisabled: false,
    checkDCE() {},
    inject(renderer: unknown) {
      const id = nextId++;
      renderers.set(id, renderer);
      return id;
    },
    on() {},
    off() {},
    emit() {},
    sub() {
      return () => {};
    },
    onCommitFiberRoot(_id: number, root: FiberRoot) {
      roots.add(root);
      scheduleAfterCommit();
    },
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
  };
  w.__REACT_DEVTOOLS_GLOBAL_HOOK__ = hook;
};
installHook();

const findRootsFromDom = () => {
  const container = document.getElementById("root");
  if (!container) return;
  for (const key of Object.keys(container)) {
    if (key.startsWith("__reactContainer$")) {
      const fiber = (container as unknown as Record<string, Fiber>)[key];
      if (fiber?.stateNode) roots.add(fiber.stateNode as FiberRoot);
    }
  }
};

// ---- Ids ----
const fiberIds = new WeakMap<Fiber, string>();
const idToFiber = new Map<string, Fiber>();
let idCounter = 0;

const idFor = (fiber: Fiber): string => {
  let id = fiberIds.get(fiber) ?? (fiber.alternate ? fiberIds.get(fiber.alternate) : undefined);
  if (!id) {
    idCounter += 1;
    id = `n${idCounter}`;
  }
  fiberIds.set(fiber, id);
  if (fiber.alternate) fiberIds.set(fiber.alternate, id);
  idToFiber.set(id, fiber);
  return id;
};

const fiberFor = (id: string): Fiber | null => idToFiber.get(id) ?? null;

// ---- Source ----
const parseStamp = (value: unknown): SourceLocation | null => {
  if (typeof value !== "string") return null;
  const idx = value.lastIndexOf(":");
  const idx2 = value.lastIndexOf(":", idx - 1);
  if (idx < 0 || idx2 < 0) return null;
  const line = Number(value.slice(idx2 + 1, idx));
  const col = Number(value.slice(idx + 1));
  if (!Number.isInteger(line) || !Number.isInteger(col)) return null;
  return { file: value.slice(0, idx2), line, col };
};

const stampOf = (fiber: Fiber): string | null => {
  const v = fiber.memoizedProps?.[STAMP];
  return typeof v === "string" ? v : null;
};

const isEditable = (source: SourceLocation | null): boolean =>
  !!source && config.designsDir !== "" && source.file.startsWith(`${config.designsDir}/`);

const componentName = (fiber: Fiber): string => {
  const t = fiber.type as {
    displayName?: string;
    name?: string;
    render?: { name?: string };
    type?: { name?: string };
  } | null;
  if (!t) return "Anonymous";
  if (typeof t === "string") return t;
  return t.displayName || t.name || t.render?.name || t.type?.name || "Anonymous";
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

const shorten = (s: string, max = 24) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

const summaryFor = (fiber: Fiber, name: string): string => {
  if (isHost(fiber)) {
    const el = fiber.stateNode as Element;
    const classes = Array.from(el.classList).slice(0, 2);
    const text = directText(el);
    let s = name;
    if (classes.length) s += `.${classes.join(".")}`;
    if (text) s += ` "${shorten(text)}"`;
    return s;
  }
  const props = fiber.memoizedProps ?? {};
  const children = props.children;
  if (typeof children === "string") return `${name} "${shorten(children)}"`;
  return name;
};

const buildNode = (fiber: Fiber, parentStamp: string | null = null): TreeNode[] => {
  const stamp = stampOf(fiber);
  const source = parseStamp(stamp);
  const ownStamp = isComponent(fiber) && stamp ? stamp : parentStamp;
  const children: TreeNode[] = [];
  for (let c = fiber.child; c; c = c.sibling) children.push(...buildNode(c, ownStamp));

  if (isHost(fiber)) {
    const name = String(fiber.type);
    return [
      {
        id: idFor(fiber),
        kind: "element",
        name,
        summary: summaryFor(fiber, name),
        source,
        editable: isEditable(source),
        children,
      },
    ];
  }
  // A component that merely forwards the instance's props (same stamp as its component
  // ancestor) is an implementation detail of that instance; keep the tree at instance level.
  if (isComponent(fiber) && stamp && stamp !== parentStamp) {
    const name = componentName(fiber);
    return [
      {
        id: idFor(fiber),
        kind: "component",
        name,
        summary: summaryFor(fiber, name),
        source,
        editable: isEditable(source),
        children,
      },
    ];
  }
  if (fiber.tag === TEXT_TAG) return [];
  // Transparent: fragments, providers, unstamped components.
  return children;
};

const buildTree = (): TreeNode | null => {
  if (roots.size === 0) findRootsFromDom();
  const root = roots.values().next().value as FiberRoot | undefined;
  if (!root) return null;
  const nodes = buildNode(root.current);
  return {
    id: "root",
    kind: "element",
    name: config.screen || "screen",
    summary: config.screen || "screen",
    source: null,
    editable: false,
    children: nodes,
  };
};

// ---- DOM helpers ----
const fiberOfDom = (node: Node): Fiber | null => {
  for (const key of Object.keys(node)) {
    if (key.startsWith("__reactFiber$"))
      return (node as unknown as Record<string, Fiber>)[key] ?? null;
  }
  return null;
};

const domNodesOf = (fiber: Fiber): Element[] => {
  if (isHost(fiber)) return [fiber.stateNode as Element];
  const out: Element[] = [];
  for (let c = fiber.child; c; c = c.sibling) out.push(...domNodesOf(c));
  return out;
};

const unionRect = (els: Element[]) => {
  let x1 = Number.POSITIVE_INFINITY;
  let y1 = Number.POSITIVE_INFINITY;
  let x2 = Number.NEGATIVE_INFINITY;
  let y2 = Number.NEGATIVE_INFINITY;
  for (const el of els) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    x1 = Math.min(x1, r.left);
    y1 = Math.min(y1, r.top);
    x2 = Math.max(x2, r.right);
    y2 = Math.max(y2, r.bottom);
  }
  if (!Number.isFinite(x1)) return { x: 0, y: 0, width: 0, height: 0 };
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
};

/** Given a DOM element, pick the fiber the user most likely means. */
const selectableFiber = (el: Element, deepest: boolean): Fiber | null => {
  let fiber = fiberOfDom(el);
  // Climb to the host fiber of this element (text fibers etc.).
  while (fiber && !isHost(fiber)) fiber = fiber.return;
  if (!fiber) return null;
  if (deepest) return fiber;
  // Find the nearest ancestor with an editable stamp; then climb while the stamp is the same,
  // so a design-system instance is selected instead of the host element it forwards props to.
  let f: Fiber | null = fiber;
  while (f) {
    const s = stampOf(f);
    if (s && isEditable(parseStamp(s)) && (isHost(f) || isComponent(f))) break;
    f = f.return;
  }
  if (!f) return fiber;
  const stamp = stampOf(f);
  let top = f;
  for (let p = f.return; p; p = p.return) {
    if (stampOf(p) === stamp && isComponent(p)) top = p;
    else if (isHost(p) || (isComponent(p) && stampOf(p))) break;
  }
  return top;
};

// ---- Styles and provenance ----
type Decl = { order: number; props: Record<string, string> };
let classRules: Map<string, Decl[]> | null = null;
let rootTokens: Map<string, string> | null = null;

const expandShorthand = (prop: string, value: string, out: Record<string, string>) => {
  const parts = value.trim().split(/\s+(?![^(]*\))/);
  const four = (names: [string, string, string, string]) => {
    const a = parts[0] ?? value;
    const b = parts[1] ?? a;
    const c = parts[2] ?? a;
    const d = parts[3] ?? b;
    out[names[0]] = a;
    out[names[1]] = b;
    out[names[2]] = c;
    out[names[3]] = d;
  };
  switch (prop) {
    case "padding":
      four(["padding-top", "padding-right", "padding-bottom", "padding-left"]);
      break;
    case "margin":
      four(["margin-top", "margin-right", "margin-bottom", "margin-left"]);
      break;
    case "padding-inline":
      out["padding-left"] = parts[0] ?? value;
      out["padding-right"] = parts[1] ?? parts[0] ?? value;
      break;
    case "padding-block":
      out["padding-top"] = parts[0] ?? value;
      out["padding-bottom"] = parts[1] ?? parts[0] ?? value;
      break;
    case "margin-inline":
      out["margin-left"] = parts[0] ?? value;
      out["margin-right"] = parts[1] ?? parts[0] ?? value;
      break;
    case "margin-block":
      out["margin-top"] = parts[0] ?? value;
      out["margin-bottom"] = parts[1] ?? parts[0] ?? value;
      break;
    case "gap":
      out["row-gap"] = parts[0] ?? value;
      out["column-gap"] = parts[1] ?? parts[0] ?? value;
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
      four(["border-top-width", "border-right-width", "border-bottom-width", "border-left-width"]);
      break;
    case "border-color":
      four(["border-top-color", "border-right-color", "border-bottom-color", "border-left-color"]);
      break;
    case "border":
      for (const p of parts) {
        if (
          /^\d|^(thin|medium|thick)$/.test(p) ||
          p.startsWith("calc") ||
          p.startsWith("var(--tw-border")
        ) {
          expandShorthand("border-width", p, out);
        } else if (/^(none|solid|dashed|dotted|double|hidden)$/.test(p)) {
          out["border-style"] = p;
        } else {
          expandShorthand("border-color", p, out);
        }
      }
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
  "padding-block-start": "padding-top",
  "padding-block-end": "padding-bottom",
  "padding-inline-start": "padding-left",
  "padding-inline-end": "padding-right",
  "margin-block-start": "margin-top",
  "margin-block-end": "margin-bottom",
  "margin-inline-start": "margin-left",
  "margin-inline-end": "margin-right",
  "border-block-start-width": "border-top-width",
  "border-block-end-width": "border-bottom-width",
  "border-inline-start-width": "border-left-width",
  "border-inline-end-width": "border-right-width",
  "border-block-start-color": "border-top-color",
  "border-inline-start-color": "border-left-color",
  "border-start-start-radius": "border-top-left-radius",
  "border-start-end-radius": "border-top-right-radius",
  "border-end-end-radius": "border-bottom-right-radius",
  "border-end-start-radius": "border-bottom-left-radius",
  "inline-size": "width",
  "block-size": "height",
  "min-inline-size": "min-width",
  "min-block-size": "min-height",
  "max-inline-size": "max-width",
  "max-block-size": "max-height",
  "inset-inline-start": "left",
  "inset-inline-end": "right",
  "inset-block-start": "top",
  "inset-block-end": "bottom",
};

const collectRules = (
  rules: CSSRuleList,
  order: { n: number },
  into: Map<string, Decl[]>,
  tokens: Map<string, string>,
) => {
  for (const rule of Array.from(rules)) {
    if (rule instanceof CSSStyleRule) {
      const selector = rule.selectorText;
      const decls: Record<string, string> = {};
      for (let i = 0; i < rule.style.length; i += 1) {
        const p = rule.style[i];
        if (!p) continue;
        const v = rule.style.getPropertyValue(p);
        if (p.startsWith("--")) {
          if (/^:root|^:host|^html/.test(selector) || selector.includes(":root"))
            tokens.set(p, v.trim());
          continue;
        }
        expandShorthand(p, v, decls);
      }
      order.n += 1;
      if (Object.keys(decls).length) {
        for (const single of selector.split(/,(?![^(]*\))/)) {
          const m = /^\s*\.((?:\\.|[\w-])+)\s*$/.exec(single);
          if (!m?.[1]) continue;
          const cls = m[1].replaceAll(/\\(.)/g, "$1");
          const list = into.get(cls) ?? [];
          list.push({ order: order.n, props: decls });
          into.set(cls, list);
        }
      }
      // Nested rules (CSS nesting) are variants; skipped for base provenance.
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
  if (classRules && rootTokens) return;
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
  const m = /var\((--[\w-]+)/.exec(declared);
  return m?.[1];
};

const inspectFiber = (fiber: Fiber, id: string) => {
  ensureRules();
  const rules = classRules as Map<string, Decl[]>;
  const els = domNodesOf(fiber);
  const el = els[0];
  if (!el) return null;
  const stamp = stampOf(fiber);
  const source = parseStamp(stamp);
  const editable = isEditable(source);
  const ownClassName = fiber.memoizedProps?.className;
  const ownClasses =
    typeof ownClassName === "string" ? ownClassName.split(/\s+/).filter(Boolean) : [];
  const classes = Array.from(el.classList);
  const computed = getComputedStyle(el);
  const styles: Record<string, { value: string; provenance: Record<string, unknown> }> = {};

  // Which class sets which property: last declaration in stylesheet order wins.
  const winner: Record<string, { cls: string; declared: string; order: number }> = {};
  for (const cls of classes) {
    for (const decl of rules.get(cls) ?? []) {
      for (const [p, v] of Object.entries(decl.props)) {
        const cur = winner[p];
        if (!cur || decl.order >= cur.order) winner[p] = { cls, declared: v, order: decl.order };
      }
    }
  }
  const inline = (el as HTMLElement).style;
  for (const prop of INSPECTED) {
    const value = computed.getPropertyValue(prop);
    const w = winner[prop];
    let provenance: Record<string, unknown>;
    if (inline.getPropertyValue(prop)) {
      provenance = { kind: "inline", editable: false };
    } else if (w) {
      provenance = {
        kind: ownClasses.includes(w.cls) ? "utility" : "component",
        className: w.cls,
        token: tokenIn(w.declared),
        editable,
      };
    } else if (INHERITED.has(prop)) {
      provenance = { kind: "inherited", editable };
    } else {
      provenance = { kind: "default", editable };
    }
    styles[prop] = { value, provenance };
  }

  const props: Record<string, unknown> = {};
  if (isComponent(fiber)) {
    for (const [k, v] of Object.entries(fiber.memoizedProps ?? {})) {
      if (k === "children" || k === STAMP) continue;
      props[k] = serialise(v);
    }
  }

  let editableAncestor: { nodeId: string; name: string; source: SourceLocation } | null = null;
  if (!editable) {
    for (let p = fiber.return; p; p = p.return) {
      const s = parseStamp(stampOf(p));
      if (s && isEditable(s) && (isHost(p) || isComponent(p))) {
        editableAncestor = {
          nodeId: idFor(p),
          name: isHost(p) ? String(p.type) : componentName(p),
          source: s,
        };
        break;
      }
    }
  }

  return {
    nodeId: id,
    kind: isHost(fiber) ? "element" : "component",
    name: isHost(fiber) ? String(fiber.type) : componentName(fiber),
    source,
    editable,
    editableAncestor,
    rect: unionRect(els),
    classes,
    ownClasses,
    styles,
    props,
    text: isHost(fiber)
      ? directText(el)
      : typeof fiber.memoizedProps?.children === "string"
        ? fiber.memoizedProps.children
        : null,
  };
};

const serialise = (v: unknown): unknown => {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  if (typeof v === "function") return "ƒ";
  if (Array.isArray(v)) return v.map(serialise);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("$$typeof" in o) return "<element>";
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(o)) out[k] = serialise(val);
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
  if (tree) post({ type: "ed:tree", tree });
};

let watched: string[] = [];
let rectsScheduled = false;
const sendRects = () => {
  rectsScheduled = false;
  if (watched.length === 0) return;
  const rects: Record<string, { x: number; y: number; width: number; height: number }> = {};
  for (const id of watched) {
    const f = fiberFor(id);
    if (f) rects[id] = unionRect(domNodesOf(f));
  }
  post({ type: "ed:rects", rects });
};
const scheduleRects = () => {
  if (rectsScheduled) return;
  rectsScheduled = true;
  requestAnimationFrame(sendRects);
};

const scheduleAfterCommit = () => {
  if (commitScheduled) return;
  commitScheduled = true;
  queueMicrotask(() => {
    commitScheduled = false;
    sendTree();
    scheduleRects();
  });
};

// ---- Inline text editing ----
let editing: { el: HTMLElement; nodeId: string; original: string } | null = null;
const startTextEdit = (nodeId: string) => {
  const f = fiberFor(nodeId);
  if (!f) return;
  const el = domNodesOf(f)[0] as HTMLElement | undefined;
  if (!el) return;
  if (editing) finishTextEdit(false);
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
  if (!editing) return;
  const { el, nodeId, original } = editing;
  (editing as { cleanup?: () => void }).cleanup?.();
  editing = null;
  el.contentEditable = "false";
  el.removeAttribute("contenteditable");
  const text = el.textContent ?? "";
  if (commit && text !== original) post({ type: "ed:textCommit", nodeId, text });
  else el.textContent = original;
};

// ---- Handlers ----
window.addEventListener("message", (ev) => {
  const msg = ev.data as { type?: string } & Record<string, unknown>;
  if (!msg || typeof msg.type !== "string" || !msg.type.startsWith("ed:")) return;
  switch (msg.type) {
    case "ed:getTree":
      sendTree();
      break;
    case "ed:hitTest": {
      const x = msg.x as number;
      const y = msg.y as number;
      const el = document.elementFromPoint(x, y);
      const fiber = el ? selectableFiber(el, Boolean(msg.deepest)) : null;
      post({ type: "ed:hit", requestId: msg.requestId, nodeId: fiber ? idFor(fiber) : null });
      break;
    }
    case "ed:inspect": {
      const f = fiberFor(msg.nodeId as string);
      const result = f ? inspectFiber(f, msg.nodeId as string) : null;
      post({ type: "ed:inspect", requestId: msg.requestId, result });
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
        .then((dataUrl) => post({ type: "ed:screenshot", requestId: msg.requestId, dataUrl }))
        .catch(() => post({ type: "ed:screenshot", requestId: msg.requestId, dataUrl: null }));
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
      post({ type: "ed:tokens", tokens });
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
    childList: true,
    subtree: true,
    attributes: true,
    characterData: true,
  });
  window.addEventListener("scroll", scheduleRects, true);
  window.addEventListener("resize", scheduleRects);
  new ResizeObserver(scheduleRects).observe(document.documentElement);
  window.addEventListener("error", (e) => {
    post({
      type: "ed:error",
      error: { message: e.message, stack: e.error?.stack, file: e.filename, line: e.lineno },
    });
  });
  post({ type: "ed:ready", screen: config.screen });
};
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
else start();

// Public surface for the generated entry module (HMR notifications, render errors).
(window as unknown as { __ED__: unknown }).__ED__ = {
  notifyHmr() {
    invalidateRules();
    post({ type: "ed:hmr" });
    scheduleAfterCommit();
  },
  reportError(error: { message: string; stack?: string; file?: string; line?: number }) {
    post({ type: "ed:error", error });
  },
};
