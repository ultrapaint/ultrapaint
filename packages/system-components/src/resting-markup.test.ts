// The server renders the views, so these run in Node, with no document (ADR 0150).
import { SYSTEM_FROM } from "@ultrapaint/contracts/component-names";
import type { DesignNode } from "@ultrapaint/contracts/document";
import type { ClassWriter } from "@ultrapaint/contracts/node-style";
import {
  INSTANCE_MARK,
  type Markup,
  SLOT_PLACEHOLDER,
  toHtml,
} from "@ultrapaint/design-document/code";
import { describe, expect, it } from "vitest";
import { catalogueOf } from "./catalogue.ts";
import { defaultLookOf } from "./defaults.ts";
import { restingMarkupOf, systemDrawingOf } from "./resting-markup.tsx";

/** The elements of markup, depth first, each with its attributes as a record. */
const elementsOf = (markup: readonly Markup[]) => {
  const out: { attributes: Record<string, string>; tag: string }[] = [];
  const visit = (m: Markup) => {
    if (m.kind === "element") {
      out.push({ attributes: Object.fromEntries(m.attributes), tag: m.tag });
      m.children.forEach(visit);
    }
  };
  markup.forEach(visit);
  return out;
};

/** A style system that writes each declaration as a class, to see what it is given. */
const writer: ClassWriter = {
  classes: (styles) =>
    styles.flatMap(({ declarations }) =>
      Object.entries(declarations).map(([p, v]) => `${p}:${v}`)
    ),
};

describe("restingMarkupOf", () => {
  it("renders a view at rest in the instance's variant, its element marked and its slots held", () => {
    const [button] = restingMarkupOf("Button", { variant: "outline" }, [
      "root",
    ]);
    expect(button).toEqual({
      attributes: [
        ["type", "button"],
        [INSTANCE_MARK, ""],
        ["data-size", "md"],
        ["data-slot", "root"],
        ["data-system", "button"],
        ["data-variant", "outline"],
      ],
      children: [
        {
          attributes: [["name", "root"]],
          children: [],
          kind: "element",
          tag: SLOT_PLACEHOLDER,
        },
      ],
      kind: "element",
      tag: "button",
    });
  });

  it("draws an overlay closed: its trigger and none of its popup, whatever the design opens", () => {
    const select = elementsOf(
      restingMarkupOf("Select", { label: "Plan", open: true }, [])
    ).map((e) => e.attributes["data-slot"]);
    expect(select).toContain("select-trigger");
    expect(select).not.toContain("select-popup");
  });

  it("draws nothing for an overlay with no trigger, a dialog without one or a toast", () => {
    expect(
      restingMarkupOf("Dialog", { open: true, title: "Sure?" }, [])
    ).toEqual([]);
    expect(
      restingMarkupOf("Toast", { open: true, title: "Saved" }, [])
    ).toEqual([]);
  });

  it("keeps an attribute's and a text's characters as they are", () => {
    const [field] = restingMarkupOf(
      "Input",
      { label: 'Say "hi" & <wave>', placeholder: "a < b" },
      []
    );
    const all = elementsOf(field ? [field] : []);
    expect(all.find((e) => e.tag === "input")?.attributes.placeholder).toBe(
      "a < b"
    );
    expect(JSON.stringify(field)).toContain('Say \\"hi\\" & <wave>');
  });

  it("knows no component that is not a system component", () => {
    expect(restingMarkupOf("Nope", {}, [])).toEqual([]);
  });
});

describe("systemDrawingOf", () => {
  const catalogue = catalogueOf([]);

  it("writes a system component's instance as HTML with its default look's classes", () => {
    const go: DesignNode = {
      component: "Button",
      from: SYSTEM_FROM,
      id: "b",
      text: "Go",
      type: "instance",
    };
    const html = toHtml(go, writer, {
      catalogue,
      systemDrawing: systemDrawingOf([]),
    });
    expect(html).toContain("<button");
    expect(html).toContain("background:$color-primary");
    expect(html).toContain('data-variant="primary"');
    expect(html).toContain("  Go\n</button>");
    expect(html).not.toContain("data-system");
    expect(html).not.toContain(INSTANCE_MARK);
  });

  it("draws the project's look over the default one", () => {
    const own = defaultLookOf("Button");
    if (!own) {
      throw new Error("Button has a default look");
    }
    const drawing = systemDrawingOf([
      { ...own, base: { root: { fill: "$color-accent" } } },
    ])("Button");
    expect(drawing?.looks).toHaveLength(2);
    expect(drawing?.looks[1]?.base.root?.fill).toBe("$color-accent");
  });

  it("writes an instance that sets no member in the one the project's look starts in (ADR 0161)", () => {
    // A look that sets nothing but its members: the default look draws the member it starts in.
    const look = {
      base: {},
      members: { variant: { remove: ["primary"] } },
      name: "Button",
      origin: "system" as const,
      states: {},
      variants: {},
      version: 1 as const,
    };
    const go: DesignNode = {
      component: "Button",
      from: SYSTEM_FROM,
      id: "b",
      text: "Go",
      type: "instance",
    };
    const html = toHtml(go, writer, {
      catalogue: catalogueOf([look]),
      systemDrawing: systemDrawingOf([look]),
    });
    expect(html).toContain("background:$color-secondary");
    expect(html).not.toContain("background:$color-primary");
  });

  it("knows no drawing for a name that is no system component", () => {
    expect(systemDrawingOf([])("Nope")).toBeUndefined();
  });
});

describe("two instances written together", () => {
  it("keep the ids their parts make up apart, each starting with its instance's", () => {
    const drawing = systemDrawingOf([])("Select");
    const ids = ["a", "b"].map((id) =>
      elementsOf(drawing?.markup({ id, props: { label: "Plan" } }, []) ?? [])
        .map((e) => e.attributes.id)
        .filter((v): v is string => v !== undefined)
    );
    expect(ids[0]?.length).toBeGreaterThan(0);
    expect(ids[0]?.every((id) => id.includes("a-"))).toBe(true);
    expect(ids[1]?.some((id) => ids[0]?.includes(id))).toBe(false);
  });
});
