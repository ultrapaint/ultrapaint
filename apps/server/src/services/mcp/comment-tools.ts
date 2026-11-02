/**
 * The tools of the comments on the designs, where the user asks for things: reading them,
 * answering one, and marking one done.
 */
import { Effect, Schema } from "effect";
import { Tool, Toolkit } from "effect/ai";
import { CommentsService } from "../comments.ts";
import { makeLookup } from "./lookup.ts";
import { doing, opt, reported, ToolFailure } from "./tool-helpers.ts";

const CommentSummary = Schema.Struct({
  element: Schema.NullOr(Schema.String),
  id: Schema.String,
  page: Schema.String,
  replies: Schema.Number,
  resolved: Schema.Boolean,
  text: Schema.String,
});

const ListComments = Tool.make("list_comments", {
  description:
    "Open comments on the designs, where the user asks for things; includeResolved for all.",
  failure: ToolFailure,
  parameters: Schema.Struct({
    canvas: opt(Schema.String),
    /** Include the ones already dealt with. */
    includeResolved: opt(Schema.Boolean),
  }),
  success: Schema.Struct({ comments: Schema.Array(CommentSummary) }),
}).annotateMerge(doing("read"));

const ReplyToComment = Tool.make("reply_to_comment", {
  description: "Answer a comment in its thread.",
  failure: ToolFailure,
  parameters: Schema.Struct({
    canvas: opt(Schema.String),
    id: Schema.String,
    text: Schema.String,
  }),
  success: Schema.Struct({ replies: Schema.Number }),
}).annotateMerge(doing("edit"));

const ResolveComment = Tool.make("resolve_comment", {
  description: "Mark a comment done once its work is.",
  failure: ToolFailure,
  parameters: Schema.Struct({
    canvas: opt(Schema.String),
    id: Schema.String,
  }),
  success: Schema.Struct({ resolved: Schema.Boolean }),
}).annotateMerge(doing("edit", { idempotent: true }));

export const CommentTools = Toolkit.make(
  ListComments,
  ReplyToComment,
  ResolveComment
);

export const CommentToolsLive = CommentTools.toLayer(
  Effect.gen(function* () {
    const { canvasOf, project } = yield* makeLookup;
    const comments = project.service(CommentsService);

    return CommentTools.of({
      list_comments: Effect.fn("EditorTools.list_comments")(function* ({
        includeResolved,
        canvas,
      }) {
        const id = yield* canvasOf(canvas);
        const list = yield* reported(comments((c) => c.list(id)));
        return {
          comments: list.comments
            .filter((comment) => includeResolved || !comment.resolved)
            .map((comment) => ({
              element: comment.element,
              id: comment.id,
              page: comment.page,
              replies: comment.replies.length,
              resolved: comment.resolved,
              text: comment.text,
            })),
        };
      }),

      reply_to_comment: Effect.fn("EditorTools.reply_to_comment")(function* ({
        id,
        canvas,
        text,
      }) {
        const inCanvas = yield* canvasOf(canvas);
        const comment = yield* reported(
          comments((c) => c.reply({ canvas: inCanvas, id, text }))
        );
        return { replies: comment.replies.length };
      }),

      resolve_comment: Effect.fn("EditorTools.resolve_comment")(function* ({
        id,
        canvas,
      }) {
        const inCanvas = yield* canvasOf(canvas);
        const comment = yield* reported(
          comments((c) => c.update({ canvas: inCanvas, id, resolved: true }))
        );
        return { resolved: comment.resolved };
      }),
    });
  })
);
