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
import { ROOT_CANVAS } from "@ultrapaint/shared/canvas";
import {
  Clock,
  Context,
  Effect,
  FileSystem,
  Layer,
  Path,
  Schema,
  Semaphore,
  Stream,
} from "effect";
import { makeWriteAtomic } from "../atomic-write.ts";
import { EventBus } from "../events.ts";
import { toPosix } from "../hash.ts";
import { makeId } from "../ids.ts";
import type { EditFailure, EditTransaction } from "./edit.ts";
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
    readonly list: (canvas: string) => Effect.Effect<CommentList, Conflict>;
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
      const events = yield* EventBus;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const writeAtomic = makeWriteAtomic(fs, path);
      const root = paths.designsDir;
      // Every change reads the file and writes it back whole; two at once would lose one.
      const mutations = yield* Semaphore.make(1);
      const exclusive = mutations.withPermits(1);

      const exists = (p: string) =>
        Effect.orElseSucceed(fs.exists(p), () => false);

      const fileOf = (canvas: string) => path.join(root, canvas, COMMENTS_FILE);

      // The name comments are signed with. A repository without one leaves them unsigned.
      const author = yield* runGit(paths.root, ["config", "user.name"]).pipe(
        Effect.map((r) => (r.exitCode === 0 ? r.stdout.trim() || null : null)),
        Effect.orElseSucceed(() => null)
      );

      const list = Effect.fn("CommentsService.list")(function* (
        canvas: string
      ) {
        const file = fileOf(canvas);
        if (!(yield* exists(file))) {
          return emptyList();
        }
        return yield* Effect.orDie(fs.readFileString(file)).pipe(
          Effect.flatMap(decodeComments),
          Effect.mapError(
            (error) =>
              new Conflict({
                message: `comments.json in ${canvas || "designs root"} is invalid: ${error.message}`,
              })
          )
        );
      });

      const write = Effect.fnUntraced(function* (
        canvas: string,
        comments: readonly Comment[]
      ) {
        const file = yield* paths.resolve(fileOf(canvas));
        const next: CommentList = { comments, version: 1 };
        yield* Effect.orDie(writeAtomic(file, renderComments(next)));
        yield* events.publish("comments", { canvas, list: next });
      });

      const create = Effect.fn("CommentsService.create")(function* (
        input: CreateCommentInput
      ) {
        const { comments } = yield* list(input.canvas);
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
        yield* write(input.canvas, [...comments, comment]);
        return comment;
      });

      const byId = Effect.fnUntraced(function* (canvas: string, id: string) {
        const { comments } = yield* list(canvas);
        const found = comments.find((c) => c.id === id);
        if (!found) {
          return yield* new NotFound({ message: `comment not found: ${id}` });
        }
        return { comments, found };
      });

      const update = Effect.fn("CommentsService.update")(function* (
        input: UpdateCommentInput
      ) {
        return yield* change(input.canvas, input.id, (comment, now) => ({
          ...comment,
          resolved: input.resolved ?? comment.resolved,
          text: input.text?.trim() ?? comment.text,
          updatedAt: now,
        }));
      });

      /** Replaces one comment with what `change` makes of it, and saves. */
      const change = Effect.fnUntraced(function* (
        canvas: string,
        id: string,
        f: (comment: Comment, now: number) => Comment
      ) {
        const { comments, found } = yield* byId(canvas, id);
        const updated = f(found, yield* Clock.currentTimeMillis);
        yield* write(
          canvas,
          comments.map((c) => (c.id === id ? updated : c))
        );
        return updated;
      });

      const reply = Effect.fn("CommentsService.reply")(function* (
        input: ReplyInput
      ) {
        const replyId = yield* makeId("reply");
        return yield* change(input.canvas, input.id, (comment, now) => ({
          ...comment,
          replies: [
            ...comment.replies,
            { author, createdAt: now, id: replyId, text: input.text.trim() },
          ],
          updatedAt: now,
        }));
      });

      const deleteReply = Effect.fn("CommentsService.deleteReply")(function* (
        canvas: string,
        id: string,
        replyId: string
      ) {
        const { found } = yield* byId(canvas, id);
        if (!found.replies.some((r) => r.id === replyId)) {
          return yield* new NotFound({
            message: `reply not found: ${replyId}`,
          });
        }
        return yield* change(canvas, id, (comment, now) => ({
          ...comment,
          replies: comment.replies.filter((r) => r.id !== replyId),
          updatedAt: now,
        }));
      });

      const remove = Effect.fn("CommentsService.delete")(function* (
        canvas: string,
        id: string
      ) {
        const { comments } = yield* byId(canvas, id);
        yield* write(
          canvas,
          comments.filter((c) => c.id !== id)
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
          const file = yield* paths.resolve(fileOf(canvas));
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

      return CommentsService.of({
        create: (input) => exclusive(create(input)),
        delete: (canvas, id) => exclusive(remove(canvas, id)),
        deleteReply: (canvas, id, replyId) =>
          exclusive(deleteReply(canvas, id, replyId)),
        list,
        reply: (input) => exclusive(reply(input)),
        rewrite: (tx, canvas, revise) => exclusive(rewrite(tx, canvas, revise)),
        update: (input) => exclusive(update(input)),
      });
    })
  );
}
