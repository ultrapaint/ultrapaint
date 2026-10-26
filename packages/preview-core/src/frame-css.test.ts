import { describe, expect, it } from "vitest";
import {
  containerCondition,
  frameDeclarations,
  frameSelector,
} from "./frame-css.ts";

describe("a page's stylesheet in a frame", () => {
  it("says of the host what it said of the document's root", () => {
    expect(frameSelector(":root")).toBe(":host");
    expect(frameSelector("html")).toBe(":host");
    expect(frameSelector(":root.dark")).toBe(":host(.dark)");
    expect(frameSelector('html[data-theme="dark"]')).toBe(
      ':host([data-theme="dark"])'
    );
    expect(frameSelector(":root, :host")).toBe(":host, :host");
    expect(frameSelector(".dark :root")).toBe(".dark :host");
  });

  it("says of the frame's body what it said of the page's", () => {
    expect(frameSelector("body")).toBe("[data-ed-body]");
    expect(frameSelector("html body > main")).toBe(
      ":host [data-ed-body] > main"
    );
    expect(frameSelector(".body, tbody, .html")).toBe(".body, tbody, .html");
  });

  it("gives the host what it gives every element", () => {
    expect(frameSelector("*, ::before, ::after")).toBe(
      "*, ::before, ::after, :host"
    );
    expect(frameSelector(".a *")).toBe(".a *");
  });

  it("measures the window's units against the frame", () => {
    expect(frameDeclarations("min-height: 100vh; width: 50dvw;")).toBe(
      "min-height: 100cqh; width: 50cqw;"
    );
    expect(frameDeclarations("height: calc(100svh - 2rem);")).toBe(
      "height: calc(100cqh - 2rem);"
    );
  });

  it("asks the frame's size what it asked the window's", () => {
    expect(containerCondition("(width >= 48rem)")).toBe("(width >= 48rem)");
    expect(containerCondition("screen and (min-width: 768px)")).toBe(
      "(min-width: 768px)"
    );
    expect(containerCondition("(40rem <= width < 64rem)")).toBe(
      "(40rem <= width < 64rem)"
    );
    expect(containerCondition("(hover: hover)")).toBeNull();
    expect(containerCondition("(prefers-color-scheme: dark)")).toBeNull();
    expect(containerCondition("print")).toBeNull();
    expect(containerCondition("(min-width: 1px), print")).toBeNull();
    expect(
      containerCondition("(min-width: 40rem) and (prefers-reduced-motion)")
    ).toBeNull();
  });
});
