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
import { ROOT_SPACE } from "@ultrapaint/shared/space";
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
import { runGit } from "./git.ts";
import { RepoPaths } from "./repo-paths.ts";

const COMMENTS_FILE = "comments.json";

const decodeComments = Schema.decodeUnknownEffect(
  Schema.fromJsonString(CommentListSchema)
);

const emptyList = (): CommentList => ({ comments: [], version: 1 });

type CommentsFailure = NotFound | Conflict | ForbiddenPath;

/**
 * Comments pinned on the pages of a space. They live in `<space>/comments.json`, beside the
 * canvas layout, so they are committed and read by whoever opens the repository next.
 */
export class CommentsService extends Context.Service<
  CommentsService,
  {
    readonly create: (
      input: CreateCommentInput
    ) => Effect.Effect<Comment, CommentsFailure>;
    readonly delete: (
      space: string,
      id: string
    ) => Effect.Effect<void, CommentsFailure>;
    readonly deleteReply: (
      space: string,
      id: string,
      replyId: string
    ) => Effect.Effect<Comment, CommentsFailure>;
    readonly list: (space: string) => Effect.Effect<CommentList, Conflict>;
    /** Adds an answer to the thread under a comment. */
    readonly reply: (
      input: ReplyInput
    ) => Effect.Effect<Comment, CommentsFailure>;
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

      const fileOf = (space: string) => path.join(root, space, COMMENTS_FILE);

      // The name comments are signed with. A repository without one leaves them unsigned.
      const author = yield* runGit(paths.root, ["config", "user.name"]).pipe(
        Effect.map((r) => (r.exitCode === 0 ? r.stdout.trim() || null : null)),
        Effect.orElseSucceed(() => null)
      );

      const list = Effect.fn("CommentsService.list")(function* (space: string) {
        const file = fileOf(space);
        if (!(yield* exists(file))) {
          return emptyList();
        }
        return yield* Effect.orDie(fs.readFileString(file)).pipe(
          Effect.flatMap(decodeComments),
          Effect.mapError(
            (error) =>
              new Conflict({
                message: `comments.json in ${space || "designs root"} is invalid: ${error.message}`,
              })
          )
        );
      });

      const write = Effect.fnUntraced(function* (
        space: string,
        comments: readonly Comment[]
      ) {
        const file = yield* paths.resolve(fileOf(space));
        const next: CommentList = { comments, version: 1 };
        yield* Effect.orDie(
          writeAtomic(file, `${JSON.stringify(next, null, 2)}\n`)
        );
        yield* events.publish("comments", { list: next, space });
      });

      const create = Effect.fn("CommentsService.create")(function* (
        input: CreateCommentInput
      ) {
        const { comments } = yield* list(input.space);
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
        yield* write(input.space, [...comments, comment]);
        return comment;
      });

      const byId = Effect.fnUntraced(function* (space: string, id: string) {
        const { comments } = yield* list(space);
        const found = comments.find((c) => c.id === id);
        if (!found) {
          return yield* new NotFound({ message: `comment not found: ${id}` });
        }
        return { comments, found };
      });

      const update = Effect.fn("CommentsService.update")(function* (
        input: UpdateCommentInput
      ) {
        return yield* change(input.space, input.id, (comment, now) => ({
          ...comment,
          resolved: input.resolved ?? comment.resolved,
          text: input.text?.trim() ?? comment.text,
          updatedAt: now,
        }));
      });

      /** Replaces one comment with what `change` makes of it, and saves. */
      const change = Effect.fnUntraced(function* (
        space: string,
        id: string,
        f: (comment: Comment, now: number) => Comment
      ) {
        const { comments, found } = yield* byId(space, id);
        const updated = f(found, yield* Clock.currentTimeMillis);
        yield* write(
          space,
          comments.map((c) => (c.id === id ? updated : c))
        );
        return updated;
      });

      const reply = Effect.fn("CommentsService.reply")(function* (
        input: ReplyInput
      ) {
        const replyId = yield* makeId("reply");
        return yield* change(input.space, input.id, (comment, now) => ({
          ...comment,
          replies: [
            ...comment.replies,
            { author, createdAt: now, id: replyId, text: input.text.trim() },
          ],
          updatedAt: now,
        }));
      });

      const deleteReply = Effect.fn("CommentsService.deleteReply")(function* (
        space: string,
        id: string,
        replyId: string
      ) {
        const { found } = yield* byId(space, id);
        if (!found.replies.some((r) => r.id === replyId)) {
          return yield* new NotFound({
            message: `reply not found: ${replyId}`,
          });
        }
        return yield* change(space, id, (comment, now) => ({
          ...comment,
          replies: comment.replies.filter((r) => r.id !== replyId),
          updatedAt: now,
        }));
      });

      const remove = Effect.fn("CommentsService.delete")(function* (
        space: string,
        id: string
      ) {
        const { comments } = yield* byId(space, id);
        yield* write(
          space,
          comments.filter((c) => c.id !== id)
        );
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
            const space = dir === "" || dir === "." ? ROOT_SPACE : dir;
            // An invalid file is reported when the editor asks for it; the watcher lives on.
            return Effect.exit(list(space)).pipe(
              Effect.flatMap((exit) =>
                exit._tag === "Success"
                  ? events.publish("comments", { list: exit.value, space })
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
        delete: (space, id) => exclusive(remove(space, id)),
        deleteReply: (space, id, replyId) =>
          exclusive(deleteReply(space, id, replyId)),
        list,
        reply: (input) => exclusive(reply(input)),
        update: (input) => exclusive(update(input)),
      });
    })
  );
}
