/**
 * A primitive's slots as its children fill them (ADR 0040): a child names the slot it fills, and
 * one that names none, or names no slot the primitive has, fills the default one.
 */
import type { ComponentMeta } from "@ultrapaint/contracts/catalogue";
import type { DesignNode, InstanceNode } from "@ultrapaint/contracts/document";

export type Slot = NonNullable<ComponentMeta["slots"]>[number];

/** The children of an instance that fill a slot: those that name it, or name none for the default. */
export const childrenInSlot = (
  node: InstanceNode,
  slot: Slot,
  slots: readonly Slot[]
): readonly DesignNode[] =>
  (node.children ?? []).filter((child) =>
    slot.holds === "default"
      ? child.slot === undefined || !slots.some((s) => s.name === child.slot)
      : child.slot === slot.name
  );
