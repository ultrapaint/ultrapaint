import {
  type Comment,
  type CommentList,
  CommentList as CommentListSchema,
  type CreateCommentInput,
  type ReplyInput,
  type UpdateCommentInput,
} from "@ultrapaint/contracts/comments";
import {
  Conflict,
  type ForbiddenPath,
  NotFound,
} from "@ultrapaint/contracts/errors";
import { CANVAS_FILE, ROOT_CANVAS } from "@ultrapaint/shared/canvas";
import {
  Clock,
  Context,
  Effect,
  FileSystem,
  Layer,
  Path,
  Schema,
  Stream,
} from "effect";
import { EventBus } from "../events.ts";
import { toPosix } from "../hash.ts";
import { makeId, safeCanvasId } from "../ids.ts";
import { type EditFailure, EditService, type EditTransaction } from "./edit.ts";
import { runGit } from "./git.ts";
import { RepoPaths } from "./repo-paths.ts";

export const COMMENTS_FILE = "comments.json";

const decodeComments = Schema.decodeUnknownEffect(
  Schema.fromJsonString(CommentListSchema)
);

const emptyList = (): CommentList => ({ comments: [], version: 1 });

/** The text of `comments.json`, the same whoever writes it. */
const renderComments = (list: CommentList) =>
  `${JSON.stringify(list, null, 2)}\n`;

type CommentsFailure = NotFound | Conflict | ForbiddenPath;

/**
 * Comments pinned on the pages of a canvas. They live in `<canvas>/comments.json`, beside the
 * canvas layout, so they are committed and read by whoever opens the repository next.
 */
export class CommentsService extends Context.Service<
  CommentsService,
  {
    readonly create: (
      input: CreateCommentInput
    ) => Effect.Effect<Comment, CommentsFailure>;
    readonly delete: (
      canvas: string,
      id: string
    ) => Effect.Effect<void, CommentsFailure>;
    readonly deleteReply: (
      canvas: string,
      id: string,
      replyId: string
    ) => Effect.Effect<Comment, CommentsFailure>;
    readonly list: (
      canvas: string
    ) => Effect.Effect<CommentList, Conflict | NotFound>;
    /** Adds an answer to the thread under a comment. */
    readonly reply: (
      input: ReplyInput
    ) => Effect.Effect<Comment, CommentsFailure>;
    /**
     * Changes a canvas's comments inside an action on its pages, which the change becomes part
     * of: a page renamed, moved or deleted takes its comments along, and undo brings them back.
     * Answers with the comments as they were. Nothing is written when `revise` leaves them as
     * they are, nor when the file cannot be read: a broken comments.json stays as it is.
     */
    readonly rewrite: (
      tx: EditTransaction,
      canvas: string,
      revise: (comments: readonly Comment[]) => readonly Comment[]
    ) => Effect.Effect<readonly Comment[], EditFailure>;
    readonly update: (
      input: UpdateCommentInput
    ) => Effect.Effect<Comment, CommentsFailure>;
  }
>()("ultrapaint/server/CommentsService") {
  static readonly layer = Layer.effect(
    CommentsService,
    Effect.gen(function* () {
      const paths = yield* RepoPaths;
      const edit = yield* EditService;
      const events = yield* EventBus;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = paths.designsDir;

      const exists = (p: string) =>
        Effect.orElseSucceed(fs.exists(p), () => false);

      const fileOf = (canvas: string) =>
        Effect.map(safeCanvasId(canvas), (safe) =>
          path.join(root, safe, COMMENTS_FILE)
        );

      /**
       * Where a change to a canvas's comments is written: a canvas there is. Comments do not
       * make a directory a canvas, nor a directory to put the file in.
       */
      const fileToWrite = Effect.fnUntraced(function* (canvas: string) {
        const file = yield* fileOf(canvas);
        if (
          canvas !== ROOT_CANVAS &&
          !(yield* exists(path.join(root, canvas, CANVAS_FILE)))
        ) {
          return yield* new NotFound({
            message: `canvas not found: ${canvas}`,
          });
        }
        return yield* paths.resolve(file);
      });

      // The name comments are signed with. A repository without one leaves them unsigned.
      const author = yield* runGit(paths.root, ["config", "user.name"]).pipe(
        Effect.map((r) => (r.exitCode === 0 ? r.stdout.trim() || null : null)),
        Effect.orElseSucceed(() => null)
      );

      const list = Effect.fn("CommentsService.list")(function* (
        canvas: string
      ) {
        const file = yield* fileOf(canvas);
        if (!(yield* exists(file))) {
          return emptyList();
        }
        return yield* fs.readFileString(file).pipe(
          Effect.flatMap(decodeComments),
          Effect.mapError(
            (error) =>
              new Conflict({
                message: `comments.json in ${canvas || "designs root"} is invalid: ${error.message}`,
              })
          )
        );
      });

      /**
       * Changes a canvas's comments. Comments are not undone with the designs, so this is no
       * undo step; it goes through the journal all the same, which reads and writes the file
       * one change at a time and carries the change into the steps that recorded the file.
       * `revise` answers with the comments to save and what the change gave; it is pure, and is
       * also run on the comments as those steps had them.
       */
      const write = <A>(
        canvas: string,
        revise: (
          comments: readonly Comment[]
        ) => Effect.Effect<readonly [readonly Comment[], A], CommentsFailure>
      ) =>
        Effect.gen(function* () {
          const file = paths.relative(yield* fileToWrite(canvas));
          const [saved, result] = yield* edit.amend(file, (content) =>
            Effect.gen(function* () {
              const before =
                content === null
                  ? emptyList()
                  : yield* decodeComments(content).pipe(
                      Effect.mapError(
                        (error) =>
                          new Conflict({
                            message: `comments.json in ${canvas || "designs root"} is invalid: ${error.message}`,
                          })
                      )
                    );
              const [comments, given] = yield* revise(before.comments);
              const next: CommentList = { comments, version: 1 };
              return [renderComments(next), [next, given] as const] as const;
            })
          );
          yield* events.publish("comments", { canvas, list: saved });
          return result;
        });

      /** Finds a comment among them; a comment gone by now is not found. */
      const findIn = (
        comments: readonly Comment[],
        id: string
      ): Effect.Effect<Comment, NotFound> => {
        const found = comments.find((c) => c.id === id);
        return found
          ? Effect.succeed(found)
          : Effect.fail(new NotFound({ message: `comment not found: ${id}` }));
      };

      const create = Effect.fn("CommentsService.create")(function* (
        input: CreateCommentInput
      ) {
        const now = yield* Clock.currentTimeMillis;
        const comment: Comment = {
          author,
          createdAt: now,
          element: input.element,
          id: yield* makeId("comment"),
          nodeId: input.nodeId,
          page: input.page,
          replies: [],
          resolved: false,
          text: input.text.trim(),
          updatedAt: now,
          x: Math.round(input.x),
          y: Math.round(input.y),
        };
        return yield* write(input.canvas, (comments) =>
          Effect.succeed([[...comments, comment], comment] as const)
        );
      });

      const update = Effect.fn("CommentsService.update")(function* (
        input: UpdateCommentInput
      ) {
        return yield* change(input.canvas, input.id, (comment, now) =>
          Effect.succeed({
            ...comment,
            resolved: input.resolved ?? comment.resolved,
            text: input.text?.trim() ?? comment.text,
            updatedAt: now,
          })
        );
      });

      /** Replaces one comment with what `f` makes of it, and saves. */
      const change = Effect.fnUntraced(function* (
        canvas: string,
        id: string,
        f: (comment: Comment, now: number) => Effect.Effect<Comment, NotFound>
      ): Effect.fn.Return<Comment, CommentsFailure> {
        const now = yield* Clock.currentTimeMillis;
        return yield* write(canvas, (comments) =>
          findIn(comments, id).pipe(
            Effect.flatMap((found) => f(found, now)),
            Effect.map(
              (updated) =>
                [
                  comments.map((c) => (c.id === id ? updated : c)),
                  updated,
                ] as const
            )
          )
        );
      });

      const reply = Effect.fn("CommentsService.reply")(function* (
        input: ReplyInput
      ) {
        const replyId = yield* makeId("reply");
        return yield* change(input.canvas, input.id, (comment, now) =>
          Effect.succeed({
            ...comment,
            replies: [
              ...comment.replies,
              { author, createdAt: now, id: replyId, text: input.text.trim() },
            ],
            updatedAt: now,
          })
        );
      });

      const deleteReply = Effect.fn("CommentsService.deleteReply")(function* (
        canvas: string,
        id: string,
        replyId: string
      ) {
        return yield* change(
          canvas,
          id,
          (comment, now): Effect.Effect<Comment, NotFound> =>
            comment.replies.some((r) => r.id === replyId)
              ? Effect.succeed({
                  ...comment,
                  replies: comment.replies.filter((r) => r.id !== replyId),
                  updatedAt: now,
                })
              : Effect.fail(
                  new NotFound({ message: `reply not found: ${replyId}` })
                )
        );
      });

      const remove = Effect.fn("CommentsService.delete")(function* (
        canvas: string,
        id: string
      ) {
        yield* write(canvas, (comments) =>
          Effect.as(findIn(comments, id), [
            comments.filter((c) => c.id !== id),
            undefined,
          ] as const)
        );
      });

      const rewrite = Effect.fnUntraced(function* (
        tx: EditTransaction,
        canvas: string,
        revise: (comments: readonly Comment[]) => readonly Comment[]
      ) {
        // Comments that cannot be read are reported when the editor asks for them; a page's
        // rename or deletion is no reason to refuse, nor to write over what is there.
        const before = yield* list(canvas).pipe(
          Effect.catchTag("Conflict", () => Effect.succeed(null))
        );
        if (before === null) {
          return [];
        }
        const next = revise(before.comments);
        const same =
          next.length === before.comments.length &&
          next.every((comment, i) => comment === before.comments[i]);
        if (!same) {
          const file = yield* paths.resolve(yield* fileOf(canvas));
          const written: CommentList = { comments: next, version: 1 };
          yield* tx.write(paths.relative(file), renderComments(written));
          yield* events.publish("comments", { canvas, list: written });
        }
        return before.comments;
      });

      // A pull or a checkout changes the file behind the editor's back.
      if (yield* exists(root)) {
        yield* fs.watch(root, { recursive: true }).pipe(
          Stream.filter(
            (event) =>
              event._tag !== "Remove" &&
              path.basename(event.path) === COMMENTS_FILE
          ),
          Stream.mapEffect((event) => {
            const dir = toPosix(
              path.relative(root, path.dirname(path.resolve(root, event.path)))
            );
            const canvas = dir === "" || dir === "." ? ROOT_CANVAS : dir;
            // An invalid file is reported when the editor asks for it; the watcher lives on.
            return Effect.exit(list(canvas)).pipe(
              Effect.flatMap((exit) =>
                exit._tag === "Success"
                  ? events.publish("comments", { canvas, list: exit.value })
                  : Effect.void
              )
            );
          }),
          Stream.runDrain,
          Effect.ignore({ log: true }),
          Effect.forkScoped
        );
      }

      // Every change, these and a page's, is made under the journal's lock, one at a time.
      return CommentsService.of({
        create,
        delete: remove,
        deleteReply,
        list,
        reply,
        rewrite,
        update,
      });
    })
  );
}
