import { describe, expect, it } from "vitest";
import { boardPickText, scopeOf } from "./prompt-content.ts";

const DS = "docs/designs/design-system.json";
const BUTTON = "docs/designs/components/Button.component.json";

describe("a board's pick, as the agent is told it (ADR 0045, B11)", () => {
  it("names a token with its value in each theme, and its file", () => {
    expect(
      boardPickText({
        detail: "light #2563eb, dark #60a5fa",
        file: DS,
        kind: "board",
        name: "color-primary-600",
        pick: "token",
      })
    ).toBe(
      "The user has picked the token color-primary-600 of the design system (light #2563eb, dark #60a5fa), kept in docs/designs/design-system.json. Changes should target this token unless told otherwise."
    );
  });

  it("names a group, a text style, a foundation and a guideline", () => {
    expect(
      boardPickText({
        detail: "11 tokens, color-primary-50 to color-primary-950",
        file: DS,
        kind: "board",
        name: "primary",
        pick: "group",
      })
    ).toContain("the colour group primary of the design system (11 tokens");
    expect(
      boardPickText({
        detail: "size $text-sm, weight 500",
        file: DS,
        kind: "board",
        name: "body",
        pick: "textStyle",
      })
    ).toContain("the text style body of the design system (size $text-sm");
    expect(
      boardPickText({
        file: DS,
        kind: "board",
        name: "Spacing",
        pick: "foundation",
      })
    ).toContain("looking at the design system's Spacing, kept in");
    expect(
      boardPickText({
        file: "DESIGN.md",
        kind: "board",
        name: "Colors",
        pick: "guideline",
      })
    ).toBe(
      'The user is looking at the section "Colors" of DESIGN.md, the design system\'s guidelines. Changes should target this section unless told otherwise.'
    );
  });

  it("says where a system component's file keeps its look at the place picked", () => {
    const at = (variant?: string, state?: string) =>
      boardPickText({
        file: BUTTON,
        kind: "board",
        name: "Button",
        pick: "systemComponent",
        ...(variant && { variant }),
        ...(state && { state }),
      });
    expect(at("variant=outline", "hover")).toBe(
      "The user has picked the look of the system component Button at variant=outline in the hover state: variantStates.variant.outline.hover of docs/designs/components/Button.component.json. Changes should target that place of its look unless told otherwise."
    );
    expect(at("size=lg")).toContain(": variants.size.lg of");
    expect(at(undefined, "focus")).toContain(
      "at the focus state: states.focus of"
    );
    expect(at()).toBe(
      "The user has picked the system component Button, whose look is docs/designs/components/Button.component.json. Changes should target its look unless told otherwise."
    );
  });

  it("names an app component's variant by the key its overrides are kept under", () => {
    expect(
      boardPickText({
        file: "docs/designs/components/SiteHeader.component.json",
        kind: "board",
        name: "SiteHeader",
        pick: "appComponent",
        variant: "tone=featured",
      })
    ).toBe(
      'The user has picked the variant tone=featured of the app component SiteHeader (what its nodes override under at["tone=featured"]), kept in docs/designs/components/SiteHeader.component.json. Changes should target that variant unless told otherwise.'
    );
  });

  it("gives a thread no scope: a board's pick is not on the canvas", () => {
    expect(
      scopeOf([
        { file: DS, kind: "board", name: "color-primary-600", pick: "token" },
      ])
    ).toBeNull();
  });
});
