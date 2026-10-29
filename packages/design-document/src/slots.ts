/**
 * An instance's slots (ADRs 0040, 0041, 0042), one rule for both origins over the catalogue's
 * entry: a child fills the slot it names when that slot holds nodes, and the default slot
 * otherwise (it names none, or names no slot the component has); a slot it gives nothing holds
 * the component's own content; and each slot lays out what it holds as the catalogue says, a
 * look's `direction` included, in the instance's variant. The renderer, the Code tab, the
 * inspector and the server's fill warnings all ask here, so the canvas and the code agree,
 * without asking the frame how it drew.
 */
import {
  type Catalogue,
  type ComponentMeta,
  type ComponentSlot,
  metaOf,
  type SlotLayout,
} from "@ultrapaint/contracts/catalogue";
import { variantKey } from "@ultrapaint/contracts/component-names";
import type { DesignNode, InstanceNode } from "@ultrapaint/contracts/document";

/** The slot a child naming `name` fills: the slot of that name that holds nodes, else the default. */
export const slotFor = (
  slots: readonly ComponentSlot[],
  name: string | undefined
): ComponentSlot | undefined =>
  (name === undefined
    ? undefined
    : slots.find((s) => s.name === name && s.holds !== undefined)) ??
  slots.find((s) => s.holds === "default");

/** What a slot holds. */
export interface SlotFill {
  /** The instance's own children, the page's; otherwise the component's content, not the page's. */
  readonly given: boolean;
  readonly nodes: readonly DesignNode[];
}

/**
 * What each slot of an instance holds, by the slot's name, in the component's order: the
 * children that fill it (`slotFor`), or, given none, its `content` (a system component's look's,
 * an app component's tree's). A default slot is not empty while the instance shows its text.
 * A child that fills no slot (the component has no default one) is left out.
 */
export const fillSlots = (
  instance: InstanceNode,
  slots: readonly ComponentSlot[],
  content: Readonly<Record<string, readonly DesignNode[]>> = {}
): ReadonlyMap<string, SlotFill> => {
  const given = new Map<string, DesignNode[]>();
  for (const child of instance.children ?? []) {
    const slot = slotFor(slots, child.slot);
    if (slot) {
      given.set(slot.name, [...(given.get(slot.name) ?? []), child]);
    }
  }
  const fills = new Map<string, SlotFill>();
  for (const slot of slots) {
    const nodes = given.get(slot.name);
    const own = content[slot.name];
    const showsText =
      slot.holds === "default" &&
      instance.text !== undefined &&
      (instance.children ?? []).length === 0;
    if (nodes) {
      fills.set(slot.name, { given: true, nodes });
    } else if (slot.holds && own && own.length > 0 && !showsText) {
      fills.set(slot.name, { given: false, nodes: own });
    }
  }
  return fills;
};

/** The member of each axis an instance is drawn in: its prop, else the default. */
const membersOf = (
  meta: ComponentMeta,
  props: InstanceNode["props"]
): string[] =>
  Object.entries(meta.variants).flatMap(([axis, members]) => {
    const given = props?.[axis];
    const fallback = meta.props.find((p) => p.name === axis)?.defaultValue;
    let member = typeof fallback === "string" ? fallback : members[0];
    if (typeof given === "string" && members.includes(given)) {
      member = given;
    }
    return member === undefined ? [] : [variantKey(axis, member)];
  });

/**
 * How the slot a child naming `slot` fills lays out what it holds, in the instance's variant and
 * at the breakpoints that hold where it is drawn (`holding`, smallest first, as `upTo` gives
 * them), each over the one before as the tree's overrides are laid; null when the catalogue does
 * not know the component. A slot that says nothing is a block.
 */
export const slotLayoutOf = (
  instance: InstanceNode,
  slot: string | undefined,
  catalogue: Catalogue,
  holding: readonly string[] = []
): SlotLayout | null => {
  const meta = metaOf(catalogue, instance);
  if (!meta) {
    return null;
  }
  const filled = slotFor(meta.slots, slot);
  if (!filled) {
    return null;
  }
  const over = [...membersOf(meta, instance.props), ...holding]
    .map((key) => filled.layoutIn?.[key])
    .findLast((layout) => layout !== undefined);
  return over ?? filled.layout ?? "block";
};
