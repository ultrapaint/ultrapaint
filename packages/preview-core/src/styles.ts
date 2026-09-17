/**
 * Where a computed style comes from: which class declared it, through which design token.
 * Reads the document's stylesheets only, so it works for any framework.
 */
const WHITESPACE_OUTSIDE_PARENS_RE = /\s+(?![^(]*\))/;
const COMMA_OUTSIDE_PARENS_RE = /,(?![^(]*\))/;
const BORDER_WIDTH_RE = /^\d|^(thin|medium|thick)$/;
const BORDER_STYLE_RE = /^(none|solid|dashed|dotted|double|hidden)$/;
const ROOT_SELECTOR_RE = /^:root|^:host|^html/;
const CLASS_SELECTOR_RE = /^\s*\.((?:\\.|[\w-])+)\s*$/;
const VAR_TOKEN_RE = /var\((--[\w-]+)/;

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

/** Stylesheets changed (HMR, a DOM mutation): read them again on the next inspection. */
export const invalidateRules = () => {
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

export interface InspectedStyle {
  provenance: Record<string, unknown>;
  value: string;
}

/** The inspected properties of an element, each with where its value comes from. */
export const inspectStyles = (
  el: Element,
  ownClasses: readonly string[],
  editable: boolean
): Record<string, InspectedStyle> => {
  ensureRules();
  const rules = classRules as Map<string, Decl[]>;
  const computed = getComputedStyle(el);
  const winner = winnersFor(Array.from(el.classList), rules);
  const inline = (el as HTMLElement).style;
  const styles: Record<string, InspectedStyle> = {};
  for (const prop of INSPECTED) {
    styles[prop] = {
      provenance: provenanceFor(
        prop,
        inline,
        winner[prop],
        [...ownClasses],
        editable
      ),
      value: computed.getPropertyValue(prop),
    };
  }
  return styles;
};

/** Custom properties declared on the root, resolved to what they currently compute to. */
export const readTokens = (): Record<string, string> => {
  ensureRules();
  const tokens: Record<string, string> = {};
  const computed = getComputedStyle(document.documentElement);
  for (const [name, raw] of rootTokens ?? []) {
    tokens[name] = computed.getPropertyValue(name).trim() || raw;
  }
  return tokens;
};
