/**
 * The canvas and the Code tab cannot drift: over every page of the repository's fixtures and
 * designs, as they are and with overrides at the breakpoints, every declaration the canvas draws
 * a node with is set by a class the writer gives it, to the same value, as Tailwind itself
 * compiles that class at that width; and every property a class sets is one the canvas draws.
 * And the classes read back: what the class reader models of a node's declarations, written as
 * classes and read by it, comes back the same.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { emptyDesignSystem } from "@ultrapaint/contracts/design-system";
import type { DesignNode } from "@ultrapaint/contracts/document";
import type { StyleAt } from "@ultrapaint/contracts/node-style";
import { spacingStepOf } from "@ultrapaint/contracts/token-table";
import {
  breakpointsUsed,
  DEFAULT_BREAKPOINTS,
  resolveAtBreakpoint,
} from "@ultrapaint/design-document/breakpoints";
import {
  baseStyle,
  declarationsOf,
  layoutOf,
  makeStyleContext,
  nodeStyle,
  type ParentLayout,
} from "@ultrapaint/design-document/css";
import { tokensIn } from "@ultrapaint/design-document/tokens";
import { childrenOf, walk } from "@ultrapaint/design-document/tree";
import { compile } from "tailwindcss";
import { beforeAll, describe, expect, it } from "vitest";
import { tailwindClasses } from "./node-classes.ts";
import { rulesOf, tailwindTheme } from "./testing.ts";
import { parseClass, printClass } from "./utilities.ts";

const ROOT = join(import.meta.dirname, "../../..");

/** The groups of `re` in `text`, or none. */
const groups = (re: RegExp, text: string): readonly (string | undefined)[] => {
  const match: RegExpExecArray | null = re.exec(text);
  return match === null ? [] : match.slice(1);
};
const PAGE_DIRS = ["docs/designs"];
const UPPER_RE = /[A-Z]/g;
const TW_VAR_RE = /var\((--tw-[\w-]+)\)/g;
const PROPERTY_RE =
  /@property (--tw-[\w-]+)\s*\{[^}]*initial-value:\s*([^;]+);/g;
const PROPERTY_BLOCK_RE = /@property[^{]*\{[^}]*\}/g;
const FALLBACK_RE = /var\(--[\w.-]+,/;
const VARIABLE_RE = /^var\((--[\w.-]+)\)$/;
const COMMA_RE = /,\s*/g;
const THEME_RE = /(--[\w.-]+)\s*:\s*([^;]+);/g;
const SPACES_RE = /\s+/g;
const PX_RE = /^(-?[\d.]+)(px|rem)$/;
const STEP_RE = /^calc\(var\(--spacing\) \* (-?[\d.]+)\)$/;

const ds = {
  ...emptyDesignSystem(),
  typography: {
    fonts: [],
    sizes: [{ lineHeight: "1.75rem", name: "text-lg", value: "1.125rem" }],
    styles: [
      {
        name: "Title",
        role: "heading" as const,
        size: "$text-lg",
        weight: 700,
      },
      {
        group: "body" as const,
        lineHeight: "$leading-relaxed",
        name: "Body lg",
        role: "paragraph" as const,
        size: "$text-lg",
        weight: "$font-weight-normal",
      },
    ],
    weights: [],
  },
};
const writer = tailwindClasses(ds);
const breakpoints = DEFAULT_BREAKPOINTS;
const minOf = (name: string | null) =>
  breakpoints.find((b) => b.name === name)?.min ?? 0;

/** Values a property starts at, which need no class. */
const INITIAL: Record<string, string> = {
  "border-color": "currentColor",
  "flex-direction": "row",
  "flex-grow": "0",
  "flex-wrap": "nowrap",
};

/** The properties a shorthand sets, so both sides are compared property by property. */
const LONGHANDS: Record<string, readonly string[]> = {
  flex: ["flex-grow", "flex-shrink", "flex-basis"],
  margin: ["margin-top", "margin-right", "margin-bottom", "margin-left"],
  "margin-block": ["margin-top", "margin-bottom"],
  "margin-inline": ["margin-left", "margin-right"],
  padding: ["padding-top", "padding-right", "padding-bottom", "padding-left"],
  "padding-block": ["padding-top", "padding-bottom"],
  "padding-inline": ["padding-left", "padding-right"],
};

/** What the canvas's `background` is in Tailwind: a colour, or an image for a gradient. */
const BACKGROUNDS = ["background-color", "background-image"];

const kebab = (property: string) =>
  property.replace(UPPER_RE, (c) => `-${c.toLowerCase()}`);

/**
 * `var(--x, fallback)` as `var(--x)`; `var(--tw-…, fallback)` as what the classes set it to,
 * else its fallback.
 */
const withoutFallbacks = (
  value: string,
  custom: ReadonlyMap<string, string> = new Map()
): string => {
  let out = value;
  for (;;) {
    const at = out.search(FALLBACK_RE);
    if (at < 0) {
      return out;
    }
    const comma = out.indexOf(",", at);
    let depth = 1;
    let end = comma + 1;
    for (; end < out.length && depth > 0; end += 1) {
      if (out[end] === "(") {
        depth += 1;
      } else if (out[end] === ")") {
        depth -= 1;
      }
    }
    const name = out.slice(at + 4, comma);
    const replaced = name.startsWith("--tw-")
      ? (custom.get(name) ?? out.slice(comma + 1, end - 1).trim())
      : `var(${name})`;
    out = `${out.slice(0, at)}${replaced}${out.slice(end)}`;
  }
};

/** Tailwind's own variables as the classes set them, else as they start (`@property`). */
const withTailwindVariables = (
  value: string,
  custom: ReadonlyMap<string, string>,
  initial: ReadonlyMap<string, string>
) =>
  withoutFallbacks(value, custom).replace(
    TW_VAR_RE,
    (whole, name: string) => custom.get(name) ?? initial.get(name) ?? whole
  );

/** A value both sides can be compared by; null when it cannot be worked out here. */
const normal = (
  property: string,
  value: string,
  tailwind: {
    readonly initial: ReadonlyMap<string, string>;
    readonly theme: ReadonlyMap<string, string>;
  },
  custom: ReadonlyMap<string, string> = new Map()
): string | null => {
  let v = withTailwindVariables(value.trim(), custom, tailwind.initial).replace(
    SPACES_RE,
    " "
  );
  const [named] = groups(VARIABLE_RE, v);
  // A weight of Tailwind's theme is its number: `font-bold` is 700.
  if (named?.startsWith("--font-weight-")) {
    v = tailwind.theme.get(named) ?? v;
  }
  const [step] = groups(
    STEP_RE,
    v === "var(--spacing)" ? "calc(var(--spacing) * 1)" : v
  );
  if (step !== undefined) {
    return `${Number(step) * 4}px`;
  }
  const [amount, unit] = groups(PX_RE, v);
  if (amount !== undefined) {
    return `${Number(amount) * (unit === "rem" ? 16 : 1)}px`;
  }
  if (v === "0") {
    return "0px";
  }
  if (property === "opacity" && v.endsWith("%")) {
    return String(Number(v.slice(0, -1)) / 100);
  }
  if (v.includes("--tw-") || v.includes("calc(") || v.includes("infinity")) {
    return null;
  }
  return v.replace(COMMA_RE, ",").toLowerCase();
};

/** A class's variants, and its utility as Tailwind names the rule it compiles. */
const split = (cls: string) => {
  const { variants, ...utility } = parseClass(cls);
  return { utility: printClass(utility), variants };
};

/** Whether a class applies at a width, and from which width it takes over. */
const appliesAt = (variants: readonly string[], width: number) =>
  variants.every((v) =>
    v.startsWith("max-") ? width < minOf(v.slice(4)) : width >= minOf(v)
  );
const fromWidth = (variants: readonly string[]) =>
  Math.max(0, ...variants.filter((v) => !v.startsWith("max-")).map(minOf));

/** Deterministic overrides at the breakpoints, so the classes of every width are checked. */
const withOverrides = (root: DesignNode): DesignNode => {
  let n = 0;
  const visit = (node: DesignNode): DesignNode => {
    const k = n;
    n += 1;
    const kids = childrenOf(node).map(visit);
    const out: Record<string, unknown> = {
      ...node,
      ...("children" in node && { children: kids }),
    };
    const at: Record<string, Record<string, unknown>> = {};
    const stack = node.type === "row" || node.type === "column";
    switch (k % 7) {
      case 0:
        if (stack) {
          at.md = { gap: 24, type: node.type === "row" ? "column" : "row" };
        }
        break;
      case 1:
        at.lg = { hidden: true };
        break;
      case 2:
        at.md = {
          padding: { left: 8, right: 8 },
          width: node.width === "fill" ? "hug" : "fill",
        };
        break;
      case 3:
        out.hidden = true;
        at.md = { hidden: false };
        break;
      case 4:
        if (node.type === "text") {
          out.textStyle = "Title";
          at.lg = { size: "$text-lg" };
        } else {
          at.sm = { fill: "$color-primary", radius: 8 };
        }
        break;
      case 5:
        at.md = { height: node.height === "fill" ? 40 : "fill", order: -1 };
        at.xl = { height: "hug" };
        break;
      default:
        if (node.type === "text") {
          out.textStyle = "Body lg";
          at.md = { color: "$color-muted-foreground", weight: 600 };
        } else {
          at.md = { border: { style: "dashed", width: 2 }, opacity: 0.5 };
        }
    }
    if (Object.keys(at).length > 0) {
      out.at = at;
    }
    return out as unknown as DesignNode;
  };
  return visit(root);
};

const pages = (): { file: string; root: DesignNode }[] =>
  PAGE_DIRS.flatMap((dir) =>
    readdirSync(join(ROOT, dir), { recursive: true })
      .map(String)
      .filter((file) => file.endsWith(".page.json"))
      .sort()
      .map((file) => ({
        file: `${dir}/${file}`,
        root: JSON.parse(readFileSync(join(ROOT, dir, file), "utf8")).root,
      }))
  );

/** A node at every level the page sets anything at, with how its parent lays it out there. */
interface Written {
  readonly at: readonly {
    readonly node: DesignNode;
    readonly parent: ParentLayout;
    readonly width: number;
  }[];
  readonly classes: readonly string[];
  readonly where: string;
}

const writtenNodes = (file: string, root: DesignNode): Written[] => {
  const levels = [
    null,
    ...breakpointsUsed(root, breakpoints).map((b) => b.name),
  ];
  const trees = levels.map((name) => {
    const tree = resolveAtBreakpoint(root, breakpoints, name);
    const parents = new Map<string, ParentLayout>([[tree.id, "free"]]);
    const nodes = new Map<string, DesignNode>();
    for (const node of walk(tree)) {
      nodes.set(node.id, node);
      for (const child of childrenOf(node)) {
        parents.set(
          child.id,
          node.type === "instance" ? "block" : layoutOf(node)
        );
      }
    }
    return { nodes, parents, width: minOf(name) };
  });
  return Array.from(walk(root), (node) => {
    const at = trees.map(({ nodes, parents, width }) => ({
      node: nodes.get(node.id) ?? node,
      parent: parents.get(node.id) ?? "free",
      width,
    }));
    const styles = at.map(
      (level, i): StyleAt => ({
        breakpoint: levels[i] ?? null,
        declarations: declarationsOf(
          level.node,
          makeStyleContext(ds, level.parent)
        ),
      })
    );
    return {
      at,
      classes: writer.classes(styles),
      where: `${file} ${node.id}`,
    };
  });
};

/**
 * Tailwind's utilities with its own theme and the tokens the pages name, as the application's
 * stylesheet declares them (their values do not matter: classes are compared by variable).
 */
const compiled = async (
  utilities: readonly string[],
  tokens: ReadonlySet<string>
) => {
  const themeCss = tailwindTheme();
  const theme = new Map(
    Array.from(themeCss.matchAll(THEME_RE), (m) => [m[1] ?? "", m[2] ?? ""])
  );
  const declared = [...tokens]
    .filter((name) => !theme.has(`--${name}`) && spacingStepOf(name) === null)
    .map((name) => `--${name}: ${name.startsWith("color-") ? "#000" : "1px"};`);
  const css = await compile(
    `${themeCss}\n@theme { ${declared.join(" ")} }\n@tailwind utilities;`,
    {}
  );
  const built = css.build([...utilities]);
  const initial = new Map(
    Array.from(built.matchAll(PROPERTY_RE), (m) => [
      m[1] ?? "",
      (m[2] ?? "").trim(),
    ])
  );
  const out = built
    .split("@layer properties {")[0]
    ?.replace(PROPERTY_BLOCK_RE, "");
  return { initial, sets: rulesOf(out ?? ""), theme };
};

/** Whether a value is several, `8px 16px`, rather than one, `calc(var(--spacing) * 4)`. */
const spacedAtTop = (value: string) => {
  let depth = 0;
  for (const char of value) {
    if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
    } else if (char === " " && depth === 0) {
      return true;
    }
  }
  return false;
};

/** A side's declarations, shorthands as their longhands (a value split across them). */
const longhands = (
  declarations: Iterable<readonly [string, string]>
): Map<string, string> => {
  const out = new Map<string, string>();
  for (const [property, value] of declarations) {
    if (property.startsWith("--")) {
      continue;
    }
    const parts = LONGHANDS[property];
    const single = !spacedAtTop(value.trim());
    if (parts && (single || property === "flex")) {
      for (const part of parts) {
        out.set(part, property === "flex" ? "" : value);
      }
    } else {
      out.set(property, value);
    }
  }
  return out;
};

describe("the canvas and the Code tab", () => {
  const roots = pages().flatMap(({ file, root }) => [
    { file, root },
    { file: `${file} (breakpoints)`, root: withOverrides(root) },
  ]);
  const written = roots.flatMap(({ file, root }) => writtenNodes(file, root));
  const tokens = tokensIn([...roots.map((r) => r.root), ds]);
  let tailwind: Awaited<ReturnType<typeof compiled>>;

  beforeAll(async () => {
    const utilities = new Set(
      written.flatMap((w) => w.classes.map((cls) => split(cls).utility))
    );
    tailwind = await compiled([...utilities], tokens);
  });

  it("covers a node's every declaration with a class Tailwind gives the same value", () => {
    const problems: string[] = [];
    for (const { at, classes, where } of written) {
      for (const { node, parent, width } of at) {
        const drawn = nodeStyle(node, makeStyleContext(ds, parent));
        const base = baseStyle(node);
        const canvas = longhands(
          Object.entries(drawn).map(([p, v]) => [kebab(p), v] as const)
        );
        const ownBase = new Set(
          Object.entries(base)
            .filter(([p, v]) => drawn[p] === v)
            .flatMap(([p]) => [
              ...longhands([[kebab(p), base[p] ?? ""]]).keys(),
            ])
        );
        // Who sets each property at this width, the class of the widest variant winning.
        const setBy = new Map<
          string,
          { from: number; value: string; cls: string }[]
        >();
        // Tailwind's own variables the classes set (`--tw-leading`), the widest variant winning.
        const custom = new Map<string, string>();
        const customFrom = new Map<string, number>();
        for (const cls of classes) {
          const { utility, variants } = split(cls);
          if (!appliesAt(variants, width)) {
            continue;
          }
          const sets = tailwind.sets.get(utility);
          if (sets === undefined || sets.size === 0) {
            problems.push(`${where}: Tailwind generates nothing for ${cls}`);
            continue;
          }
          for (const [p, v] of sets) {
            const from = fromWidth(variants);
            if (p.startsWith("--tw-") && from >= (customFrom.get(p) ?? 0)) {
              custom.set(p, v);
              customFrom.set(p, from);
            }
          }
          for (const [p, v] of longhands(sets)) {
            const list = setBy.get(p) ?? [];
            list.push({ cls, from: fromWidth(variants), value: v });
            setBy.set(p, list);
          }
        }
        const check = (property: string, value: string) => {
          if (ownBase.has(property) || INITIAL[property] === value) {
            return;
          }
          const setters =
            property === "background"
              ? BACKGROUNDS.flatMap((p) => setBy.get(p) ?? [])
              : (setBy.get(property) ?? []);
          if (setters.length === 0) {
            problems.push(
              `${where} @${width}: ${property}: ${value} has no class (${classes.join(" ")})`
            );
            return;
          }
          const top = Math.max(...setters.map((s) => s.from));
          const winners = setters.filter((s) => s.from === top);
          const [winner] = winners;
          if (
            winner === undefined ||
            winners.length > 1 ||
            winner.value === ""
          ) {
            return;
          }
          // The page's frame stands for the screen.
          const drawnValue =
            node.type === "page" &&
            property === "min-height" &&
            value === "100%"
              ? "100vh"
              : value;
          const a = normal(property, drawnValue, tailwind);
          const b = normal(property, winner.value, tailwind, custom);
          if (a !== null && b !== null && a !== b) {
            problems.push(
              `${where} @${width}: ${property} is ${value} on the canvas, ${winner.value} by ${winner.cls}`
            );
          }
        };
        for (const [property, value] of canvas) {
          check(property, value);
        }
        for (const property of setBy.keys()) {
          const drawnHere =
            canvas.has(property) ||
            (BACKGROUNDS.includes(property) && canvas.has("background"));
          if (!drawnHere) {
            problems.push(
              `${where} @${width}: ${property} is set by a class, not drawn (${classes.join(" ")})`
            );
          }
        }
      }
    }
    expect(problems.slice(0, 20)).toEqual([]);
    expect(written.length).toBeGreaterThan(4000);
  });
});
