/**
 * What came before ADRs 0040 and 0041, as it is now. An instance that names a system component
 * as before (`@ultrapaint/primitives`) names it as now; a draft's (`#draft`) is an app
 * component's (`#app`), its text the value of the app component's text property; and a spec's
 * file is a component's (`componentOfSpec`).
 *
 * An instance of a repository's component from before ADR 0040 is drawn as a system component: the
 * component's name says which (case aside, shadcn's names: `DropdownMenu` is the Menu, `Sonner`
 * the Toast), its props are kept where the system component has them (a variant `default` is the axis's
 * first member, a member the system component lacks is dropped), and its children and text are kept.
 * A library's compound parts among its children (`DialogFooter`, `CardHeader`) are taken apart:
 * the nodes they hold fill the system component's slot of the same name, a title or a description in
 * one is the system component's prop, a menu's or a select's items are its `items`, and a part the
 * system component has nothing for (`DialogContent`) passes on what it holds.
 *
 * Pure: the server migrates whole pages with it, the editor one instance.
 */

import {
  APP_FROM,
  LEGACY_DRAFT_FROM,
  LEGACY_SYSTEM_FROM,
  SYSTEM_FROM,
} from "@ultrapaint/contracts/component-names";
import type {
  ComponentFile,
  ComponentProperty,
  LegacyComponentSpec,
} from "@ultrapaint/contracts/components";
import type {
  DesignNode,
  InstanceNode,
  TextNode,
} from "@ultrapaint/contracts/document";
import {
  SYSTEM_COMPONENTS,
  type SystemComponentMeta,
  systemComponentOf,
} from "./catalogue.ts";

type JsonValue = NonNullable<InstanceNode["props"]>[string];
type Props = Record<string, JsonValue>;

/** Names of a library's components that are a system component of another name, in lower case. */
const ALIASES: Readonly<Record<string, string>> = {
  alertdialog: "Dialog",
  dropdownmenu: "Menu",
  sonner: "Toast",
  toaster: "Toast",
};

/** Props a library names for what a system component's prop is: a starting value is the one drawn. */
const RENAMED: Readonly<Record<string, string>> = {
  defaultChecked: "checked",
  defaultOpen: "open",
  defaultValue: "value",
};

/** An instance of a system component that names it as before ADR 0041 (`@ultrapaint/primitives`). */
const isLegacySystemInstance = (node: InstanceNode): boolean =>
  node.from === LEGACY_SYSTEM_FROM;

/** An instance of a draft from before ADR 0041 (`#draft`): an app component's now. */
const isLegacyDraftInstance = (node: InstanceNode): boolean =>
  node.from === LEGACY_DRAFT_FROM;

/** An instance of a component of the repository's: neither a system component nor an app one. */
export const isRepositoryInstance = (node: DesignNode): node is InstanceNode =>
  node.type === "instance" &&
  node.from !== SYSTEM_FROM &&
  node.from !== LEGACY_SYSTEM_FROM &&
  node.from !== APP_FROM &&
  node.from !== LEGACY_DRAFT_FROM;

/**
 * The property a draft's instance text becomes (ADR 0041): a draft drew the instance's text in
 * place of its tree's first text, which an app component says with a text property bound to it.
 */
export const DRAFT_TEXT_PROPERTY = "text";

/** The system component a component of the repository's is drawn as, by its name. */
export const systemComponentFor = (
  component: string
): SystemComponentMeta | undefined => {
  const lower = component.toLowerCase();
  const alias = ALIASES[lower];
  return alias === undefined
    ? SYSTEM_COMPONENTS.find((p) => p.name.toLowerCase() === lower)
    : systemComponentOf(alias);
};

const kebab = (name: string) =>
  name.replace(/(?<!^)([A-Z])/g, "-$1").toLowerCase();

/** The props a system component has, from a library's: variants onto its axes, the rest by name. */
const propsFor = (
  meta: SystemComponentMeta,
  props: Props | undefined
): Props => {
  const kept: Props = {};
  for (const [given, value] of Object.entries(props ?? {})) {
    const name = RENAMED[given] ?? given;
    const prop = meta.props.find((p) => p.name === name);
    if (!prop) {
      continue;
    }
    const axis = meta.variants[name];
    const members = axis ?? prop.type.members;
    const drawn = axis && value === "default" ? axis[0] : value;
    if (
      members &&
      !(typeof drawn === "string" && (members as string[]).includes(drawn))
    ) {
      continue;
    }
    if (drawn !== undefined) {
      kept[name] = drawn;
    }
  }
  return kept;
};

/** The text a part shows: its own, or that of the one text node it holds. */
const textOf = (node: InstanceNode): string | undefined => {
  const children = node.children ?? [];
  if (children.length === 0) {
    return node.text;
  }
  const [only] = children;
  return children.length === 1 && only?.type === "text" ? only.text : undefined;
};

/** What the parts of a compound component come to in the system component. */
interface Gathered {
  readonly children: DesignNode[];
  readonly items: string[];
  readonly props: Props;
}

/**
 * Migrates an instance, or the instances inside a node; `count` hears of each instance that is
 * now a system component.
 */
const migrateNode = (node: DesignNode, count: () => void): DesignNode => {
  if (node.type === "instance" && isLegacySystemInstance(node)) {
    count();
    return renamed(node, count);
  }
  if (node.type === "instance" && isLegacyDraftInstance(node)) {
    count();
    return asAppInstance(node, count);
  }
  if (isRepositoryInstance(node)) {
    const meta = systemComponentFor(node.component);
    if (meta) {
      count();
      return drawnAs(node, meta, count);
    }
  }
  if (!("children" in node) || node.children === undefined) {
    return node;
  }
  return {
    ...node,
    children: node.children.map((child) => migrateNode(child, count)),
  } as DesignNode;
};

/** A system component's instance named as now, what it holds migrated too. */
const renamed = (node: InstanceNode, count: () => void): InstanceNode => ({
  ...node,
  from: SYSTEM_FROM,
  ...(node.children && {
    children: node.children.map((child) => migrateNode(child, count)),
  }),
});

/** A draft's instance as an app component's: its text the text property's value. */
const asAppInstance = (node: InstanceNode, count: () => void): InstanceNode => {
  const { text, ...rest } = node;
  const props =
    text === undefined
      ? node.props
      : { ...node.props, [DRAFT_TEXT_PROPERTY]: text };
  return {
    ...rest,
    from: APP_FROM,
    ...(props && { props }),
    ...(node.children && {
      children: node.children.map((child) => migrateNode(child, count)),
    }),
  };
};

/** The part of a compound component a node is (`footer` for `DialogFooter`), if it is one. */
const partOf = (base: string, node: DesignNode): string | undefined =>
  isRepositoryInstance(node) &&
  node.component.length > base.length &&
  node.component.startsWith(base)
    ? kebab(node.component.slice(base.length))
    : undefined;

/**
 * A part that is one of the system component's props, not nodes: a title or a description, an item of
 * a list, a select's placeholder. Whether it was.
 */
const intoProps = (
  meta: SystemComponentMeta,
  part: string,
  node: InstanceNode,
  into: Gathered
): boolean => {
  const text = textOf(node);
  const prop = meta.props.find((p) => p.name === part);
  if (prop?.type.kind === "string" && text !== undefined) {
    into.props[part] = text;
    return true;
  }
  if (
    (part === "item" || part === "separator") &&
    meta.props.some((p) => p.name === "items")
  ) {
    into.items.push(part === "separator" ? "-" : (text ?? ""));
    return true;
  }
  if (part === "value") {
    const placeholder = node.props?.placeholder;
    if (typeof placeholder === "string") {
      into.props.placeholder = placeholder;
    }
    return true;
  }
  return false;
};

/**
 * The slot a part's nodes fill: the system component's slot of the part's name, its trigger, or the
 * slot the part is in (a part the system component has nothing for passes its nodes on).
 */
const slotOfPart = (
  meta: SystemComponentMeta,
  part: string,
  slot: string | undefined
): string | undefined => {
  const own = `${kebab(meta.name)}-${part}`;
  const named = meta.slots.find(
    (s) =>
      s.holds !== undefined &&
      (s.name === own || (part === "trigger" && s.name === part))
  );
  if (!named) {
    return slot;
  }
  return named.holds === "default" ? undefined : named.name;
};

/** The nodes inside a compound component, each to its slot or into the system component's props. */
const gather = (
  base: string,
  meta: SystemComponentMeta,
  nodes: readonly DesignNode[],
  slot: string | undefined,
  into: Gathered,
  count: () => void
): void => {
  for (const node of nodes) {
    const part = partOf(base, node);
    if (part === undefined || node.type !== "instance") {
      const migrated = migrateNode(node, count);
      into.children.push(slot === undefined ? migrated : { ...migrated, slot });
      continue;
    }
    if (intoProps(meta, part, node, into)) {
      continue;
    }
    const inner = slotOfPart(meta, part, slot);
    if (node.children && node.children.length > 0) {
      gather(base, meta, node.children, inner, into, count);
    } else if (node.text !== undefined) {
      const shown: TextNode = {
        id: node.id,
        role: "paragraph",
        text: node.text,
        type: "text",
        ...(inner !== undefined && { slot: inner }),
      };
      into.children.push(shown);
    }
  }
};

const drawnAs = (
  node: InstanceNode,
  meta: SystemComponentMeta,
  count: () => void
): InstanceNode => {
  const { at, children, props, text, ...rest } = node;
  const into: Gathered = {
    children: [],
    items: [],
    props: propsFor(meta, props),
  };
  gather(node.component, meta, children ?? [], undefined, into, count);
  if (into.items.length > 0 && meta.props.some((p) => p.name === "items")) {
    into.props.items = into.items;
  }
  const atDrawn =
    at &&
    Object.fromEntries(
      Object.entries(at).map(([breakpoint, fields]) => {
        const { props: atProps, ...others } = fields;
        const mapped = atProps && propsFor(meta, atProps);
        return [
          breakpoint,
          {
            ...others,
            ...(mapped && Object.keys(mapped).length > 0 && { props: mapped }),
          },
        ];
      })
    );
  return {
    ...rest,
    component: meta.name,
    from: SYSTEM_FROM,
    ...(atDrawn && { at: atDrawn }),
    ...(Object.keys(into.props).length > 0 && { props: into.props }),
    ...(into.children.length > 0 && { children: into.children }),
    ...(into.children.length === 0 && text !== undefined && { text }),
  };
};

/**
 * An instance of a repository's component drawn as a system component: the one its name says, or the
 * one given (the editor's "Replace with a system component…").
 */
export const asSystemComponent = (
  node: InstanceNode,
  meta: SystemComponentMeta | undefined = systemComponentFor(node.component)
): InstanceNode => (meta ? drawnAs(node, meta, () => undefined) : node);

/** What migrating a document comes to. */
export interface SystemMigration {
  /** Instances now drawn as system components, with those inside others. */
  readonly drawn: number;
  /** Instances of the repository's that no system component is like, by component: still stand-ins. */
  readonly left: readonly string[];
  /** The outermost instances that change, each as it is now drawn. */
  readonly replaced: readonly InstanceNode[];
}

/** Every instance of a repository's component in a tree that a system component can draw. */
export const migrationOf = (root: DesignNode): SystemMigration => {
  let drawn = 0;
  const count = () => {
    drawn += 1;
  };
  const left: string[] = [];
  const replaced: InstanceNode[] = [];
  const visit = (node: DesignNode) => {
    if (node.type === "instance" && isLegacySystemInstance(node)) {
      count();
      replaced.push(renamed(node, count));
      return;
    }
    if (node.type === "instance" && isLegacyDraftInstance(node)) {
      count();
      replaced.push(asAppInstance(node, count));
      return;
    }
    if (isRepositoryInstance(node)) {
      const meta = systemComponentFor(node.component);
      if (meta) {
        count();
        replaced.push(drawnAs(node, meta, count));
        return;
      }
      left.push(node.component);
    }
    if ("children" in node && node.children) {
      for (const child of node.children) {
        visit(child);
      }
    }
  };
  visit(root);
  return { drawn, left, replaced };
};

/** The first text node of a tree, the one a draft's instance text replaced. */
const firstTextOf = (node: DesignNode): TextNode | undefined => {
  if (node.type === "text") {
    return node;
  }
  for (const child of "children" in node ? (node.children ?? []) : []) {
    const found = firstTextOf(child);
    if (found) {
      return found;
    }
  }
  return undefined;
};

/** The instances of a tree from before as they are now: a draft's tree places them too. */
const migratedTree = (tree: DesignNode): DesignNode =>
  migrateNode(tree, () => undefined);

/**
 * A spec's file from before ADR 0041 as a component's: a draft is an app component, its first
 * text bound to a text property (`DRAFT_TEXT_PROPERTY`); a spec with the design's look is the
 * system component's file; one that mirrored the code drew nothing and is none (`null`), as is a
 * spec of no system component.
 */
export const componentOfSpec = (
  spec: LegacyComponentSpec
): ComponentFile | null => {
  const envelope = {
    name: spec.component,
    ...(spec.description !== undefined && { description: spec.description }),
    ...(spec.notes && spec.notes.length > 0 && { notes: spec.notes }),
    version: 1 as const,
  };
  if (spec.draft) {
    const text = firstTextOf(spec.draft);
    const property: ComponentProperty | undefined = text && {
      default: text.text,
      kind: "text",
      name: DRAFT_TEXT_PROPERTY,
      targets: [{ node: text.id }],
    };
    return {
      ...envelope,
      origin: "app",
      properties: property ? [property] : [],
      slots: [],
      tree: migratedTree(spec.draft),
    };
  }
  if (spec.look !== "design" || !systemComponentOf(spec.component)) {
    return null;
  }
  return {
    ...envelope,
    base: spec.base,
    origin: "system",
    states: spec.states,
    variants: spec.variants,
  };
};
