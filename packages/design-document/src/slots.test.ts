import type {
  Catalogue,
  ComponentSlot,
} from "@ultrapaint/contracts/catalogue";
import type { DesignNode, InstanceNode } from "@ultrapaint/contracts/document";
import { describe, expect, it } from "vitest";
import { fillSlots, slotLayoutOf } from "./slots.ts";

const SLOTS: readonly ComponentSlot[] = [
  { label: "Dialog", name: "root" },
  { holds: "nodes", label: "Trigger", layout: "row", name: "trigger" },
  {
    holds: "default",
    label: "Content",
    layout: "column",
    name: "dialog-content",
  },
  { holds: "nodes", label: "Footer", layout: "row", name: "dialog-footer" },
];

const text = (id: string, slot?: string): DesignNode =>
  ({
    id,
    role: "paragraph",
    text: id,
    type: "text",
    ...(slot !== undefined && { slot }),
  }) as DesignNode;

const dialog = (fields: Partial<InstanceNode> = {}): InstanceNode => ({
  component: "Dialog",
  from: "@ultrapaint/system",
  id: "d",
  type: "instance",
  ...fields,
});

const ids = (fills: ReturnType<typeof fillSlots>) =>
  Object.fromEntries(
    [...fills].map(([name, fill]) => [
      name,
      [fill.given ? "given" : "own", ...fill.nodes.map((n) => n.id)],
    ])
  );

describe("fillSlots", () => {
  it("puts each child in the slot it names, and the rest in the default one", () => {
    const fills = fillSlots(
      dialog({
        children: [
          text("why"),
          text("ok", "dialog-footer"),
          text("lost", "nowhere"),
          text("onRoot", "root"),
        ],
      }),
      SLOTS
    );
    // A slot that holds nothing (the root) or one the component lacks is the default one too.
    expect(ids(fills)).toEqual({
      "dialog-content": ["given", "why", "lost", "onRoot"],
      "dialog-footer": ["given", "ok"],
    });
  });

  it("gives a slot the instance leaves empty the component's own content", () => {
    const content = { "dialog-footer": [text("note")], trigger: [] };
    expect(ids(fillSlots(dialog(), SLOTS, content))).toEqual({
      "dialog-footer": ["own", "note"],
    });
    expect(
      ids(
        fillSlots(
          dialog({ children: [text("b", "dialog-footer")] }),
          SLOTS,
          content
        )
      )
    ).toEqual({ "dialog-footer": ["given", "b"] });
  });

  it("keeps a default slot that shows the instance's text", () => {
    const content = { "dialog-content": [text("filler")] };
    expect(ids(fillSlots(dialog({ text: "Hi" }), SLOTS, content))).toEqual({});
    expect(ids(fillSlots(dialog(), SLOTS, content))).toEqual({
      "dialog-content": ["own", "filler"],
    });
  });

  it("leaves out a child of a component with no default slot that names none of its own", () => {
    const named: readonly ComponentSlot[] = [
      { holds: "nodes", label: "Trigger", name: "trigger" },
    ];
    expect(
      ids(
        fillSlots(
          dialog({ children: [text("x"), text("t", "trigger")] }),
          named
        )
      )
    ).toEqual({ trigger: ["given", "t"] });
  });
});

describe("slotLayoutOf", () => {
  const catalogue: Catalogue = [
    {
      category: "Overlay",
      importFrom: "@ultrapaint/system",
      name: "Dialog",
      props: [],
      slots: SLOTS,
      variants: {},
    },
  ];

  it("lays a child out as the slot it fills, a slot it lacks being the default one", () => {
    expect(slotLayoutOf(dialog(), "dialog-footer", catalogue)).toBe("row");
    expect(slotLayoutOf(dialog(), undefined, catalogue)).toBe("column");
    expect(slotLayoutOf(dialog(), "nowhere", catalogue)).toBe("column");
    expect(
      slotLayoutOf(dialog({ component: "Unknown" }), undefined, catalogue)
    ).toBeNull();
  });
});
