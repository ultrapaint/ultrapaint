import type { Comment, CommentReply } from "@ultrapaint/contracts/comments";
import type { Page } from "@ultrapaint/contracts/pages";

const signed = (message: { author: string | null; text: string }) =>
  `${message.author ?? "Someone"}: ${message.text}`;

/** Where on the page a comment was left: the place, and its frame's corner its spot is from. */
const placeOf = (comment: Comment, page: Page | undefined) => {
  if (comment.page === null) {
    // On the canvas itself (ADR 0097): on a node beside the pages, from its corner, or anywhere.
    return {
      corner: comment.nodeId === null ? "the canvas" : "the node's frame",
      place: "On the canvas, beside the pages",
    };
  }
  const place = page
    ? `Page: ${page.name}, ${page.route ?? "no URL"} (${page.file})`
    : `Page: ${comment.page} (no longer in the designs)`;
  return comment.view === null
    ? { corner: "the page", place }
    : { corner: `the page's view ${comment.view}`, place };
};

/**
 * What an agent is told about a comment: where on the design it was left, and what it says.
 * The whole thread, or one message of it; a reply sent alone carries what it answers.
 */
export const commentPrompt = (
  comment: Comment,
  page: Page | undefined,
  reply?: CommentReply
) => {
  const { corner, place } = placeOf(comment, page);
  const where = [
    place,
    comment.element
      ? `Node: "${comment.element}"${comment.nodeId ? ` (id ${comment.nodeId})` : ""}`
      : null,
    `Pinned at ${comment.x}, ${comment.y} px from the top-left corner of ${corner}`,
  ].filter((line) => line !== null);

  const said = reply
    ? [`In reply to ${signed(comment)}`, "", signed(reply)]
    : [signed(comment), ...comment.replies.map(signed)];

  return [
    reply || comment.replies.length === 0
      ? "Address this comment left on the design canvas."
      : "Address this comment and its replies, left on the design canvas.",
    "",
    ...where,
    "",
    ...said,
  ].join("\n");
};

/** A title for a thread started from a comment: its first words. */
export const commentThreadTitle = (text: string) => {
  const line = text.trim().split("\n")[0] ?? "";
  return `Comment: ${line.length > 40 ? `${line.slice(0, 39)}…` : line}`;
};
