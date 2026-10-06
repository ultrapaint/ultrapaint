import { Effect, Schema } from "effect";
import { CanvasId, NonEmptyString, Timestamp } from "./base.ts";

/** An answer in a comment's thread. */
export const CommentReply = Schema.Struct({
  author: Schema.NullOr(Schema.String),
  createdAt: Timestamp,
  id: Schema.String,
  text: Schema.String,
});
export type CommentReply = typeof CommentReply.Type;

/**
 * A note pinned on a page of the canvas. The pin sits at `x`/`y`, in the page's own pixels from
 * its top-left corner, so it stays put when the frame moves on the canvas. The node under the
 * pin is remembered too, by id and name, which is what an agent can act on.
 */
export const Comment = Schema.Struct({
  /** Who wrote it: the repository's git user, when there is one. */
  author: Schema.NullOr(Schema.String),
  createdAt: Timestamp,
  /** Name of the node the comment was placed on, as the layers panel shows it. */
  element: Schema.NullOr(Schema.String),
  id: Schema.String,
  /** Id of that node in the page's document. */
  nodeId: Schema.NullOr(Schema.String).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(null))
  ),
  /** Path of the page inside its canvas, the key the canvas layout uses as well. */
  page: Schema.String,
  /** The thread under the comment, oldest first. Files written before threads have none. */
  replies: Schema.Array(CommentReply).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed([]))
  ),
  resolved: Schema.Boolean,
  text: Schema.String,
  updatedAt: Timestamp,
  x: Schema.Number,
  y: Schema.Number,
});
export type Comment = typeof Comment.Type;

/** Contents of `<canvas>/comments.json`. */
export const CommentList = Schema.Struct({
  comments: Schema.Array(Comment),
  version: Schema.Literal(1),
});
export type CommentList = typeof CommentList.Type;

export const CreateCommentInput = Schema.Struct({
  canvas: CanvasId,
  element: Schema.NullOr(Schema.String),
  nodeId: Schema.NullOr(Schema.String),
  page: Schema.String,
  text: NonEmptyString,
  x: Schema.Number,
  y: Schema.Number,
});
export type CreateCommentInput = typeof CreateCommentInput.Type;

/** Only what is given changes. */
export const UpdateCommentInput = Schema.Struct({
  canvas: CanvasId,
  id: Schema.String,
  resolved: Schema.optional(Schema.Boolean),
  text: Schema.optional(NonEmptyString),
});
export type UpdateCommentInput = typeof UpdateCommentInput.Type;

export const ReplyInput = Schema.Struct({
  canvas: CanvasId,
  id: Schema.String,
  text: NonEmptyString,
});
export type ReplyInput = typeof ReplyInput.Type;
