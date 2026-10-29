import { SYSTEM_FROM } from "@ultrapaint/contracts/component-names";
import type { InstanceNode } from "@ultrapaint/contracts/document";
import { systemCatalogue } from "@ultrapaint/system-components/catalogue";
import { describe, expect, it } from "vitest";
import { childrenInSlot } from "./slots.ts";

const dialog = systemCatalogue().find((c) => c.name === "Dialog");
const slots = (dialog?.slots ?? []).filter((s) => s.holds);
const slot = (name: string) => {
  const found = slots.find((s) => s.name === name);
  if (!found) {
    throw new Error(`no slot ${name}`);
  }
  return found;
};

const node: InstanceNode = {
  children: [
    { id: "why", role: "paragraph", text: "Why?", type: "text" },
    { id: "lost", role: "paragraph", slot: "nowhere", text: "?", type: "text" },
    {
      component: "Button",
      from: SYSTEM_FROM,
      id: "ok",
      slot: "dialog-footer",
      type: "instance",
    },
  ],
  component: "Dialog",
  from: SYSTEM_FROM,
  id: "d",
  type: "instance",
};

describe("a system component's slot", () => {
  it("holds the children that name it", () => {
    expect(
      childrenInSlot(node, slot("dialog-footer"), slots).map((c) => c.id)
    ).toEqual(["ok"]);
    expect(childrenInSlot(node, slot("dialog-header"), slots)).toEqual([]);
  });

  it("is the default one for the children that name none, or name no slot it has", () => {
    expect(
      childrenInSlot(node, slot("dialog-content"), slots).map((c) => c.id)
    ).toEqual(["why", "lost"]);
  });
});
