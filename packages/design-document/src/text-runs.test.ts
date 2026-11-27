import type { TextNode } from "@ultrapaint/contracts/document";
import { describe, expect, it } from "vitest";
import { linkWords, reworded } from "./text-runs.ts";

const legal: TextNode = {
  id: "legal",
  role: "paragraph",
  runs: [
    { text: "By signing up you accept the " },
    { link: "terms.page.json", text: "terms" },
    { text: "." },
  ],
  text: "By signing up you accept the terms.",
  type: "text",
};

describe("a text's words changed in the inspector's Text field", () => {
  it("keep a link on its words, wherever the words around it change", () => {
    expect(reworded(legal, "Signing up, you accept the terms!")).toEqual({
      runs: [
        { text: "Signing up, you accept the " },
        { link: "terms.page.json", text: "terms" },
        { text: "!" },
      ],
      text: "Signing up, you accept the terms!",
    });
  });

  it("take the link off once its words are gone, and leave a plain text", () => {
    expect(reworded(legal, "By signing up you accept.")).toEqual({
      runs: null,
      text: "By signing up you accept.",
    });
  });

  it("are a plain text's words alone", () => {
    expect(
      reworded({ ...legal, runs: undefined, text: "Hello" }, "Hello there")
    ).toEqual({ text: "Hello there" });
  });
});

describe("words given a link with ⌘K", () => {
  const plain: TextNode = {
    id: "legal",
    role: "paragraph",
    text: "By signing up you accept the terms",
    type: "text",
  };
  const terms = { end: 34, start: 29 };

  it("lead there, those words alone", () => {
    expect(linkWords(plain, terms, "terms.page.json")).toEqual({
      runs: [
        { text: "By signing up you accept the " },
        { link: "terms.page.json", text: "terms" },
      ],
      text: "By signing up you accept the terms",
    });
  });

  it("lead nowhere once the link is taken off, leaving a plain text", () => {
    const linked = { ...plain, ...linkWords(plain, terms, "terms.page.json") };
    expect(linkWords(linked as TextNode, terms, null)).toEqual({
      runs: null,
      text: "By signing up you accept the terms",
    });
  });

  it("are given no link in a text that links as a whole", () => {
    expect(
      linkWords({ ...plain, link: "home.page.json" }, terms, "terms.page.json")
    ).toBeNull();
  });
});
