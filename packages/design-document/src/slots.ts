/**
 * An instance's slots (ADRs 0040, 0041, 0042), one rule for both origins over the catalogue's
 * entry: a child fills the slot it names when that slot holds nodes, and the default slot
 * otherwise (it names none, or names no slot the component has); and each slot lays out what it
 * holds as the catalogue says, a look's `direction` included, in the instance's variant. The
 * renderer, the Code tab, the inspector and the server's fill warnings all ask here, so the canvas
 * and the code agree, without asking the frame how it drew.
 */
import {
  type Catalogue,
  type ComponentMeta,
  type ComponentSlot,
  metaOf,
  type SlotLayout,
} from "@ultrapaint/contracts/catalogue";
import { variantKey } from "@ultrapaint/contracts/component-names";
import type { InstanceNode } from "@ultrapaint/contracts/document";

/** The slot a child naming `name` fills: the slot of that name that holds nodes, else the default. */
export const slotFor = (
  slots: readonly ComponentSlot[],
  name: string | undefined
): ComponentSlot | undefined =>
  (name === undefined
    ? undefined
    : slots.find((s) => s.name === name && s.holds !== undefined)) ??
  slots.find((s) => s.holds === "default");

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
 * How the slot a child naming `slot` fills lays out what it holds, in the instance's variant;
 * null when the catalogue does not know the component. A slot that says nothing is a block.
 */
export const slotLayoutOf = (
  instance: InstanceNode,
  slot: string | undefined,
  catalogue: Catalogue
): SlotLayout | null => {
  const meta = metaOf(catalogue, instance);
  if (!meta) {
    return null;
  }
  const filled = slotFor(meta.slots, slot);
  if (!filled) {
    return null;
  }
  const inVariant = membersOf(meta, instance.props)
    .map((key) => filled.layoutIn?.[key])
    .findLast((layout) => layout !== undefined);
  return inVariant ?? filled.layout ?? "block";
};
