import type { Comment, CommentReply } from "@ultrapaint/contracts/comments";
import type { Page } from "@ultrapaint/contracts/pages";

const signed = (message: { author: string | null; text: string }) =>
  `${message.author ?? "Someone"}: ${message.text}`;

/**
 * What an agent is told about a comment: where on the design it was left, and what it says.
 * The whole thread, or one message of it; a reply sent alone carries what it answers.
 */
export const commentPrompt = (
  comment: Comment,
  page: Page | undefined,
  reply?: CommentReply
) => {
  const where = [
    page
      ? `Page: ${page.route} (${page.file})`
      : `Page: ${comment.page} (no longer in the designs)`,
    comment.element
      ? `Element: <${comment.element}>${comment.source ? ` at ${comment.source.file}:${comment.source.line}:${comment.source.col}` : ""}`
      : null,
    `Pinned at ${comment.x}, ${comment.y} px from the top-left corner of the page`,
  ].filter((line) => line !== null);

  const said = reply
    ? [`In reply to ${signed(comment)}`, "", signed(reply)]
    : [signed(comment), ...comment.replies.map(signed)];

  return [
    reply || comment.replies.length === 0
      ? "Address this comment left on the design canvas."
      : "Address this comment thread left on the design canvas.",
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
