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
 *
 * The same node is written as HTML too (`toHtml`, ADR 0150), the same tree with the same classes,
 * which needs nothing of the application: an app component's instance is its layers as it draws
 * them, and a system component's is the elements its view renders at rest, each part with its
 * look's classes.
 */
import type { JsonValue } from "@ultrapaint/contracts/base";
import {
  applicationFileOf,
  applicationNameOf,
  type Catalogue,
  metaOf,
} from "@ultrapaint/contracts/catalogue";
import {
  APP_FROM,
  ROOT_SLOT,
  SYSTEM_FROM,
} from "@ultrapaint/contracts/component-names";
import type { DesignSystem } from "@ultrapaint/contracts/design-system";
import type {
  DesignNode,
  InstanceNode,
  TextNode,
} from "@ultrapaint/contracts/document";
import type {
  ClassWriter,
  Declarations,
} from "@ultrapaint/contracts/node-style";
import { placementOf } from "./app-components.ts";
import {
  type Breakpoint,
  breakpointsUsed,
  resolveAtBreakpoint,
  upTo,
} from "./breakpoints.ts";
import { type ComponentLook, restingDeclarations } from "./component-look.ts";
import {
  declarationsOf,
  layoutOf,
  makeStyleContext,
  maskOf,
  type ParentLayout,
  type Style,
  type StyleContext,
  tagOf,
} from "./css.ts";
import {
  type AppFileOf,
  instanceLayers,
  LAYER_SEPARATOR,
} from "./instance-layers.ts";
import { fillSlots, slotLayoutOf } from "./slots.ts";
import { hasRuns, runsOf } from "./text-runs.ts";
import { childrenOf, findNode, isRecord, nodeLabel, walk } from "./tree.ts";

const INDENT = "  ";
/** Past this width an opening tag puts each attribute on a line of its own. */
const LINE_WIDTH = 80;

/** What JSX text would read as markup or an expression, or would collapse. */
const JSX_UNSAFE_RE = /[{}<>\n]|^\s|\s$/;
/** The same inside a line of words, where JSX keeps the spaces beside a tag. */
const JSX_INLINE_UNSAFE_RE = /[{}<>\n]/;
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
   * The app components' files (ADR 0114): an instance override is written as a prop named for
   * its layer's name. Left out, it is named for the layer's id.
   */
  readonly fileOf?: AppFileOf | undefined;
  /**
   * The `href` a link is written with: a link naming a page file is the URL that page serves.
   * Left out, the link is written as it is.
   */
  readonly hrefOf?: ((link: string) => string) | undefined;
  /** Whether the imports its instances need are written above the markup; they are when left out. */
  readonly imports?: boolean | undefined;
  /** How the node's parent lays it out, which `fill` and `hug` are relative to. */
  readonly parent?: ParentLayout | undefined;
}

/** What writing every node of one call needs. */
interface Writing {
  /** The tree at each level, by node id: the base first, then each breakpoint it sets. */
  readonly at: readonly ReadonlyMap<string, DesignNode>[];
  readonly classes: ClassWriter;
  /** The breakpoints that hold at each level, smallest first: a text style's steps there (ADR 0160). */
  readonly holding: readonly (readonly string[])[];
  readonly hrefOf: (link: string) => string;
  /** How the instance or the part a child is in lays it out, by the child's id, at each level. */
  readonly inSlots: InSlots;
  /**
   * An instance as its format writes it, from its declarations at each level and its classes:
   * the application's component in JSX, the elements it draws in HTML.
   */
  readonly instance: (
    node: InstanceNode,
    w: Writing,
    styles: readonly Declarations[],
    classes: readonly string[]
  ) => Child[];
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
  /** The app components' files, which name the layers an instance overrides. */
  readonly fileOf: AppFileOf;
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
  // What a breakpoint sets of a property is laid over the base's by name: both under the prop's.
  // The instance's overrides are props too, named for their layer and field (ADR 0114).
  const over = overrideProps(node, w.fileOf);
  const breakpoints = new Set([
    ...Object.keys(node.at ?? {}),
    ...over.at.keys(),
  ]);
  const at =
    breakpoints.size > 0
      ? Object.fromEntries(
          [...breakpoints].map((breakpoint) => {
            const fields = node.at?.[breakpoint] ?? {};
            const props = {
              ...(fields.props && asProps(fields.props)),
              ...over.at.get(breakpoint),
            };
            return [
              breakpoint,
              Object.keys(props).length > 0 ? { ...fields, props } : fields,
            ];
          })
        )
      : undefined;
  const props = { ...(node.props && asProps(node.props)), ...over.base };
  const { overrides: _overrides, ...own } = node;
  return {
    ...own,
    ...(Object.keys(props).length > 0 && { props }),
    ...(at && { at }),
    ...(node.children && { children }),
  } as DesignNode;
};

/**
 * The words a layer's way is named by in a prop: each layer's name as the component's tree has it
 * (`side`, a nested instance's `label`), its id where the component is not known.
 */
const layerWords = (
  instance: InstanceNode,
  way: string,
  fileOf: AppFileOf
): string => {
  const words: string[] = [];
  let component: string | undefined = instance.component;
  for (const id of way.split(LAYER_SEPARATOR)) {
    const layer: DesignNode | null = component
      ? findNode(fileOf(component)?.tree, id)
      : null;
    words.push(layer ? nodeLabel(layer) : id);
    component = layer?.type === "instance" ? layer.component : undefined;
  }
  return words.join(" ");
};

/**
 * An instance's instance overrides as the props the application's component takes for them (ADR
 * 0114): each field by its layer's name and its own (`side fill` as `sideFill`, a nested
 * instance's prop `nav label` as `navLabel`), a breakpoint's apart.
 */
const overrideProps = (
  instance: InstanceNode,
  fileOf: AppFileOf
): {
  readonly at: ReadonlyMap<string, Record<string, JsonValue>>;
  readonly base: Record<string, JsonValue>;
} => {
  const base: Record<string, JsonValue> = {};
  // By breakpoint, a name the document gives: a map, so no name reaches an object's prototype.
  const at = new Map<string, Record<string, JsonValue>>();
  // Each field of each layer keeps one name, its layer's id joined to it where another layer's
  // field, or one of the instance's own props, has the name already.
  // The instance's own props, at its base and at every breakpoint, keep their names.
  const taken = new Set(
    [
      instance.props,
      ...Object.values(instance.at ?? {}).map((over) => over.props),
    ].flatMap((props) => Object.keys(asProps(props ?? {})))
  );
  const names = new Map<string, string>();
  const nameOf = (way: string, words: string, field: string, kind: string) => {
    // A layer's own field and a nested instance's prop of one name are two things.
    const key = `${way}\u0000${kind}\u0000${field}`;
    const known = names.get(key);
    if (known !== undefined) {
      return known;
    }
    const plain = propNameOf(`${words} ${field}`);
    const named = taken.has(plain)
      ? propNameOf(`${words} ${way.split(LAYER_SEPARATOR).join(" ")} ${field}`)
      : plain;
    // Still taken: counted on until free.
    let name = named;
    for (let n = 2; taken.has(name); n += 1) {
      name = `${named}${n}`;
    }
    taken.add(name);
    names.set(key, name);
    return name;
  };
  const add = (
    into: Record<string, JsonValue>,
    way: string,
    words: string,
    fields: Readonly<Record<string, JsonValue>>,
    kind = "field"
  ) => {
    // A layer's own fields are named first, a nested instance's props after them.
    const ordered = Object.entries(fields).sort(
      ([a], [b]) => Number(a === "props") - Number(b === "props")
    );
    for (const [field, value] of ordered) {
      if (field === "props" && isRecord(value)) {
        add(into, way, words, value as Record<string, JsonValue>, "prop");
      } else if (!(field === "at" && kind === "field")) {
        // A layer's `at` holds its breakpoints'; a nested instance's prop may be named `at`.
        Object.defineProperty(into, nameOf(way, words, field, kind), {
          configurable: true,
          enumerable: true,
          value,
          writable: true,
        });
      }
    }
  };
  for (const [way, fields] of Object.entries(instance.overrides ?? {})) {
    const words = layerWords(instance, way, fileOf);
    add(base, way, words, fields);
    const byBreakpoint = fields.at;
    if (isRecord(byBreakpoint)) {
      for (const [breakpoint, set] of Object.entries(byBreakpoint)) {
        if (isRecord(set)) {
          const into = at.get(breakpoint) ?? {};
          at.set(breakpoint, into);
          add(into, way, words, set as Record<string, JsonValue>);
        }
      }
    }
  }
  return { at, base };
};

/** Property values by the props they are written as. */
const asProps = (
  props: Readonly<Record<string, JsonValue>>
): Record<string, JsonValue> =>
  Object.fromEntries(
    Object.entries(props).map(([name, value]) => [propNameOf(name), value])
  );

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
  // In English's order, whatever the machine's language: the same code on every machine.
  return [...named.entries()]
    .sort(([a], [b]) => a.localeCompare(b, "en"))
    .map(
      ([from, names]) =>
        `import { ${[...names].sort((a, b) => a.localeCompare(b, "en")).join(", ")} } from ${JSON.stringify(from)};`
    );
};

// ---- Markup, written as JSX or as HTML ----

/** An attribute as the tree holds it, written as its format writes it. */
type Attribute =
  /** The classes: `className` in JSX, `class` in HTML. */
  | { readonly kind: "classes"; readonly value: string }
  | { readonly kind: "string"; readonly name: string; readonly value: string }
  | { readonly kind: "flag"; readonly name: string }
  /** A prop that is no string (JSX's `{…}`). */
  | {
      readonly kind: "expression";
      readonly name: string;
      readonly value: JsonValue;
    }
  /** Props whose names JSX cannot hold as attributes (`{...{…}}`). */
  | { readonly kind: "spread"; readonly props: Record<string, JsonValue> }
  | { readonly kind: "style"; readonly style: Style };

type Child =
  | { readonly kind: "element"; readonly element: Element }
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "comment"; readonly text: string };

interface Element {
  readonly attributes: readonly Attribute[];
  readonly children: readonly Child[];
  /** Its children are a line of words (a text's runs): written on one line, as they are spaced. */
  readonly inline?: boolean | undefined;
  readonly tag: string;
}

const element = (
  tag: string,
  attributes: readonly Attribute[],
  children: readonly Child[] = [],
  inline = false
): Child => ({
  element: { attributes, children, tag, ...(inline && { inline }) },
  kind: "element",
});

const comment = (text: string): Child => ({ kind: "comment", text });

const stringAttribute = (name: string, value: string): Attribute => ({
  kind: "string",
  name,
  value,
});

const classAttribute = (classes: readonly string[]): Attribute[] =>
  classes.length > 0 ? [{ kind: "classes", value: classes.join(" ") }] : [];

const propAttribute = (name: string, value: JsonValue): Attribute => {
  if (typeof value === "string") {
    return stringAttribute(name, value);
  }
  return value === true
    ? { kind: "flag", name }
    : { kind: "expression", name, value };
};

/** An instance's props as attributes; names JSX cannot hold go in a spread. */
const propAttributes = (
  props: InstanceNode["props"],
  classes: readonly string[]
): Attribute[] => {
  const out: Attribute[] = [];
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
    out.push({ kind: "spread", props: spread });
  }
  if (className) {
    out.push({ kind: "classes", value: className });
  }
  return out;
};

// ---- Printing ----

/** The elements HTML writes without a closing tag. */
export const VOID_ELEMENTS: ReadonlySet<string> = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "source",
  "track",
  "wbr",
]);
const UPPER_RE = /[A-Z]/g;
const LINE_BREAK_RE = /\r?\n/g;

/** Text as a JSX child: as it is, or as a string expression when JSX would read it otherwise. */
const jsxText = (text: string, unsafe = JSX_UNSAFE_RE) =>
  unsafe.test(text) || ENTITY_RE.test(text)
    ? `{${JSON.stringify(text)}}`
    : text;

/** A JSX attribute's string: quoted, or an expression when JSX would read an entity or a quote. */
const jsxString = (name: string, value: string) =>
  value.includes('"') || value.includes("\\") || ENTITY_RE.test(value)
    ? `${name}={${JSON.stringify(value)}}`
    : `${name}="${value}"`;

/** What HTML would read as markup, escaped: `&`, `<` and `>` in text, `"` too in an attribute. */
const escapeHtml = (text: string, attribute = false) => {
  const escaped = text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  return attribute ? escaped.replaceAll('"', "&quot;") : escaped;
};

/** An inline style as CSS: `maskImage` is `mask-image`, `WebkitMaskImage` `-webkit-mask-image`. */
const cssText = (style: Style) =>
  Object.entries(style)
    .map(
      ([property, value]) =>
        `${property.replace(UPPER_RE, (c) => `-${c.toLowerCase()}`)}: ${value}`
    )
    .join("; ");

const jsxAttribute = (a: Attribute): string => {
  switch (a.kind) {
    case "classes":
      return jsxString("className", a.value);
    case "string":
      return jsxString(a.name, a.value);
    case "flag":
      return a.name;
    case "expression":
      return `${a.name}={${JSON.stringify(a.value)}}`;
    case "spread":
      return `{...${JSON.stringify(a.props)}}`;
    default:
      return `style={${JSON.stringify(a.style)}}`;
  }
};

const htmlAttribute = (a: Attribute): string => {
  switch (a.kind) {
    case "classes":
      return htmlAttribute(stringAttribute("class", a.value));
    case "string":
      return `${a.name}="${escapeHtml(a.value, true)}"`;
    case "flag":
      return a.name;
    case "expression":
      return `${a.name}="${escapeHtml(JSON.stringify(a.value), true)}"`;
    case "spread":
      return Object.entries(a.props)
        .map(([name, value]) =>
          htmlAttribute(
            stringAttribute(
              name,
              typeof value === "string" ? value : JSON.stringify(value)
            )
          )
        )
        .join(" ");
    default:
      return `style="${escapeHtml(cssText(a.style), true)}"`;
  }
};

/** How a format writes what the tree holds: JSX with the application's components, or HTML. */
interface Printer {
  readonly attribute: (a: Attribute) => string;
  readonly comment: (text: string) => string;
  /** An element with nothing in it, its opening's last line given (`tail`, `pad` alone when the attributes are on lines of their own). */
  readonly empty: (tag: string, tail: string, pad: string) => string;
  /** Words inside a line of them, beside a tag on the same line. */
  readonly inlineText: (text: string) => string;
  readonly text: (text: string) => string;
}

const JSX: Printer = {
  attribute: jsxAttribute,
  comment: (text) => `{/* ${text.replaceAll("*/", "* /")} */}`,
  empty: (_tag, tail, pad) => `${tail}${tail === pad ? "" : " "}/>`,
  inlineText: (text) => jsxText(text, JSX_INLINE_UNSAFE_RE),
  text: jsxText,
};

/** A line break in a text is a `<br>`. */
const htmlText = (text: string) =>
  escapeHtml(text).replace(LINE_BREAK_RE, "<br>");

const HTML: Printer = {
  attribute: htmlAttribute,
  comment: (text) => `<!-- ${text.replaceAll("--", "- -")} -->`,
  empty: (tag, tail) =>
    VOID_ELEMENTS.has(tag) ? `${tail}>` : `${tail}></${tag}>`,
  inlineText: htmlText,
  text: htmlText,
};

/** A child inside a line of words, on that line: its own children too. */
const printInline = (child: Child, printer: Printer): string => {
  if (child.kind === "text") {
    return printer.inlineText(child.text);
  }
  if (child.kind === "comment") {
    return printer.comment(child.text);
  }
  const { attributes, children, tag } = child.element;
  const opening = [tag, ...attributes.map(printer.attribute).filter(Boolean)];
  return `<${opening.join(" ")}>${children.map((c) => printInline(c, printer)).join("")}</${tag}>`;
};

const printChild = (
  child: Child,
  depth: number,
  printer: Printer
): string[] => {
  const pad = INDENT.repeat(depth);
  if (child.kind === "text") {
    return [`${pad}${printer.text(child.text)}`];
  }
  if (child.kind === "comment") {
    return [`${pad}${printer.comment(child.text)}`];
  }
  if (child.element.inline) {
    return [`${pad}${printInline(child, printer)}`];
  }
  const { children, tag } = child.element;
  const attributes = child.element.attributes
    .map(printer.attribute)
    .filter(Boolean);
  const inline = attributes.map((a) => ` ${a}`).join("");
  const fits = pad.length + tag.length + inline.length + 3 <= LINE_WIDTH;
  const opening =
    fits || attributes.length === 0
      ? [`${pad}<${tag}${inline}`]
      : [`${pad}<${tag}`, ...attributes.map((a) => `${pad}${INDENT}${a}`), pad];
  const last = opening.length - 1;
  const head = opening.slice(0, last);
  const tail = opening[last] ?? pad;
  if (children.length === 0) {
    return [...head, printer.empty(tag, tail, pad)];
  }
  const [only] = children;
  if (fits && children.length === 1 && only?.kind === "text") {
    const line = `${tail}>${printer.text(only.text)}</${tag}>`;
    if (line.length <= LINE_WIDTH) {
      return [line];
    }
  }
  return [
    ...head,
    `${tail}>`,
    ...children.flatMap((c) => printChild(c, depth + 1, printer)),
    `${pad}</${tag}>`,
  ];
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
    ? [comment(`Hidden: ${nodeLabel(node)}`)]
    : markupOf(node, w, parents);

/** What an underlined run's element sets, as the style system writes it. */
const UNDERLINE: Declarations = { textDecorationLine: "underline" };

/**
 * A text's runs inside its element (ADR 0163): a run's link an anchor, its underline the style
 * system's class, a plain run its words. A text that links as a whole is one anchor already, and
 * an anchor holds no other: its runs' links are left out.
 */
const runsFor = (node: TextNode, w: Writing): Child[] =>
  runsOf(node).map((run): Child => {
    const words: Child = { kind: "text", text: run.text };
    const classes = run.underline
      ? w.classes.classes([{ breakpoint: null, declarations: UNDERLINE }])
      : [];
    if (run.link && !node.link) {
      return element(
        "a",
        [
          stringAttribute("href", w.hrefOf(run.link)),
          ...classAttribute(classes),
        ],
        [words]
      );
    }
    return classes.length > 0
      ? element("span", classAttribute(classes), [words])
      : words;
  });

/** A link is a plain anchor here: in the application it is its router's own link. */
const linked = (
  node: DesignNode,
  w: Writing,
  children: readonly Child[]
): Child[] =>
  node.link && children.some((c) => c.kind === "element")
    ? [element("a", [stringAttribute("href", w.hrefOf(node.link))], children)]
    : [...children];

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
 * A node as markup. One whose text, picture or props differ between breakpoints is written once
 * for each run of levels that shows the same, hidden at the others (ADR 0036).
 */
const markupOf = (node: DesignNode, w: Writing, parents: Parents): Child[] => {
  const levels = w.levels.map((_, level) => nodeAt(node, w, level));
  const styles = levels.map((n, level) =>
    declarationsOf(n, {
      ...w.styles,
      holding: w.holding[level],
      parent: parents[level] ?? "free",
    })
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
    return showing(node, w, styles);
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
    return showing(shown, w, runStyles);
  });
};

/** A node as markup with its declarations at each level, what it shows as `node` has it. */
const showing = (
  node: DesignNode,
  w: Writing,
  styles: readonly Declarations[]
): Child[] => {
  const classes = classesOf(w, styles);
  switch (node.type) {
    case "text":
      return linked(node, w, [
        hasRuns(node)
          ? element(
              tagOf(node),
              classAttribute(classes),
              runsFor(node, w),
              true
            )
          : element(tagOf(node), classAttribute(classes), [
              { kind: "text", text: node.text },
            ]),
      ]);
    case "image":
      if (node.tint !== undefined) {
        // An icon in a colour: its file as a mask over the tint, which is its background.
        return linked(node, w, [
          element("span", [
            stringAttribute("aria-label", node.alt ?? ""),
            ...classAttribute(classes),
            stringAttribute("role", "img"),
            { kind: "style", style: maskOf(node.src) },
          ]),
        ]);
      }
      return linked(node, w, [
        element("img", [
          stringAttribute("alt", node.alt ?? ""),
          ...classAttribute(classes),
          stringAttribute("src", node.src),
        ]),
      ]);
    case "instance":
      return linked(node, w, w.instance(node, w, styles, classes));
    default: {
      // A container that is a link is the anchor itself, so it keeps its place in the layout.
      const attributes = node.link
        ? [
            stringAttribute("href", w.hrefOf(node.link)),
            ...classAttribute(classes),
          ]
        : classAttribute(classes);
      return [
        element(node.link ? "a" : "div", attributes, childrenFor(node, w)),
      ];
    }
  }
};

/** An instance in JSX: the application's component, its props as attributes. */
const jsxInstance: Writing["instance"] = (node, w, _styles, classes) => {
  let content: Child[] = [];
  if (childrenOf(node).length > 0) {
    content = childrenFor(node, w);
  } else if (node.text) {
    content = [{ kind: "text", text: node.text }];
  }
  return [
    element(node.component, propAttributes(node.props, classes), content),
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

/** A tree written at its levels: its markup's lines, and whether it is hidden at every one. */
const writeTree = (
  base: DesignNode,
  w: Writing,
  parent: ParentLayout,
  printer: Printer,
  depth: number
): { readonly hidden: boolean; readonly lines: string[] } => {
  const hidden = hiddenEverywhere(base, w);
  // A node hidden everywhere is still written when it is the one asked for.
  const shown: Writing = hidden
    ? {
        ...w,
        at: w.at.map((byId) => {
          const own = byId.get(base.id);
          return own
            ? new Map(byId).set(base.id, { ...own, hidden: false })
            : byId;
        }),
      }
    : w;
  const lines = markupOf(
    base,
    shown,
    w.levels.map(() => parent)
  ).flatMap((c) => printChild(c, depth, printer));
  return { hidden, lines };
};

/** Each level's tree by node id. */
const byIdAt = (trees: readonly DesignNode[]) =>
  trees.map((tree) => new Map(Array.from(walk(tree), (n) => [n.id, n])));

const HIDDEN_NOTE = "Hidden in the design: the application leaves it out.";

/**
 * The code a node stands for, with everything under it: the imports its instances need, unless
 * left out, then its markup. A page given a component name is written as that component.
 */
export const toCode = (
  given: DesignNode,
  classes: ClassWriter,
  options: CodeOptions = {}
): string => {
  const breakpoints = options.breakpoints ?? [];
  const styles = makeStyleContext(options.designSystem);
  const used = breakpointsUsed(given, breakpoints, styles.textStyles);
  const levels = [null, ...used.map((b) => b.name)];
  const inSlots: InSlots = new Map();
  const modules: Modules = new Map();
  const node = asApplicationCode(given, {
    base: options.componentsFrom ?? DEFAULT_COMPONENTS_FROM,
    catalogue: options.catalogue ?? [],
    fileOf: options.fileOf ?? (() => undefined),
    inSlots,
    levels: { breakpoints, names: levels },
    modules,
  });
  const asComponent = node.type === "page" && options.component !== undefined;
  const at = byIdAt(
    levels.map((name) => resolveAtBreakpoint(node, breakpoints, name))
  );
  const base = at[0]?.get(node.id) ?? node;
  const writing: Writing = {
    at,
    classes,
    holding: levels.map((name) => upTo(breakpoints, name)),
    hrefOf: options.hrefOf ?? ((link: string) => link),
    inSlots,
    instance: jsxInstance,
    levels,
    styles,
  };
  const { hidden, lines } = writeTree(
    base,
    writing,
    options.parent ?? "free",
    JSX,
    asComponent ? 2 : 0
  );
  const imports =
    options.imports === false
      ? []
      : importsFor(
          base,
          modules,
          (n) => n !== base && hiddenEverywhere(n, writing)
        );
  const body = asComponent
    ? [
        `export default function ${options.component}() {`,
        `${INDENT}return (`,
        ...lines,
        `${INDENT});`,
        "}",
      ]
    : lines;
  const head = [
    ...imports,
    ...(imports.length > 0 ? [""] : []),
    ...(hidden ? [`// ${HIDDEN_NOTE}`] : []),
  ];
  return [...head, ...body].join("\n");
};

// ---- HTML ----

/**
 * Markup a system component's view renders (ADR 0040), as the HTML writer takes it: its elements,
 * their attributes as written, and their text.
 */
export type Markup =
  | {
      readonly attributes: readonly (readonly [string, string])[];
      readonly children: readonly Markup[];
      readonly kind: "element";
      readonly tag: string;
    }
  | { readonly kind: "text"; readonly text: string };

/** The element a view's markup holds a slot's nodes in, by the slot's `name`. */
export const SLOT_PLACEHOLDER = "ed-slot";
/** The attribute on the element of a view's markup that is the instance itself. */
export const INSTANCE_MARK = "data-ed-node";
/** The editor's own attributes on a view's markup, which the HTML leaves out. */
const EDITOR_ATTRIBUTE_RE = /^data-(?:ed-|system)/;

/** What writing a system component's instance as HTML takes from the server. */
export interface SystemDrawing {
  /** What its look puts in a slot an instance leaves empty (ADR 0041). */
  readonly content: Readonly<Record<string, readonly DesignNode[]>>;
  /** Its looks, the default's first, each later one drawn over the one before it. */
  readonly looks: readonly ComponentLook[];
  /**
   * The elements its view renders at rest for an instance, the instance's element carrying
   * `INSTANCE_MARK`, each of the slots named in `slots` held in a `SLOT_PLACEHOLDER`, and every
   * id it makes up taken from the instance's, so two instances in one snippet keep theirs apart.
   */
  readonly markup: (
    instance: Pick<InstanceNode, "id" | "props">,
    slots: readonly string[]
  ) => readonly Markup[];
}

export interface HtmlOptions
  extends Pick<
    CodeOptions,
    | "breakpoints"
    | "catalogue"
    | "designSystem"
    | "fileOf"
    | "hrefOf"
    | "parent"
  > {
  /** A system component's drawing, by its name; left out, an instance of one is a comment. */
  readonly systemDrawing?:
    | ((component: string) => SystemDrawing | undefined)
    | undefined;
}

/**
 * A tree with every app component's instance as its layers as the instance draws them (ADR
 * 0114), where the instance stands, as a detached one is (ADR 0041). One drawn inside itself, or
 * whose component is not known, stays an instance.
 */
const expandApps = (
  node: DesignNode,
  fileOf: AppFileOf,
  drawing: readonly string[] = []
): DesignNode => {
  if (node.type === "instance" && node.from === APP_FROM) {
    const file = fileOf(node.component);
    if (!file || drawing.includes(node.component)) {
      return node;
    }
    const tree = {
      ...instanceLayers(file, node),
      ...placementOf(node),
      id: node.id,
    } as DesignNode;
    return expandApps(tree, fileOf, [...drawing, node.component]);
  }
  return isParent(node)
    ? ({
        ...node,
        children: node.children.map((c) => expandApps(c, fileOf, drawing)),
      } as DesignNode)
    : node;
};

/** What writing one system component's instance as HTML knows. */
interface Drawn {
  readonly breakpoints: readonly Breakpoint[];
  readonly catalogue: Catalogue;
  readonly drawing: SystemDrawing;
  /** What each slot holds, by its name (`fillSlots`). */
  readonly fills: ReturnType<typeof fillSlots>;
  /** The parts its looks leave out. */
  readonly hidden: ReadonlySet<string>;
  readonly node: InstanceNode;
  /** The instance's own declarations at each level, which go on its element. */
  readonly own: readonly Declarations[];
  /** The default slot, where the instance shows its text when it has no children. */
  readonly textSlot: string | undefined;
  readonly w: Writing;
}

type MarkupElement = Extract<Markup, { kind: "element" }>;

const attributeOf = (m: MarkupElement, name: string) =>
  m.attributes.find(([n]) => n === name)?.[1];

/** The instance at a level: its variant may turn with a breakpoint. */
const instanceAt = (d: Drawn, level: number) =>
  nodeAt(d.node, d.w, level) as InstanceNode;

/** A slot's placeholder: the nodes that fill it, against its layout at each level, or the text. */
const slotMarkup = (d: Drawn, slot: string): Child[] => {
  const fill = d.fills.get(slot);
  if (!fill) {
    return slot === d.textSlot && d.node.text !== undefined
      ? [{ kind: "text", text: d.node.text }]
      : [];
  }
  const parents = d.w.levels.map(
    (name, level) =>
      slotLayoutOf(
        instanceAt(d, level),
        slot,
        d.catalogue,
        upTo(d.breakpoints, name)
      ) ?? "block"
  );
  return fill.nodes.flatMap((child) => childFor(child, d.w, parents));
};

/**
 * An element of the view's markup: a part its looks leave out is left out, the editor's marks
 * are taken off, and a part takes its look's classes at rest at each level, the instance's own
 * over its element's.
 */
const viewElement = (d: Drawn, m: MarkupElement): Child[] => {
  const part = attributeOf(m, "data-slot");
  if (part !== undefined && d.hidden.has(part)) {
    return [];
  }
  const isInstance = attributeOf(m, INSTANCE_MARK) !== undefined;
  const classes =
    part === undefined && !isInstance
      ? []
      : classesOf(
          d.w,
          d.w.levels.map((_, level) => ({
            ...restingDeclarations(
              d.drawing.looks,
              instanceAt(d, level).props,
              part ?? ROOT_SLOT
            ),
            ...(isInstance ? d.own[level] : undefined),
          }))
        );
  return [
    element(
      m.tag,
      [
        ...classAttribute(classes),
        ...m.attributes
          .filter(([name]) => !EDITOR_ATTRIBUTE_RE.test(name))
          .map(([name, value]) => stringAttribute(name, value)),
      ],
      m.children.flatMap((c) => fromView(d, c))
    ),
  ];
};

const fromView = (d: Drawn, m: Markup): Child[] => {
  if (m.kind === "text") {
    return [{ kind: "text", text: m.text }];
  }
  return m.tag === SLOT_PLACEHOLDER
    ? slotMarkup(d, attributeOf(m, "name") ?? "")
    : viewElement(d, m);
};

/**
 * A system component's instance in HTML: the elements its view renders at rest, the editor's
 * marks taken off, each part with the classes of its look in the instance's variant at each
 * level, the instance's own over its element's, and each slot's nodes where the view holds it.
 */
const htmlInstance =
  (
    catalogue: Catalogue,
    breakpoints: readonly Breakpoint[],
    drawingOf: (component: string) => SystemDrawing | undefined
  ): Writing["instance"] =>
  (node, w, own) => {
    if (node.from === APP_FROM) {
      // Left an instance by `expandApps`: drawn inside itself, or of no app component known.
      return [
        comment(
          `${nodeLabel(node)} is not drawn: ${node.component} is drawn inside itself or is not one of the app components`
        ),
      ];
    }
    const drawing = drawingOf(node.component);
    const entry = metaOf(catalogue, node);
    if (!(drawing && entry)) {
      return [comment(`${node.component} is not one of the system components`)];
    }
    const fills = fillSlots(node, entry.slots, drawing.content);
    const textSlot =
      childrenOf(node).length === 0 && node.text !== undefined
        ? entry.slots.find((s) => s.holds === "default")?.name
        : undefined;
    const d: Drawn = {
      breakpoints,
      catalogue,
      drawing,
      fills,
      hidden: new Set(drawing.looks.flatMap((look) => look.hidden ?? [])),
      node,
      own,
      textSlot,
      w,
    };
    const slots = [
      ...fills.keys(),
      ...(textSlot === undefined || fills.has(textSlot) ? [] : [textSlot]),
    ];
    const written = drawing.markup(node, slots).flatMap((m) => fromView(d, m));
    return written.length > 0
      ? written
      : [
          comment(
            `${nodeLabel(node)} draws nothing at rest: it shows when open.`
          ),
        ];
  };

/**
 * A node as HTML, with everything under it: the same tree and the same classes as its JSX
 * (`toCode`), each app component's instance as its layers and each system component's as the
 * elements its view renders at rest (`SystemDrawing`), so it needs nothing of the application.
 */
export const toHtml = (
  given: DesignNode,
  classes: ClassWriter,
  options: HtmlOptions = {}
): string => {
  const breakpoints = options.breakpoints ?? [];
  const fileOf = options.fileOf ?? (() => undefined);
  const styles = makeStyleContext(options.designSystem);
  // What the instance sets at a breakpoint, and what its component's layers set at one.
  const names = new Set(
    [
      ...breakpointsUsed(given, breakpoints, styles.textStyles),
      ...breakpointsUsed(
        expandApps(given, fileOf),
        breakpoints,
        styles.textStyles
      ),
    ].map((b) => b.name)
  );
  const levels = [
    null,
    ...breakpoints.filter((b) => names.has(b.name)).map((b) => b.name),
  ];
  // Each level's tree: its instances drawn as they are at that breakpoint, then their layers.
  const trees = levels.map((name) =>
    resolveAtBreakpoint(
      expandApps(resolveAtBreakpoint(given, breakpoints, name), fileOf),
      breakpoints,
      name
    )
  );
  const at = byIdAt(trees);
  const base = at[0]?.get(given.id) ?? given;
  const { hidden, lines } = writeTree(
    base,
    {
      at,
      classes,
      holding: levels.map((name) => upTo(breakpoints, name)),
      hrefOf: options.hrefOf ?? ((link: string) => link),
      inSlots: new Map(),
      instance: htmlInstance(
        options.catalogue ?? [],
        breakpoints,
        options.systemDrawing ?? (() => undefined)
      ),
      levels,
      styles,
    },
    options.parent ?? "free",
    HTML,
    0
  );
  return [...(hidden ? [HTML.comment(HIDDEN_NOTE)] : []), ...lines].join("\n");
};
