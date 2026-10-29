/**
 * An instance of a repository's component from before ADR 0040, drawn as a primitive: the
 * component's name says which (case aside, shadcn's names: `DropdownMenu` is the Menu, `Sonner`
 * the Toast), its props are kept where the primitive has them (a variant `default` is the axis's
 * first member, a member the primitive lacks is dropped), and its children and text are kept.
 * A library's compound parts among its children (`DialogFooter`, `CardHeader`) are taken apart:
 * the nodes they hold fill the primitive's slot of the same name, a title or a description in
 * one is the primitive's prop, a menu's or a select's items are its `items`, and a part the
 * primitive has nothing for (`DialogContent`) passes on what it holds.
 *
 * Pure: the server migrates whole pages with it, the editor one instance.
 */
import type {
  DesignNode,
  InstanceNode,
  TextNode,
} from "@ultrapaint/contracts/document";
import { DRAFT_FROM, PRIMITIVES_FROM } from "@ultrapaint/contracts/spec-names";
import { PRIMITIVES, type PrimitiveMeta, primitiveOf } from "./catalogue.ts";

type JsonValue = NonNullable<InstanceNode["props"]>[string];
type Props = Record<string, JsonValue>;

/** Names of a library's components that are a primitive of another name, in lower case. */
const ALIASES: Readonly<Record<string, string>> = {
  alertdialog: "Dialog",
  dropdownmenu: "Menu",
  sonner: "Toast",
  toaster: "Toast",
};

/** Props a library names for what a primitive's prop is: a starting value is the one drawn. */
const RENAMED: Readonly<Record<string, string>> = {
  defaultChecked: "checked",
  defaultOpen: "open",
  defaultValue: "value",
};

/** An instance of a component of the repository's: neither a primitive nor a draft. */
export const isRepositoryInstance = (node: DesignNode): node is InstanceNode =>
  node.type === "instance" &&
  node.from !== PRIMITIVES_FROM &&
  node.from !== DRAFT_FROM;

/** The primitive a component of the repository's is drawn as, by its name. */
export const primitiveFor = (component: string): PrimitiveMeta | undefined => {
  const lower = component.toLowerCase();
  const alias = ALIASES[lower];
  return alias === undefined
    ? PRIMITIVES.find((p) => p.name.toLowerCase() === lower)
    : primitiveOf(alias);
};

const kebab = (name: string) =>
  name.replace(/(?<!^)([A-Z])/g, "-$1").toLowerCase();

/** The props a primitive has, from a library's: variants onto its axes, the rest by name. */
const propsFor = (meta: PrimitiveMeta, props: Props | undefined): Props => {
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

/** What the parts of a compound component come to in the primitive. */
interface Gathered {
  readonly children: DesignNode[];
  readonly items: string[];
  readonly props: Props;
}

/**
 * Migrates an instance, or the instances inside a node; `count` hears of each instance that is
 * now a primitive.
 */
const migrateNode = (node: DesignNode, count: () => void): DesignNode => {
  if (isRepositoryInstance(node)) {
    const meta = primitiveFor(node.component);
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

/** The part of a compound component a node is (`footer` for `DialogFooter`), if it is one. */
const partOf = (base: string, node: DesignNode): string | undefined =>
  isRepositoryInstance(node) &&
  node.component.length > base.length &&
  node.component.startsWith(base)
    ? kebab(node.component.slice(base.length))
    : undefined;

/**
 * A part that is one of the primitive's props, not nodes: a title or a description, an item of
 * a list, a select's placeholder. Whether it was.
 */
const intoProps = (
  meta: PrimitiveMeta,
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
 * The slot a part's nodes fill: the primitive's slot of the part's name, its trigger, or the
 * slot the part is in (a part the primitive has nothing for passes its nodes on).
 */
const slotOfPart = (
  meta: PrimitiveMeta,
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

/** The nodes inside a compound component, each to its slot or into the primitive's props. */
const gather = (
  base: string,
  meta: PrimitiveMeta,
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
  meta: PrimitiveMeta,
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
    from: PRIMITIVES_FROM,
    ...(atDrawn && { at: atDrawn }),
    ...(Object.keys(into.props).length > 0 && { props: into.props }),
    ...(into.children.length > 0 && { children: into.children }),
    ...(into.children.length === 0 && text !== undefined && { text }),
  };
};

/**
 * An instance of a repository's component drawn as a primitive: the one its name says, or the
 * one given (the editor's "Replace with a primitive…").
 */
export const asPrimitive = (
  node: InstanceNode,
  meta: PrimitiveMeta | undefined = primitiveFor(node.component)
): InstanceNode => (meta ? drawnAs(node, meta, () => undefined) : node);

/** What migrating a document comes to. */
export interface PrimitivesMigration {
  /** Instances now drawn as primitives, with those inside others. */
  readonly drawn: number;
  /** Instances of the repository's that no primitive is like, by component: still stand-ins. */
  readonly left: readonly string[];
  /** The outermost instances that change, each as it is now drawn. */
  readonly replaced: readonly InstanceNode[];
}

/** Every instance of a repository's component in a tree that a primitive can draw. */
export const migrationOf = (root: DesignNode): PrimitivesMigration => {
  let drawn = 0;
  const count = () => {
    drawn += 1;
  };
  const left: string[] = [];
  const replaced: InstanceNode[] = [];
  const visit = (node: DesignNode) => {
    if (isRepositoryInstance(node)) {
      const meta = primitiveFor(node.component);
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
