/**
 * `comments.json`, the comments pinned on a canvas's pages: its codec, the same text whoever
 * writes it. Pure.
 */
import {
  type CommentList,
  CommentList as CommentListSchema,
} from "@ultrapaint/contracts/comments";
import { Conflict } from "@ultrapaint/contracts/errors";
import { Effect, Schema } from "effect";
import type { FileCodec } from "./edit.ts";

export const COMMENTS_FILE = "comments.json";

export const decodeComments = Schema.decodeUnknownEffect(
  Schema.fromJsonString(CommentListSchema)
);

export const emptyList = (): CommentList => ({ comments: [], version: 1 });

/** The file as it is written: a plain comment says nothing of its kind, as before there were kinds. */
export const renderComments = (list: CommentList) =>
  `${JSON.stringify(
    {
      ...list,
      comments: list.comments.map(({ kind, ...rest }) =>
        kind === "behaviour" ? { ...rest, kind } : rest
      ),
    },
    null,
    2
  )}\n`;

/** `comments.json` as a step reads and writes it: a canvas without one has no comments yet. */
export const commentsCodec = (
  canvas: string
): FileCodec<CommentList, Conflict> => ({
  decode: (text) =>
    text === null
      ? Effect.succeed(emptyList())
      : decodeComments(text).pipe(
          Effect.mapError(
            (error) =>
              new Conflict({
                message: `comments.json in ${canvas || "designs root"} is invalid: ${error.message}`,
              })
          )
        ),
  encode: renderComments,
});
