/**
 * A node as code: the JSX the rules agents implement a page by (the `/implement` briefing) turn
 * it into, its look in the classes of the project's style system. The application's code is
 * still written by an agent, in the repository's own conventions (ADR 0015); this is the
 * reference translation the editor shows, so a user can see what a design means before an agent
 * writes it. The markup, the imports and the names are the same whatever the style system; the
 * classes are its own, through a `ClassWriter` (ADR 0024): Tailwind v4's is
 * `@ultrapaint/style-tailwind-v4/node-classes`.
 */
import type { JsonValue } from "@ultrapaint/contracts/base";
import type { DesignNode, InstanceNode } from "@ultrapaint/contracts/document";
import type { InstanceDrawn } from "@ultrapaint/contracts/preview";
import { layoutOf, type ParentLayout, tagOf } from "./css.ts";
import { childrenOf, nodeLabel } from "./tree.ts";

/**
 * How a style system writes a node's look as classes (ADR 0024), its design system's styles made
 * once for every node.
 */
export interface ClassWriter {
  /** The classes a node is written with, its parent laying it out as `parent`. */
  readonly classes: (
    node: DesignNode,
    parent: ParentLayout
  ) => readonly string[];
  /**
   * The classes of the element put around an instance whose component keeps its props to
   * itself, given the instance's own: a column that stretches it across, as the canvas draws it.
   */
  readonly wrapper: (classes: readonly string[]) => readonly string[];
}

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
   * Name of the function a page is written as; given, a page node becomes that component.
   * Left out, the page is written as its markup alone.
   */
  readonly component?: string | undefined;
  /**
   * The `href` a link is written with: a link naming a page file is the URL that page serves.
   * Left out, the link is written as it is.
   */
  readonly hrefOf?: ((link: string) => string) | undefined;
  /**
   * How the preview drew the instances, by node id (`ed:instances`): how each lays out its
   * children, and whether its component keeps its props, so that its box goes on a `div` around
   * it. An instance left out is taken to pass its props on and to lay its children out as a
   * block.
   */
  readonly instances?: Readonly<Record<string, InstanceDrawn>> | undefined;
  /** How the node's parent lays it out, which `fill` and `hug` are relative to. */
  readonly parent?: ParentLayout | undefined;
}

/** What writing every node of one call needs. */
interface Writing {
  readonly classes: ClassWriter;
  readonly hrefOf: (link: string) => string;
  readonly instances: Readonly<Record<string, InstanceDrawn>>;
  /** The name each instance's component is imported as (`importKey`), unique in the file. */
  readonly localNames: ReadonlyMap<string, string>;
}

// ---- Imports ----

/** `@acme/ui/date-picker` → `DatePicker`: what a default export is imported as. */
const defaultImportName = (from: string) => {
  const base = from.split("/").at(-1) ?? from;
  const words = base.match(WORD_RE) ?? ["Component"];
  const name = words
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");
  return IDENTIFIER_RE.test(name) ? name : `Component${name}`;
};

/** An imported component: its module and its export, `default` for the default one. */
const importKey = (from: string, component: string) => `${from}\0${component}`;

const tagOfInstance = (node: InstanceNode, w: Writing) =>
  w.localNames.get(importKey(node.from, node.component)) ??
  (node.component === "default"
    ? defaultImportName(node.from)
    : node.component);

/** `base`, or `base2`, `base3`…: the first that `free` allows. */
const firstFree = (base: string, free: (name: string) => boolean) => {
  let name = base;
  for (let n = 2; !free(name); n += 1) {
    name = `${base}${n}`;
  }
  return name;
};

/**
 * The imports the visible instances under a node need, one statement per module, and the name
 * each component is imported as. Names in `reserved` (the page's own component) are taken. A
 * component imported by name keeps it unless an earlier module's took it (`{ Card as Card2 }`);
 * a default export takes its module's name (`Button`, `Button2`), never one imported by name.
 */
const importsFor = (
  root: DesignNode,
  reserved: readonly string[]
): { localNames: Map<string, string>; lines: string[] } => {
  const modules = new Map<string, { named: Set<string>; fallback: boolean }>();
  const visit = (node: DesignNode) => {
    if (node.hidden) {
      return;
    }
    if (node.type === "instance") {
      const entry = modules.get(node.from) ?? {
        fallback: false,
        named: new Set<string>(),
      };
      if (node.component === "default") {
        entry.fallback = true;
      } else {
        entry.named.add(node.component);
      }
      modules.set(node.from, entry);
    }
    for (const child of childrenOf(node)) {
      visit(child);
    }
  };
  visit(root);
  const sorted = [...modules.entries()].sort(([a], [b]) => a.localeCompare(b));
  const byName = (a: string, b: string) => a.localeCompare(b);
  /** The names imported by name, which an alias or a default export's name does not take. */
  const wanted = new Set(sorted.flatMap(([, { named }]) => [...named]));
  const taken = new Set(reserved);
  const localNames = new Map<string, string>();
  for (const [from, { named }] of sorted) {
    for (const component of [...named].sort(byName)) {
      const name = firstFree(
        component,
        (n) => !taken.has(n) && (n === component || !wanted.has(n))
      );
      taken.add(name);
      localNames.set(importKey(from, component), name);
    }
  }
  for (const [from, { fallback }] of sorted) {
    if (fallback) {
      const name = firstFree(
        defaultImportName(from),
        (n) => !(taken.has(n) || wanted.has(n))
      );
      taken.add(name);
      localNames.set(importKey(from, "default"), name);
    }
  }
  const lines = sorted.map(([from, { fallback, named }]) => {
    const names = [...named].sort(byName).map((component) => {
      const local = localNames.get(importKey(from, component));
      return local === component ? component : `${component} as ${local}`;
    });
    const parts = [
      ...(fallback ? [localNames.get(importKey(from, "default"))] : []),
      ...(names.length > 0 ? [`{ ${names.join(", ")} }`] : []),
    ];
    return `import ${parts.join(", ")} from ${JSON.stringify(from)};`;
  });
  return { lines, localNames };
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

/** How a node lays out its children: an instance as the preview saw its component do it. */
const childLayoutOf = (node: DesignNode, w: Writing): ParentLayout =>
  node.type === "instance"
    ? (w.instances[node.id]?.layout ?? "block")
    : layoutOf(node);

const childrenFor = (node: DesignNode, w: Writing): Child[] => {
  const parent = childLayoutOf(node, w);
  return childrenOf(node).map((child) => childFor(child, w, parent));
};

/** A node below the one written: hidden ones are left out, and say so. */
const childFor = (node: DesignNode, w: Writing, parent: ParentLayout): Child =>
  node.hidden
    ? { kind: "comment", text: `Hidden: ${nodeLabel(node)}` }
    : jsxOf(node, w, parent);

/** A link is a plain anchor here: in the application it is its router's own link. */
const linked = (node: DesignNode, w: Writing, child: Child): Child =>
  node.link
    ? element("a", [stringAttribute("href", w.hrefOf(node.link))], [child])
    : child;

const jsxOf = (node: DesignNode, w: Writing, parent: ParentLayout): Child => {
  const classes = [...w.classes.classes(node, parent)];
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
      // A component that keeps its props to itself cannot take the classes: they go on a div
      // around it, which stretches it across, as the canvas draws it.
      if (w.instances[node.id]?.wrapped && classes.length > 0) {
        return linked(
          node,
          w,
          element("div", classAttribute(w.classes.wrapper(classes)), [
            element(
              tagOfInstance(node, w),
              propAttributes(node.props, []),
              content
            ),
          ])
        );
      }
      return linked(
        node,
        w,
        element(
          tagOfInstance(node, w),
          propAttributes(node.props, classes),
          content
        )
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
  node: DesignNode,
  classes: ClassWriter,
  options: CodeOptions = {}
): string => {
  const parent = options.parent ?? "free";
  const asComponent = node.type === "page" && options.component !== undefined;
  // The page's own function is a name in the file too: an import does not take it.
  const { localNames, lines: imports } = importsFor(
    node.hidden ? { ...node, hidden: false } : node,
    asComponent && options.component ? [options.component] : []
  );
  const notes = node.hidden
    ? ["// Hidden in the design: the application leaves it out."]
    : [];
  const writing: Writing = {
    classes,
    hrefOf: options.hrefOf ?? ((link: string) => link),
    instances: options.instances ?? {},
    localNames,
  };
  const markup = printChild(jsxOf(node, writing, parent), asComponent ? 2 : 0);
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
