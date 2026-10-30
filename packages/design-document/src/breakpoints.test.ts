import { emptyDesignSystem } from "@ultrapaint/contracts/design-system";
import type {
  DesignNode,
  PageNode,
  StackNode,
} from "@ultrapaint/contracts/document";
import { describe, expect, it } from "vitest";
import {
  breakpointAt,
  breakpointsOf,
  breakpointsUsed,
  DEFAULT_BREAKPOINTS,
  resolveAt,
  sourceOf,
  visibilityOf,
  withVisibility,
} from "./breakpoints.ts";
import { makeIdGenerator } from "./ids.ts";
import { applyOps } from "./ops.ts";
import { findNode } from "./tree.ts";

const stack: StackNode = {
  at: { lg: { gap: 32 }, md: { gap: 24, type: "row" } },
  children: [
    {
      at: { md: { hidden: false } },
      hidden: true,
      id: "menu",
      role: "paragraph",
      text: "Menu",
      type: "text",
    },
    { id: "plain", role: "paragraph", text: "Plain", type: "text" },
  ],
  gap: 16,
  id: "stack",
  type: "column",
};

const page: PageNode = { children: [stack], id: "root", type: "page" };

describe("breakpoints", () => {
  it("are the design system's, smallest first, and Tailwind's when it names none", () => {
    expect(breakpointsOf(null)).toBe(DEFAULT_BREAKPOINTS);
    const ds = {
      ...emptyDesignSystem(),
      layout: {
        breakpoints: [
          { name: "breakpoint-wide", value: "80rem" },
          { name: "breakpoint-tab", value: "600px" },
        ],
      },
    };
    expect(breakpointsOf(ds)).toEqual([
      { min: 600, name: "tab" },
      { min: 1280, name: "wide" },
    ]);
  });

  it("reads a breakpoint in em as a media query does, and leaves out one that is no length", () => {
    const ds = {
      ...emptyDesignSystem(),
      layout: {
        breakpoints: [
          { name: "breakpoint-md", value: "48em" },
          { name: "breakpoint-bare", value: "900" },
        ],
      },
    };
    expect(breakpointsOf(ds)).toEqual([{ min: 768, name: "md" }]);
  });

  it("finds the breakpoint a width falls in: none below the first", () => {
    expect(breakpointAt(DEFAULT_BREAKPOINTS, 390)).toBeNull();
    expect(breakpointAt(DEFAULT_BREAKPOINTS, 768)?.name).toBe("md");
    expect(breakpointAt(DEFAULT_BREAKPOINTS, 1440)?.name).toBe("xl");
  });

  it("resolves a tree at a width, mobile-first, and keeps a tree without overrides as it is", () => {
    const phone = resolveAt(page, DEFAULT_BREAKPOINTS, 390);
    const [small] = (phone as PageNode).children as [StackNode];
    expect(small).toMatchObject({ gap: 16, type: "column" });
    expect(small.at).toBeUndefined();
    expect(small.children[0]?.hidden).toBe(true);

    const [tablet] = (resolveAt(page, DEFAULT_BREAKPOINTS, 834) as PageNode)
      .children as [StackNode];
    expect(tablet).toMatchObject({ gap: 24, type: "row" });
    expect(tablet.children[0]?.hidden).toBe(false);

    const [desktop] = (resolveAt(page, DEFAULT_BREAKPOINTS, 1440) as PageNode)
      .children as [StackNode];
    expect(desktop).toMatchObject({ gap: 32, type: "row" });
    // What no breakpoint touches is the same object, so the renderer draws it as it was.
    expect(desktop.children[1]).toBe(stack.children[1]);
    expect(resolveAt(page, DEFAULT_BREAKPOINTS, 1440)).toBe(
      resolveAt(page, DEFAULT_BREAKPOINTS, 1440)
    );
    const flat = { children: [], id: "p", type: "page" } as PageNode;
    expect(resolveAt(flat, DEFAULT_BREAKPOINTS, 1440)).toBe(flat);
  });

  it("lays an instance's props of a breakpoint over its own, one by one", () => {
    const node = {
      at: { md: { props: { size: "lg" } } },
      component: "Button",
      from: "@ultrapaint/system" as const,
      id: "b",
      props: { size: "sm", variant: "outline" },
      type: "instance" as const,
    };
    expect(resolveAt(node, DEFAULT_BREAKPOINTS, 800)).toMatchObject({
      props: { size: "lg", variant: "outline" },
    });
  });

  it("says where a value comes from and which breakpoints a tree sets anything at", () => {
    expect(sourceOf(stack, "gap", DEFAULT_BREAKPOINTS, "xl")).toBe("lg");
    expect(sourceOf(stack, "type", DEFAULT_BREAKPOINTS, "xl")).toBe("md");
    expect(sourceOf(stack, "gap", DEFAULT_BREAKPOINTS, "sm")).toBeNull();
    expect(
      breakpointsUsed(page, DEFAULT_BREAKPOINTS).map((b) => b.name)
    ).toEqual(["md", "lg"]);
  });
});

describe("writing at a breakpoint", () => {
  const options = () => ({ canvas: false, next: makeIdGenerator(["root"]) });

  it("sets fields from a breakpoint on, and takes away what is left empty", () => {
    const { root } = applyOps(
      page,
      [
        { at: "md", id: "plain", op: "update", set: { size: 20 } },
        { at: "md", id: "stack", op: "update", set: { gap: null, type: null } },
      ],
      options()
    );
    expect(findNode(root, "plain")).toMatchObject({
      at: { md: { size: 20 } },
      text: "Plain",
    });
    expect((findNode(root, "stack") as StackNode).at).toEqual({
      lg: { gap: 32 },
    });
    const { root: back } = applyOps(
      root,
      [{ at: "md", id: "plain", op: "update", set: { size: null } }],
      options()
    );
    expect(findNode(back, "plain")?.at).toBeUndefined();
  });

  it("refuses what is the same at every breakpoint, and a type that is not a row's or a column's", () => {
    expect(() =>
      applyOps(
        page,
        [{ at: "md", id: "plain", op: "update", set: { link: "/" } }],
        options()
      )
    ).toThrow("same at every breakpoint");
    expect(() =>
      applyOps(
        page,
        [{ at: "md", id: "stack", op: "update", set: { type: "group" } }],
        options()
      )
    ).toThrow("row or a column");
  });

  it("sets an instance's props from a breakpoint on", () => {
    const withButton: PageNode = {
      children: [
        {
          component: "Button",
          from: "@ultrapaint/system",
          id: "b",
          type: "instance",
        },
      ],
      id: "root",
      type: "page",
    };
    const { root } = applyOps(
      withButton,
      [{ at: "lg", id: "b", op: "setProps", props: { size: "lg" } }],
      options()
    );
    expect(findNode(root, "b")?.at).toEqual({ lg: { props: { size: "lg" } } });
  });
});

describe("visibility", () => {
  const text = (fields: object) =>
    ({
      id: "t",
      role: "paragraph",
      text: "Hi",
      type: "text",
      ...fields,
    }) as DesignNode;

  it("reads the one rule a node's hidden comes to", () => {
    const b = DEFAULT_BREAKPOINTS;
    expect(visibilityOf(text({}), b)).toEqual({ kind: "every" });
    expect(visibilityOf(text({ hidden: true }), b)).toEqual({ kind: "none" });
    expect(
      visibilityOf(text({ at: { md: { hidden: false } }, hidden: true }), b)
    ).toEqual({ at: "md", kind: "from" });
    expect(visibilityOf(text({ at: { lg: { hidden: true } } }), b)).toEqual({
      at: "lg",
      kind: "below",
    });
    expect(
      visibilityOf(
        text({ at: { lg: { hidden: true }, md: { hidden: true } } }),
        b
      )
    ).toEqual({ at: "md", kind: "below" });
    expect(
      visibilityOf(
        text({
          at: { lg: { hidden: true }, md: { hidden: false } },
          hidden: true,
        }),
        b
      )
    ).toEqual({ kind: "custom" });
  });

  it("writes a rule over whatever the breakpoints said, keeping their other fields", () => {
    const node = text({
      at: { lg: { hidden: true, size: 20 }, md: { hidden: false } },
      hidden: true,
    });
    expect(withVisibility(node, { at: "md", kind: "below" })).toEqual({
      at: { lg: { size: 20 }, md: { hidden: true } },
      hidden: null,
    });
    expect(withVisibility(node, { kind: "every" })).toEqual({
      at: { lg: { size: 20 } },
      hidden: null,
    });
    expect(withVisibility(text({}), { at: "xl", kind: "from" })).toEqual({
      at: { xl: { hidden: false } },
      hidden: true,
    });
  });
});
