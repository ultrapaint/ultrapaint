/**
 * A node as code: the JSX the rules agents implement a page by (the `/implement` briefing) turn
 * it into, its look in the classes of the project's style system. The application's code is
 * still written by an agent, in the repository's own conventions (ADR 0015); this is the
 * reference translation the editor shows, so a user can see what a design means before an agent
 * writes it. The markup, the imports, the names and each element's declarations at every
 * breakpoint (`css.ts`) are the same whatever the style system; the classes are its own, through
 * a `ClassWriter` (ADR 0024): Tailwind v4's is `@ultrapaint/style-tailwind-v4/node-classes`.
 * A system component is written as the application's own component for it, its slots as that
 * component's parts (ADR 0040), and an app component as the application's component of its name,
 * its properties as props (ADR 0041): a sketch an implementing agent adapts to what the
 * application has.
 */
import type { JsonValue } from "@ultrapaint/contracts/base";
import {
  applicationFileOf,
  applicationNameOf,
  type Catalogue,
  metaOf,
} from "@ultrapaint/contracts/catalogue";
import { APP_FROM, SYSTEM_FROM } from "@ultrapaint/contracts/component-names";
import type { DesignSystem } from "@ultrapaint/contracts/design-system";
import type { DesignNode, InstanceNode } from "@ultrapaint/contracts/document";
import type {
  ClassWriter,
  Declarations,
} from "@ultrapaint/contracts/node-style";
import {
  type Breakpoint,
  breakpointsUsed,
  resolveAtBreakpoint,
  upTo,
} from "./breakpoints.ts";
import {
  declarationsOf,
  layoutOf,
  makeStyleContext,
  maskOf,
  type ParentLayout,
  type StyleContext,
  tagOf,
} from "./css.ts";
import { fillSlots, slotLayoutOf } from "./slots.ts";
import { childrenOf, nodeLabel, walk } from "./tree.ts";

const INDENT = "  ";
/** Past this width an opening tag puts each attribute on a line of its own. */
const LINE_WIDTH = 80;

/** What JSX text would read as markup or an expression, or would collapse. */
const JSX_UNSAFE_RE = /[{}<>\n]|^\s|\s$/;
/** What JSX decodes in text and in a quoted attribute: `&amp;`, `&#169;`. */
const ENTITY_RE = /&(?:#\d+|#x[\da-f]+|[a-z][a-z\d]*);/i;
const ATTRIBUTE_NAME_RE = /^[A-Za-z_$][\w$-]*$/;
const IDENTIFIER_RE = /^[A-Za-z_$][\w$]*$/;
const WORD_RE = /[A-Za-z0-9]+/g;

export interface CodeOptions {
  /**
   * The design system's breakpoints (ADR 0036): what a node sets at one is written with its
   * prefix (`md:`). Left out, a node is written as its smallest screen has it.
   */
  readonly breakpoints?: readonly Breakpoint[] | undefined;
  /**
   * The components (ADR 0042): how the slot each of an instance's children fills lays it out.
   * Left out, an instance lays its children out as a block.
   */
  readonly catalogue?: Catalogue | undefined;
  /**
   * Name of the function a page is written as; given, a page node becomes that component.
   * Left out, the page is written as its markup alone.
   */
  readonly component?: string | undefined;
  /**
   * Where the application's own components for the system components are imported from
   * (`componentsImportBase`); `@/components/ui` when left out.
   */
  readonly componentsFrom?: string | undefined;
  /** The design system the node is drawn with, whose text styles a text is set in. */
  readonly designSystem?: DesignSystem | null | undefined;
  /**
   * The `href` a link is written with: a link naming a page file is the URL that page serves.
   * Left out, the link is written as it is.
   */
  readonly hrefOf?: ((link: string) => string) | undefined;
  /** How the node's parent lays it out, which `fill` and `hug` are relative to. */
  readonly parent?: ParentLayout | undefined;
}

/** What writing every node of one call needs. */
interface Writing {
  /** The tree at each level, by node id: the base first, then each breakpoint it sets. */
  readonly at: readonly ReadonlyMap<string, DesignNode>[];
  readonly classes: ClassWriter;
  readonly hrefOf: (link: string) => string;
  /** How the instance or the part a child is in lays it out, by the child's id, at each level. */
  readonly inSlots: InSlots;
  /** The base (null), then the breakpoints the tree sets anything at, smallest first. */
  readonly levels: readonly (string | null)[];
  /** The design system's text styles and tokens, made once. */
  readonly styles: StyleContext;
}

/** How the slot each instance's child fills lays it out, by the child's id, at each level. */
type InSlots = Map<string, readonly ParentLayout[]>;
/** The module each instance's component is imported from, by the instance's id. */
type Modules = Map<string, string>;

/** The levels a tree is written at: the base, then each breakpoint it sets, with what holds at each. */
interface Levels {
  readonly breakpoints: readonly Breakpoint[];
  readonly names: readonly (string | null)[];
}

// ---- System components as the application's components ----

const DEFAULT_COMPONENTS_FROM = "@/components/ui";
const PROPERTY_WORD_RE = /[\s_-]+(\w)/g;
const FIRST_UPPER_RE = /^[A-Z]/;

/**
 * Where the application's own component for a system component is imported from (ADR 0040): the first
 * component directory's `ui/`, a `src/` in it (inside the application) written as the `@/`
 * alias Vite and shadcn applications set up; `@/components/ui` without one. A sketch, as the
 * whole Code tab is: the implementing agent finds where the application's components are.
 */
export const componentsImportBase = (settings: {
  readonly libraryDirs: readonly string[];
  readonly resolveFrom?: string | undefined;
}): string => {
  const [dir] = settings.libraryDirs;
  if (dir === undefined) {
    return DEFAULT_COMPONENTS_FROM;
  }
  const app = settings.resolveFrom;
  const inApp =
    app !== undefined && dir.startsWith(`${app}/`)
      ? dir.slice(app.length + 1)
      : dir;
  const written = inApp.startsWith("src/") ? `@/${inApp.slice(4)}` : inApp;
  return `${written}/ui`;
};

/** Where an instance's component is written, and what is learnt writing it. */
interface Written {
  readonly base: string;
  readonly catalogue: Catalogue;
  /** How the slot each instance's child fills lays it out. */
  readonly inSlots: InSlots;
  readonly levels: Levels;
  /** The module each instance's component, or part, is imported from. */
  readonly modules: Modules;
}

/**
 * A tree with each system component written as the application's component for it (ADR 0040): imported
 * from `base`'s file of its name (`@/components/ui/dialog`), the children that fill each named
 * slot (`fillSlots`, as the canvas draws them) in that component's part (`DialogFooter` for
 * `dialog-footer`, `DialogTrigger` for `trigger`), in the component's order.
 */
const asApplicationCode = (node: DesignNode, w: Written): DesignNode => {
  if (node.type !== "instance") {
    return isParent(node)
      ? ({
          ...node,
          children: node.children.map((c) => asApplicationCode(c, w)),
        } as DesignNode)
      : node;
  }
  const { catalogue, inSlots, levels } = w;
  // The instance at each level: its variant may turn with a breakpoint, its slot's layout too.
  const atLevels = levels.names.map((name) => ({
    holding: upTo(levels.breakpoints, name),
    instance: resolveAtBreakpoint(
      node,
      levels.breakpoints,
      name
    ) as InstanceNode,
  }));
  for (const child of node.children ?? []) {
    inSlots.set(
      child.id,
      atLevels.map(
        ({ holding, instance }) =>
          slotLayoutOf(instance, child.slot, catalogue, holding) ?? "block"
      )
    );
  }
  const children = (node.children ?? []).map((c) => asApplicationCode(c, w));
  return node.from === APP_FROM
    ? asAppComponentCode(node, children, w)
    : asSystemComponentCode(node, children, w);
};

/**
 * A system component's instance as the application's component for it, its children written
 * already (`children`, by id), each named slot's in that component's part.
 */
const asSystemComponentCode = (
  node: InstanceNode,
  children: readonly DesignNode[],
  w: Written
): DesignNode => {
  const from = `${w.base}/${applicationFileOf(node.component)}`;
  w.modules.set(node.id, from);
  const entry = metaOf(w.catalogue, node);
  if (!(entry && node.children)) {
    return node.children ? { ...node, children } : node;
  }
  const written = new Map(
    children.map((c) => {
      const { slot: _slot, ...unslotted } = c;
      return [c.id, unslotted as DesignNode] as const;
    })
  );
  return {
    ...node,
    children: [...fillSlots(node, entry.slots)].flatMap(([slot, fill]) => {
      const held = fill.nodes.flatMap((c) => written.get(c.id) ?? []);
      if (entry.slots.find((s) => s.name === slot)?.holds === "default") {
        return held;
      }
      const id = `${node.id}-${slot}`;
      w.modules.set(id, from);
      return [
        {
          children: held,
          component: applicationNameOf(node.component, slot),
          from: SYSTEM_FROM,
          id,
          type: "instance",
        } satisfies InstanceNode,
      ];
    }),
  };
};

/** A property's name as a prop: `confirm label` is `confirmLabel`. */
const propNameOf = (name: string) =>
  name
    .trim()
    .replace(PROPERTY_WORD_RE, (_, c: string) => c.toUpperCase())
    .replace(FIRST_UPPER_RE, (c) => c.toLowerCase());

/**
 * An app component's instance (ADR 0041) as the application's component of its name, beside the
 * system components' (`@/components/order-summary` for `@/components/ui`): its property values
 * as props, its children as they fill its slots.
 */
const asAppComponentCode = (
  node: InstanceNode,
  children: DesignNode[],
  w: Written
): DesignNode => {
  const parent = w.base.endsWith("/ui") ? w.base.slice(0, -3) : w.base;
  w.modules.set(node.id, `${parent}/${applicationFileOf(node.component)}`);
  const props = node.props
    ? Object.fromEntries(
        Object.entries(node.props).map(([name, value]) => [
          propNameOf(name),
          value,
        ])
      )
    : undefined;
  return {
    ...node,
    ...(props && { props }),
    ...(node.children && { children }),
  };
};

const isParent = (
  node: DesignNode
): node is Extract<DesignNode, { children: readonly DesignNode[] }> =>
  "children" in node && Array.isArray(node.children);

// ---- Imports ----

/**
 * The imports the visible instances under a node need, one statement per module, each component
 * by its name: a component's name is unique among the system and the app components (ADR 0041).
 */
const importsFor = (
  root: DesignNode,
  modules: Modules,
  hidden: (node: DesignNode) => boolean
): string[] => {
  const named = new Map<string, Set<string>>();
  const visit = (node: DesignNode) => {
    if (hidden(node)) {
      return;
    }
    const from = node.type === "instance" ? modules.get(node.id) : undefined;
    if (node.type === "instance" && from !== undefined) {
      named.set(from, (named.get(from) ?? new Set()).add(node.component));
    }
    for (const child of childrenOf(node)) {
      visit(child);
    }
  };
  visit(root);
  return [...named.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([from, names]) =>
        `import { ${[...names].sort((a, b) => a.localeCompare(b)).join(", ")} } from ${JSON.stringify(from)};`
    );
};

// ---- JSX ----

type Child =
  | { readonly kind: "element"; readonly element: Element }
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "comment"; readonly text: string };

interface Element {
  readonly attributes: readonly string[];
  readonly children: readonly Child[];
  readonly tag: string;
}

const element = (
  tag: string,
  attributes: readonly string[],
  children: readonly Child[] = []
): Child => ({ element: { attributes, children, tag }, kind: "element" });

/** Text as a JSX child: as it is, or as a string expression when JSX would read it otherwise. */
const jsxText = (text: string) =>
  JSX_UNSAFE_RE.test(text) || ENTITY_RE.test(text)
    ? `{${JSON.stringify(text)}}`
    : text;

/** An attribute's string: quoted, or an expression when JSX would read an entity or a quote. */
const stringAttribute = (name: string, value: string) =>
  value.includes('"') || value.includes("\\") || ENTITY_RE.test(value)
    ? `${name}={${JSON.stringify(value)}}`
    : `${name}="${value}"`;

const propAttribute = (name: string, value: JsonValue): string => {
  if (typeof value === "string") {
    return stringAttribute(name, value);
  }
  if (value === true) {
    return name;
  }
  return `${name}={${JSON.stringify(value)}}`;
};

const classAttribute = (classes: readonly string[]) =>
  classes.length > 0 ? [stringAttribute("className", classes.join(" "))] : [];

/** An instance's props as attributes; names JSX cannot hold go in a spread. */
const propAttributes = (
  props: InstanceNode["props"],
  classes: readonly string[]
): string[] => {
  const out: string[] = [];
  const spread: Record<string, JsonValue> = {};
  let className = classes.join(" ");
  for (const [name, value] of Object.entries(props ?? {})) {
    if (name === "children") {
      continue;
    }
    if (name === "className" && typeof value === "string") {
      className = [value, className].filter(Boolean).join(" ");
    } else if (ATTRIBUTE_NAME_RE.test(name)) {
      out.push(propAttribute(name, value));
    } else {
      spread[name] = value;
    }
  }
  if (Object.keys(spread).length > 0) {
    out.push(`{...${JSON.stringify(spread)}}`);
  }
  if (className) {
    out.push(stringAttribute("className", className));
  }
  return out;
};

// ---- Breakpoints ----

/** A node at a level: as the tree is drawn at that breakpoint. */
const nodeAt = (node: DesignNode, w: Writing, level: number): DesignNode =>
  w.at[level]?.get(node.id) ?? node;

/** Hidden at every level: what the application leaves out. */
const hiddenEverywhere = (node: DesignNode, w: Writing) =>
  w.levels.every((_, level) => nodeAt(node, w, level).hidden);

/** How a node lays out a child at a level: an instance, or a part of one, as the slot it fills does. */
const childLayoutOf = (
  node: DesignNode,
  child: DesignNode,
  w: Writing,
  level: number
): ParentLayout =>
  node.type === "instance"
    ? (w.inSlots.get(child.id)?.[level] ?? "block")
    : layoutOf(node);

/** What its parent lays a node out as, at each level. */
type Parents = readonly ParentLayout[];

const childrenFor = (node: DesignNode, w: Writing): Child[] =>
  childrenOf(node).flatMap((child) =>
    childFor(
      child,
      w,
      w.levels.map((_, level) =>
        childLayoutOf(nodeAt(node, w, level), child, w, level)
      )
    )
  );

/** A node below the one written: hidden ones are left out, and say so. */
const childFor = (node: DesignNode, w: Writing, parents: Parents): Child[] =>
  hiddenEverywhere(node, w)
    ? [{ kind: "comment", text: `Hidden: ${nodeLabel(node)}` }]
    : jsxOf(node, w, parents);

/** A link is a plain anchor here: in the application it is its router's own link. */
const linked = (node: DesignNode, w: Writing, child: Child): Child =>
  node.link
    ? element("a", [stringAttribute("href", w.hrefOf(node.link))], [child])
    : child;

/** What a node shows that classes cannot change: its text, its picture, its props. */
const contentOf = (node: DesignNode): string => {
  switch (node.type) {
    case "text":
      return node.text;
    case "image":
      return `${node.src}\0${node.alt ?? ""}`;
    case "instance":
      return JSON.stringify([node.props ?? null, node.text ?? null]);
    default:
      return "";
  }
};

/** An element's classes, from its declarations at each level. */
const classesOf = (
  w: Writing,
  styles: readonly Declarations[]
): readonly string[] =>
  w.classes.classes(
    styles.map((declarations, level) => ({
      breakpoint: w.levels[level] ?? null,
      declarations,
    }))
  );

/**
 * A node as JSX. One whose text, picture or props differ between breakpoints is written once
 * for each run of levels that shows the same, hidden at the others (ADR 0036).
 */
const jsxOf = (node: DesignNode, w: Writing, parents: Parents): Child[] => {
  const levels = w.levels.map((_, level) => nodeAt(node, w, level));
  const styles = levels.map((n, level) =>
    declarationsOf(n, { ...w.styles, parent: parents[level] ?? "free" })
  );
  const contents = levels.map(contentOf);
  const runs: number[][] = [];
  contents.forEach((content, level) => {
    const last = runs.at(-1);
    if (last && contents[last[0] ?? 0] === content) {
      last.push(level);
    } else {
      runs.push([level]);
    }
  });
  if (runs.length === 1) {
    return [jsxShowing(node, w, styles)];
  }
  return runs.flatMap((run) => {
    const first = run[0] ?? 0;
    const lastLevel = run.at(-1) ?? first;
    const shown = levels[first] ?? node;
    if (shown.hidden && run.every((level) => levels[level]?.hidden)) {
      return [];
    }
    // Outside its run, the element is hidden, styled as the run's nearest end.
    const runStyles = styles.map((style, level) =>
      run.includes(level)
        ? style
        : { ...styles[level < first ? first : lastLevel], display: "none" }
    );
    return [jsxShowing(shown, w, runStyles)];
  });
};

/** A node as JSX with its declarations at each level, what it shows as `node` has it. */
const jsxShowing = (
  node: DesignNode,
  w: Writing,
  styles: readonly Declarations[]
): Child => {
  const classes = classesOf(w, styles);
  switch (node.type) {
    case "text":
      return linked(
        node,
        w,
        element(tagOf(node), classAttribute(classes), [
          { kind: "text", text: jsxText(node.text) },
        ])
      );
    case "image":
      if (node.tint !== undefined) {
        // An icon in a colour: its file as a mask over the tint, which is its background.
        return linked(
          node,
          w,
          element("span", [
            stringAttribute("aria-label", node.alt ?? ""),
            ...classAttribute(classes),
            stringAttribute("role", "img"),
            `style={${JSON.stringify(maskOf(node.src))}}`,
          ])
        );
      }
      return linked(
        node,
        w,
        element("img", [
          stringAttribute("alt", node.alt ?? ""),
          ...classAttribute(classes),
          stringAttribute("src", node.src),
        ])
      );
    case "instance": {
      const children = childrenOf(node);
      let content: Child[] = [];
      if (children.length > 0) {
        content = childrenFor(node, w);
      } else if (node.text) {
        content = [{ kind: "text", text: jsxText(node.text) }];
      }
      return linked(
        node,
        w,
        element(node.component, propAttributes(node.props, classes), content)
      );
    }
    default: {
      // A container that is a link is the anchor itself, so it keeps its place in the layout.
      const attributes = node.link
        ? [
            stringAttribute("href", w.hrefOf(node.link)),
            ...classAttribute(classes),
          ]
        : classAttribute(classes);
      return element(node.link ? "a" : "div", attributes, childrenFor(node, w));
    }
  }
};

const printChild = (child: Child, depth: number): string[] => {
  const pad = INDENT.repeat(depth);
  if (child.kind === "text") {
    return [`${pad}${child.text}`];
  }
  if (child.kind === "comment") {
    return [`${pad}{/* ${child.text.replaceAll("*/", "* /")} */}`];
  }
  const { attributes, children, tag } = child.element;
  const inline = attributes.map((a) => ` ${a}`).join("");
  const fits = pad.length + tag.length + inline.length + 3 <= LINE_WIDTH;
  const opening =
    fits || attributes.length === 0
      ? [`${pad}<${tag}${inline}`]
      : [`${pad}<${tag}`, ...attributes.map((a) => `${pad}${INDENT}${a}`), pad];
  const last = opening.length - 1;
  const head = opening.slice(0, last);
  const tail = opening[last] ?? pad;
  const glue = tail === pad ? "" : " ";
  if (children.length === 0) {
    return [...head, `${tail}${glue}/>`];
  }
  const [only] = children;
  if (fits && children.length === 1 && only?.kind === "text") {
    const line = `${tail}>${only.text}</${tag}>`;
    if (line.length <= LINE_WIDTH) {
      return [line];
    }
  }
  return [
    ...head,
    `${tail}>`,
    ...children.flatMap((c) => printChild(c, depth + 1)),
    `${pad}</${tag}>`,
  ];
};

/** `/settings/billing` → `SettingsBillingPage`, `/` → `HomePage`. */
export const pageComponentName = (route: string): string => {
  const words = route.match(WORD_RE) ?? [];
  const name = words
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");
  if (name === "") {
    return "HomePage";
  }
  return IDENTIFIER_RE.test(name) ? `${name}Page` : `Page${name}`;
};

/**
 * The code a node stands for, with everything under it: the imports its instances need, then
 * its markup. A page given a component name is written as that component.
 */
export const toCode = (
  given: DesignNode,
  classes: ClassWriter,
  options: CodeOptions = {}
): string => {
  const breakpoints = options.breakpoints ?? [];
  const used = breakpointsUsed(given, breakpoints);
  const levels = [null, ...used.map((b) => b.name)];
  const inSlots: InSlots = new Map();
  const modules: Modules = new Map();
  const node = asApplicationCode(given, {
    base: options.componentsFrom ?? DEFAULT_COMPONENTS_FROM,
    catalogue: options.catalogue ?? [],
    inSlots,
    levels: { breakpoints, names: levels },
    modules,
  });
  const parent = options.parent ?? "free";
  const asComponent = node.type === "page" && options.component !== undefined;
  const at = levels.map((name) => {
    const tree = resolveAtBreakpoint(node, breakpoints, name);
    return new Map(Array.from(walk(tree), (n) => [n.id, n] as const));
  });
  const base = at[0]?.get(node.id) ?? node;
  const hiddenAll = (n: DesignNode) =>
    levels.every((_, level) => (at[level]?.get(n.id) ?? n).hidden);
  const rootHidden = hiddenAll(base);
  const imports = importsFor(base, modules, (n) => n !== base && hiddenAll(n));
  const notes = rootHidden
    ? ["// Hidden in the design: the application leaves it out."]
    : [];
  const writing: Writing = {
    at,
    classes,
    hrefOf: options.hrefOf ?? ((link: string) => link),
    inSlots,
    levels,
    styles: makeStyleContext(options.designSystem),
  };
  // A node hidden everywhere is still written when it is the one asked for.
  const shown: Writing = rootHidden
    ? {
        ...writing,
        at: at.map((byId) => {
          const own = byId.get(node.id);
          return own
            ? new Map(byId).set(node.id, { ...own, hidden: false })
            : byId;
        }),
      }
    : writing;
  const markup = jsxOf(
    base,
    shown,
    levels.map(() => parent)
  ).flatMap((c) => printChild(c, asComponent ? 2 : 0));
  const body = asComponent
    ? [
        `export default function ${options.component}() {`,
        `${INDENT}return (`,
        ...markup,
        `${INDENT});`,
        "}",
      ]
    : markup;
  const head = [...imports, ...(imports.length > 0 ? [""] : []), ...notes];
  return [...head, ...body].join("\n");
};
