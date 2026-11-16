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
 * What a comment is: talk about the design, or a behaviour note (ADR 0030), what the code must do
 * that a design cannot show ("only admins see this"), which `/implement` carries to the code.
 */
const CommentKind = Schema.Literals(["comment", "behaviour"]);

/**
 * A note pinned on a page of the canvas, or on the canvas itself. On a page the pin sits at
 * `x`/`y` in the page's own pixels from its top-left corner, in the frame it was left in (the
 * page's own or one of its views, ADR 0036), so it stays put when the frame moves on the canvas.
 * On the canvas (`page` null) it sits in the pixels of the node it was left on, beside the pages,
 * and moves with it; left on nothing, at `x`/`y` of the canvas (ADR 0097). The node under the pin
 * is remembered too, by id and name, which is what an agent can act on.
 */
export const Comment = Schema.Struct({
  /** Who wrote it: git's user name, else the display name of the user's profile. */
  author: Schema.NullOr(Schema.String),
  createdAt: Timestamp,
  /** Name of the node the comment was placed on, as the layers panel shows it. */
  element: Schema.NullOr(Schema.String),
  id: Schema.String,
  /** A plain comment unless it says it is a behaviour note. */
  kind: CommentKind.pipe(
    Schema.withDecodingDefaultKey(Effect.succeed("comment" as const))
  ),
  /** Id of that node in the page's document. */
  nodeId: Schema.NullOr(Schema.String).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(null))
  ),
  /**
   * Path of the page inside its canvas, the key the canvas layout uses as well; null for a
   * comment on the canvas itself, beside the pages.
   */
  page: Schema.NullOr(Schema.String),
  /** The thread under the comment, oldest first. Files written before threads have none. */
  replies: Schema.Array(CommentReply).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed([]))
  ),
  resolved: Schema.Boolean,
  text: Schema.String,
  updatedAt: Timestamp,
  /**
   * The view of the page it was left in (ADR 0036), whose width its spot is measured at; null on
   * the page's own frame, and on the canvas. Files written before views had comments have none.
   */
  view: Schema.NullOr(Schema.String).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(null))
  ),
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
  kind: Schema.optional(CommentKind),
  nodeId: Schema.NullOr(Schema.String),
  page: Schema.NullOr(Schema.String),
  text: NonEmptyString,
  view: Schema.optional(Schema.NullOr(Schema.String)),
  x: Schema.Number,
  y: Schema.Number,
});
export type CreateCommentInput = typeof CreateCommentInput.Type;

/** Only what is given changes. */
export const UpdateCommentInput = Schema.Struct({
  canvas: CanvasId,
  id: Schema.String,
  kind: Schema.optional(CommentKind),
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
