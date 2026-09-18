import type { Comment } from "@ultrapaint/contracts/comments";
import type { Page } from "@ultrapaint/contracts/pages";
import { describe, expect, it } from "vitest";
import { commentPrompt, commentThreadTitle } from "./comment-prompt.ts";

const page: Page = {
  file: "designs/onboarding/pick.tsx",
  id: "onboarding/pick.tsx",
  name: "Pick",
  path: "onboarding/pick.tsx",
  route: "/onboarding/pick",
  space: "",
};

const comment: Comment = {
  author: "Ada",
  createdAt: 1,
  element: "h1",
  id: "comment_1",
  page: "onboarding/pick.tsx",
  replies: [
    { author: "Grace", createdAt: 2, id: "reply_1", text: "And larger" },
  ],
  resolved: false,
  source: { col: 6, file: "designs/onboarding/pick.tsx", line: 4 },
  text: "Make this bolder",
  updatedAt: 2,
  x: 40,
  y: 12,
};

describe("commentPrompt", () => {
  it("sends the whole thread with where it was left", () => {
    expect(commentPrompt(comment, page)).toBe(
      [
        "Address this comment thread left on the design canvas.",
        "",
        "Page: /onboarding/pick (designs/onboarding/pick.tsx)",
        "Element: <h1> at designs/onboarding/pick.tsx:4:6",
        "Pinned at 40, 12 px from the top-left corner of the page",
        "",
        "Ada: Make this bolder",
        "Grace: And larger",
      ].join("\n")
    );
  });

  it("sends a reply alone with what it answers", () => {
    const [reply] = comment.replies;
    const prompt = commentPrompt(comment, page, reply);
    expect(prompt).toContain(
      "In reply to Ada: Make this bolder\n\nGrace: And larger"
    );
    expect(prompt.startsWith("Address this comment left")).toBe(true);
  });

  it("names a page that is gone and an element with no source", () => {
    const prompt = commentPrompt(
      { ...comment, replies: [], source: null },
      undefined
    );
    expect(prompt).toContain(
      "Page: onboarding/pick.tsx (no longer in the designs)"
    );
    expect(prompt).toContain("Element: <h1>\n");
  });
});

describe("commentThreadTitle", () => {
  it("keeps the first line, shortened", () => {
    expect(commentThreadTitle("Short\nmore")).toBe("Comment: Short");
    expect(commentThreadTitle("x".repeat(60))).toBe(
      `Comment: ${"x".repeat(39)}…`
    );
  });
});
