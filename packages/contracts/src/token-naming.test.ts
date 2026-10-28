import { describe, expect, it } from "vitest";
import { foreignToken, numberCss, type ValueHint } from "./token-naming.ts";
import { TOKEN_TABLE, tokenKindOf } from "./token-table.ts";

const named = (path: string, hint: ValueHint) =>
  foreignToken(path.split("/"), hint);

describe("a token from another tool", () => {
  it.each<[string, ValueHint, string, string]>([
    // The format's type decides where it says what the value is.
    ["text/primary", "color", "color", "color-text-primary"],
    ["Color/Text/Primary", "color", "color", "color-text-primary"],
    ["Color/Primary", "color", "color", "color-primary"],
    ["Colors/Primary/500", "color", "color", "color-primary-500"],
    ["Color/Border/Default", "color", "color", "color-border-default"],
    ["Semantic/Primary", "color", "color", "color-primary"],
    ["Color/Danger/Danger", "color", "color", "color-danger"],
    ["Shadow/Card", "shadow", "shadow", "shadow-card"],
    ["elevation/raised", "shadow", "shadow", "shadow-elevation-raised"],
    ["font/body", "fontFamily", "font", "font-body"],
    ["fontFamily/sans", "fontFamily", "font", "font-sans"],
    ["font/weight/bold", "fontWeight", "fontWeight", "font-weight-bold"],
    ["motion/quick", "duration", "duration", "duration-motion-quick"],
    ["motion/swift", "cubicBezier", "easing", "ease-motion-swift"],
    // The path's words decide for a dimension or a number.
    ["Corner/sm", "dimension", "radius", "radius-sm"],
    ["Rounded/lg", "number", "radius", "radius-lg"],
    ["borderRadius/lg", "dimension", "radius", "radius-lg"],
    ["Primitives/Radius/Card", "number", "radius", "radius-card"],
    ["font/size/sm", "dimension", "fontSize", "text-sm"],
    ["Typography/Font size/Body LG", "number", "fontSize", "text-body-lg"],
    ["Typography/Line height/Body", "number", "leading", "leading-body"],
    ["letterSpacing/wide", "dimension", "tracking", "tracking-wide"],
    ["spacing/gap/md", "dimension", "spacing", "spacing-gap-md"],
    ["Gap/md", "number", "spacing", "spacing-gap-md"],
    ["Padding/Card", "number", "spacing", "spacing-padding-card"],
    ["Spacing/Grid/2/2", "number", "spacing", "spacing-grid-2-2"],
    ["spacing", "dimension", "spacing", "spacing"],
    ["Stroke/Thin", "number", "borderWidth", "border-width-thin"],
    ["border/width/thin", "dimension", "borderWidth", "border-width-thin"],
    ["screens/md", "dimension", "breakpoint", "breakpoint-md"],
    ["Weight/Bold", "number", "fontWeight", "font-weight-bold"],
    // Without a type, the path's words decide among every kind.
    ["colors/brand", null, "color", "color-brand"],
    ["shadows/sm", null, "shadow", "shadow-sm"],
    ["animation/spin", null, "animation", "animate-spin"],
    ["Font/Brand", "string", "font", "font-brand"],
  ])("%s (%s) is a %s token, %s", (path, hint, kind, name) => {
    expect(named(path, hint)).toEqual({ kind, name });
  });

  it.each<[string, ValueHint]>([
    ["size/small", "dimension"],
    ["Opacity/Disabled", "number"],
    ["Colors", "color"],
    ["Label/Submit", "string"],
    ["misc/thing", null],
    // A font named so that its name reads as a weight is left out, not misread.
    ["Font/Weight/Bold", "string"],
  ])("%s (%s) is left out, with a reason", (path, hint) => {
    const read = named(path, hint);
    expect("skipped" in read && read.skipped).toEqual(expect.any(String));
  });

  it("names a token its kind's prefix says, for every kind", () => {
    for (const { kind } of TOKEN_TABLE) {
      const read = foreignToken([kind, "x"], null);
      expect("name" in read && tokenKindOf(read.name)).toBe(kind);
    }
  });

  it("reads a number of a length kind in pixels", () => {
    expect(numberCss("radius", 12)).toBe("12px");
    expect(numberCss("spacing", 0.1234)).toBe("0.123px");
    expect(numberCss("tracking", 0.5)).toBe("0.5px");
    expect(numberCss("fontWeight", 700)).toBe("700");
    expect(numberCss("leading", 1.5)).toBe("1.5");
  });
});
