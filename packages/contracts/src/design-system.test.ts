import { describe, expect, it } from "vitest";
import { starterTextStyles, textStyleGroup } from "./design-system.ts";

const token = (name: string) => ({ name, value: "1" });

describe("starterTextStyles", () => {
  it("builds the scale from the theme's tokens and leaves out what it lacks", () => {
    const styles = starterTextStyles({
      fonts: [token("font-mono")],
      leading: [token("leading-tight"), token("leading-normal")],
      sizes: [
        token("text-xs"),
        token("text-sm"),
        token("text-base"),
        token("text-3xl"),
        token("text-4xl"),
      ],
      weights: [token("font-weight-bold")],
    });
    expect(styles.map((s) => s.name)).toEqual([
      "Heading xxl",
      "Heading xl",
      "Heading xs",
      "Body",
      "Body sm",
      "Caption",
      "Label",
      "Code",
    ]);
    expect(styles[0]).toEqual({
      group: "heading",
      level: 1,
      lineHeight: "$leading-tight",
      name: "Heading xxl",
      role: "heading",
      size: "$text-4xl",
      weight: "$font-weight-bold",
    });
    // Semibold is not in the theme, so the style has no weight rather than a wrong one.
    expect(styles[2]).toEqual({
      group: "heading",
      level: 6,
      lineHeight: "$leading-normal",
      name: "Heading xs",
      role: "heading",
      size: "$text-base",
    });
    expect(styles.at(-1)).toMatchObject({ font: "$font-mono", group: "other" });
    expect(styles.map(textStyleGroup)).toEqual([
      "heading",
      "heading",
      "heading",
      "body",
      "body",
      "other",
      "other",
      "other",
    ]);
  });

  it("is empty without sizes", () => {
    expect(starterTextStyles({ fonts: [], sizes: [], weights: [] })).toEqual(
      []
    );
  });
});

describe("textStyleGroup", () => {
  it("reads the role when the style does not say", () => {
    expect(textStyleGroup({ name: "H", role: "heading" })).toBe("heading");
    expect(textStyleGroup({ name: "P", role: "paragraph" })).toBe("body");
    expect(
      textStyleGroup({ group: "other", name: "C", role: "paragraph" })
    ).toBe("other");
  });
});
