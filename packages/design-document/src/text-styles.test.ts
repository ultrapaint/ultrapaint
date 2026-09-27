import type { TextStyle } from "@ultrapaint/contracts/design-system";
import type { TextNode } from "@ultrapaint/contracts/document";
import { describe, expect, it } from "vitest";
import {
  attachTextStyle,
  detachTextStyle,
  groupTextStyles,
  matchTextStyle,
} from "./text-styles.ts";

const title: TextStyle = {
  level: 2,
  lineHeight: "$leading-tight",
  name: "Heading xl",
  role: "heading",
  size: "$text-3xl",
  weight: "$font-weight-bold",
};
const body: TextStyle = {
  group: "body",
  lineHeight: "$leading-normal",
  name: "Body",
  role: "paragraph",
  size: "$text-base",
  weight: "$font-weight-normal",
};
const code: TextStyle = {
  font: "$font-mono",
  group: "other",
  name: "Code",
  role: "paragraph",
  size: "$text-sm",
};
const styles = [title, body, code];

const text = (fields: Partial<TextNode> = {}): TextNode => ({
  id: "t",
  role: "paragraph",
  text: "Hi",
  type: "text",
  ...fields,
});

describe("detachTextStyle", () => {
  it("copies the style's settings onto the text and drops the reference", () => {
    expect(detachTextStyle(text({ textStyle: "Heading xl" }), title)).toEqual({
      lineHeight: "$leading-tight",
      size: "$text-3xl",
      textStyle: null,
      weight: "$font-weight-bold",
    });
  });

  it("keeps what the text set over the style", () => {
    expect(
      detachTextStyle(text({ textStyle: "Heading xl", weight: 500 }), title)
    ).toEqual({
      lineHeight: "$leading-tight",
      size: "$text-3xl",
      textStyle: null,
    });
  });

  it("only drops the reference when the style is gone", () => {
    expect(detachTextStyle(text({ textStyle: "Old" }), undefined)).toEqual({
      textStyle: null,
    });
  });
});

describe("attachTextStyle", () => {
  it("names the style, clears the text's own settings and takes the style's role", () => {
    expect(attachTextStyle(title)).toEqual({
      font: null,
      level: 2,
      lineHeight: null,
      role: "heading",
      size: null,
      textStyle: "Heading xl",
      tracking: null,
      weight: null,
    });
    expect(attachTextStyle(body)).toMatchObject({
      level: null,
      role: "paragraph",
      textStyle: "Body",
    });
  });
});

describe("matchTextStyle", () => {
  it("finds the style the text's settings came from", () => {
    expect(
      matchTextStyle(text({ font: "$font-mono", size: "$text-sm" }), styles)
        ?.name
    ).toBe("Code");
  });

  it("falls back to the style for the role and level, then to the group", () => {
    expect(
      matchTextStyle(text({ level: 2, role: "heading", size: 40 }), styles)
        ?.name
    ).toBe("Heading xl");
    expect(
      matchTextStyle(text({ level: 4, role: "heading", size: 40 }), styles)
        ?.name
    ).toBe("Heading xl");
    expect(matchTextStyle(text({ size: 13 }), styles)?.name).toBe("Body");
  });

  it("has nothing to offer without styles", () => {
    expect(matchTextStyle(text(), [])).toBeUndefined();
  });
});

describe("groupTextStyles", () => {
  it("lists headings, body and the rest in that order, from role when unsaid", () => {
    expect(
      [...groupTextStyles([code, body, title])].map(([group, list]) => [
        group,
        list.map((s) => s.name),
      ])
    ).toEqual([
      ["heading", ["Heading xl"]],
      ["body", ["Body"]],
      ["other", ["Code"]],
    ]);
  });
});
