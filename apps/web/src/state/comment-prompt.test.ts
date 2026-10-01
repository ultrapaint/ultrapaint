import type { Comment } from "@ultrapaint/contracts/comments";
import type { Page } from "@ultrapaint/contracts/pages";
import { describe, expect, it } from "vitest";
import { commentPrompt, commentThreadTitle } from "./comment-prompt.ts";

const page: Page = {
  canvas: "",
  file: "designs/onboarding/pick.page.json",
  id: "onboarding/pick.page.json",
  name: "Pick",
  path: "onboarding/pick.page.json",
  route: "/onboarding/pick",
};

const comment: Comment = {
  author: "Ada",
  createdAt: 1,
  element: "Welcome",
  id: "comment_1",
  nodeId: "t_title",
  page: "onboarding/pick.page.json",
  replies: [
    { author: "Grace", createdAt: 2, id: "reply_1", text: "And larger" },
  ],
  resolved: false,
  text: "Make this bolder",
  updatedAt: 2,
  x: 40,
  y: 12,
};

describe("commentPrompt", () => {
  it("sends the whole thread with where it was left", () => {
    expect(commentPrompt(comment, page)).toBe(
      [
        "Address this comment and its replies, left on the design canvas.",
        "",
        "Page: Pick, /onboarding/pick (designs/onboarding/pick.page.json)",
        'Node: "Welcome" (id t_title)',
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

  it("names a page that is gone and a node with no id", () => {
    const prompt = commentPrompt(
      { ...comment, nodeId: null, replies: [] },
      undefined
    );
    expect(prompt).toContain(
      "Page: onboarding/pick.page.json (no longer in the designs)"
    );
    expect(prompt).toContain('Node: "Welcome"\n');
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
