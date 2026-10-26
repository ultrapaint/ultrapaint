/**
 * A thread's turns: a prompt becomes one, with its attachments and the session's briefing, a
 * checkpoint of the designs before it, and its end in the transcript with the files it changed.
 * A prompt sent while the agent works waits in the thread's queue, and the next turn takes it.
 */
import type { ContentBlock } from "@ultrapaint/acp/acp-agent";
import { type NotConfigured, NotFound } from "@ultrapaint/contracts/errors";
import type {
  PromptInput,
  QueuedPrompt,
  Thread,
  ThreadItem,
  ThreadPurpose,
  ThreadScope,
} from "@ultrapaint/contracts/threads";
import { Clock, Effect, Fiber, FileSystem, type Scope } from "effect";
import { AppLog } from "../../app-log.ts";
import { ServerConfig } from "../../config.ts";
import { makeKeyedLock } from "../../keyed-lock.ts";
import { ProjectManager } from "../../project.ts";
import type { RepoPaths } from "../repo-paths.ts";
import { type TreeStamp, WorkingTree } from "../working-tree.ts";
import { ProjectBriefing } from "./briefing.ts";
import { Checkpoints } from "./checkpoints.ts";
import { SlashCommands } from "./commands.ts";
import type { Live, LiveSessions, ThreadFailure } from "./live-sessions.ts";
import { recapOf } from "./recap.ts";
import { ThreadStore } from "./thread-store.ts";
import { emptyCursor, turnUsage } from "./transcript.ts";

const DATA_URL_RE = /^data:([^;]+);base64,(.*)$/s;
/** Until the first prompt names it. */
/** A prompt that asks for the application's code. */
// `--adopt` only links pages to code built already: a design thread does that.
const IMPLEMENT_RE = /^\/implement(?!\s+--adopt(?:\s|$))(?:\s|$)/;

/** What a design thread whose agent is running is told when asked to implement. */
const DESIGN_THREAD_IMPLEMENT = `<ultrapaint-task command="implement">
The user ran /implement in a thread that designs: its agent can write the designs directory only,
not the application's code (ADR 0030). Do not try to write the code. Tell the user, in a sentence,
to press Implement on the page (or start a new chat with /implement), which opens a thread that
can, and stop.
</ultrapaint-task>`;

export const UNTITLED = "New chat";

const TITLE_LIMIT = 48;

const PAGE_FILE_RE = /\.page\.json$/;
const SEPARATORS_RE = /[-_]+/g;

/** `settings/billing.page.json` reads as "Billing". */
const pageNameOf = (file: string): string => {
  const base = file.split("/").at(-1)?.replace(PAGE_FILE_RE, "") ?? file;
  const words = (base === "index" ? "home" : base).replace(SEPARATORS_RE, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/**
 * What a thread works on, from the attachments of its first prompt: the first node, or else the
 * first file, which is a page. Null when the prompt attached neither.
 */
export const scopeOf = (
  attachments: PromptInput["attachments"]
): ThreadScope | null => {
  const nodes = attachments.filter((a) => a.kind === "selection");
  const [first] = nodes;
  if (first) {
    return {
      file: first.file,
      name: first.name,
      nodeId: first.nodeId,
      ...(first.component ? { component: true } : {}),
      ...(nodes.length > 1 ? { count: nodes.length } : {}),
    };
  }
  const file = attachments.find((a) => a.kind === "file");
  return file ? { file: file.path, name: pageNameOf(file.path) } : null;
};

/** A thread's title from its first prompt: the first line, cut to fit the thread menu. */
const titleOf = (text: string) => {
  const line = text.trim().split("\n")[0]?.trim() ?? "";
  if (!line) {
    return UNTITLED;
  }
  return line.length > TITLE_LIMIT ? `${line.slice(0, TITLE_LIMIT)}…` : line;
};

export const makeTurns = Effect.fnUntraced(function* (deps: {
  readonly currentPaths: Effect.Effect<RepoPaths["Service"], NotConfigured>;
  readonly newItemId: Effect.Effect<string>;
  readonly serviceScope: Scope.Scope;
  readonly sessions: LiveSessions;
}) {
  const { currentPaths, newItemId, serviceScope, sessions } = deps;
  const { sessionOf } = sessions;
  const store = yield* ThreadStore;
  const briefing = yield* ProjectBriefing;
  const commands = yield* SlashCommands;
  const { briefing: briefingEnabled } = yield* ServerConfig;
  const checkpoints = yield* Checkpoints;
  const project = yield* ProjectManager;
  const log = yield* AppLog;
  const fs = yield* FileSystem.FileSystem;
  // One prompt at a time per thread, so two cannot both find the thread idle.
  const opening = makeKeyedLock();
  /** Taking from a thread's queue, one at a time: a prompt is sent once. */
  const queueLock = makeKeyedLock();

  // ---- prompting ----
  const attachmentBlocks = Effect.fnUntraced(function* (
    input: PromptInput,
    paths: RepoPaths["Service"]
  ) {
    const blocks: ContentBlock[] = [{ text: input.text, type: "text" }];
    const labels: string[] = [];
    for (const a of input.attachments) {
      if (a.kind === "file") {
        const abs = yield* paths.resolve(a.path);
        // A file attached and then deleted is sent as empty rather than failing the prompt.
        const text = yield* Effect.orElseSucceed(
          fs.readFileString(abs),
          () => ""
        );
        blocks.push({
          resource: { mimeType: "text/plain", text, uri: `file://${abs}` },
          type: "resource",
        });
        labels.push(a.path);
      } else if (a.kind === "selection") {
        const abs = yield* paths.resolve(a.file);
        blocks.push(
          {
            text: `The user has selected the node "${a.name}" (id ${a.nodeId}) in ${a.file} on the design canvas. Edits should target this node unless told otherwise.`,
            type: "text",
          },
          { name: a.file, type: "resource_link", uri: `file://${abs}` }
        );
        labels.push(`${a.name} @ ${a.file}`);
      } else {
        const match = a.dataUrl.match(DATA_URL_RE);
        if (match?.[1] && match[2] !== undefined) {
          blocks.push({
            data: match[2],
            mimeType: match[1],
            type: "image",
          });
        }
        labels.push(a.name);
      }
    }
    return { blocks, labels };
  });

  /** A turn that went wrong: the transcript says why, and the thread takes prompts again. */
  const failTurn = (threadId: string, message: string) =>
    Effect.gen(function* () {
      yield* store.push(threadId, {
        at: yield* Clock.currentTimeMillis,
        id: yield* newItemId,
        kind: "status",
        text: `Turn failed: ${message}`,
      });
      yield* store.update(threadId, { error: message, status: "error" });
    });

  /** A bug of ours in a turn: logged, and the turn fails rather than stay "running". */
  const turnBroke = (threadId: string, defect: unknown) => {
    const message = defect instanceof Error ? defect.message : String(defect);
    return Effect.andThen(
      log.log("agent", "error", `a turn of ${threadId} broke: ${message}`),
      failTurn(threadId, message)
    );
  };

  const runTurn = (
    threadId: string,
    session: Live,
    sessionId: string,
    blocks: ContentBlock[],
    before: TreeStamp
  ) =>
    session.agent.prompt(sessionId, blocks).pipe(
      // The response can overtake the last updates; the transcript must be complete first.
      // Bounded, so a stalled consumer cannot keep the thread "running" forever.
      Effect.tap(() =>
        Effect.timeoutOption(session.agent.drained, "5 seconds")
      ),
      Effect.matchEffect({
        onFailure: (error) =>
          Effect.andThen(
            Effect.sync(() => {
              session.turn = null;
            }),
            failTurn(threadId, error.message)
          ),
        onSuccess: (response) =>
          Effect.gen(function* () {
            // Before the status changes: a cancel that sees no turn leaves the status alone.
            session.turn = null;
            const changedFiles = yield* project
              .use(
                Effect.flatMap(WorkingTree, (tree) => tree.changedSince(before))
              )
              // Attribution is a nicety; a project closed meanwhile must not fail the turn.
              .pipe(Effect.orElseSucceed((): string[] => []));
            const usage = turnUsage((response as { _meta?: unknown })._meta);
            yield* store.push(threadId, {
              at: yield* Clock.currentTimeMillis,
              changedFiles,
              id: yield* newItemId,
              kind: "turn_end",
              stopReason: response.stopReason,
              ...(usage ? { usage } : {}),
            });
            yield* store.update(threadId, { status: "idle" });
            // A turn the user stopped leaves the queue for them to send or drop.
            if (response.stopReason !== "cancelled") {
              yield* Effect.forkIn(
                Effect.ignore(
                  Effect.suspend(() => sendQueued(threadId)),
                  { log: true }
                ),
                serviceScope
              );
            }
          }),
      }),
      Effect.catchDefect((defect) => turnBroke(threadId, defect)),
      Effect.ensuring(
        Effect.sync(() => {
          session.turn = null;
        })
      )
    );

  /**
   * What leads a session's first prompt. A resumed session has the conversation back, and
   * the briefing with it if anything was ever asked. A new one is told the project, then
   * what was said before it.
   */
  const sessionContext = Effect.fnUntraced(function* (
    session: Live,
    earlier: readonly ThreadItem[],
    purpose: ThreadPurpose
  ) {
    if (session.resumed && earlier.some((i) => i.kind === "user")) {
      return [];
    }
    const about = briefingEnabled ? yield* briefing.text(purpose) : undefined;
    const recap = session.resumed ? null : recapOf(earlier);
    return [about, recap].flatMap((text): ContentBlock[] =>
      text ? [{ text, type: "text" }] : []
    );
  });

  /**
   * A turn from the prompt to the agent: the session is started or resumed, told what it
   * needs, and the designs are checkpointed. The thread already shows as running.
   */
  const openTurn = Effect.fnUntraced(function* (
    input: PromptInput,
    earlier: readonly ThreadItem[],
    blocks: ContentBlock[]
  ) {
    const { threadId } = input;
    const { session, sessionId } = yield* sessionOf(threadId);
    if (!session.briefed) {
      session.briefed = true;
      const purpose = (yield* store.get(threadId))?.purpose ?? "design";
      blocks.unshift(...(yield* sessionContext(session, earlier, purpose)));
    }
    // The folder's files before the turn, by time and size, to tell after it what it changed.
    const before = yield* project
      .use(Effect.flatMap(WorkingTree, (tree) => tree.stamp))
      .pipe(Effect.orElseSucceed((): TreeStamp => new Map()));
    // Not cut short by a cancel: a checkpoint half written is worse than a late cancel.
    yield* Effect.uninterruptible(
      checkpoints.create(threadId, `Before: ${input.text.slice(0, 60)}`)
    );
    session.turn = emptyCursor();
    yield* Effect.forkIn(
      runTurn(threadId, session, sessionId, blocks, before),
      session.scope
    );
  });

  /** Turns still on their way to the agent, by thread: a cancel stops them there. */
  const openings = new Map<string, Fiber.Fiber<void>>();

  /**
   * The task a prompt stands for. `/implement` turns a thread that has not started its agent into
   * an implement thread: its session is then started with the repository writable (ADR 0030).
   * One already running keeps its sandbox, and is told to send the user to an implement thread.
   */
  const taskFor = Effect.fnUntraced(function* (thread: Thread, text: string) {
    if (!IMPLEMENT_RE.test(text.trim()) || thread.purpose === "implement") {
      return yield* commands.expand(text);
    }
    if (thread.sessionId !== undefined) {
      return DESIGN_THREAD_IMPLEMENT;
    }
    yield* store.update(thread.id, { purpose: "implement" });
    return yield* commands.expand(text);
  });

  const prompt = Effect.fn("ThreadService.prompt")(function* (
    input: PromptInput
  ) {
    const { threadId } = input;
    const thread = yield* store.get(threadId);
    if (!thread) {
      return yield* new NotFound({ message: `unknown thread ${threadId}` });
    }
    if (thread.status === "running" || thread.status === "cancelling") {
      // Sent when the turn ends: the user need not wait to say what comes next.
      const queued: QueuedPrompt = {
        at: yield* Clock.currentTimeMillis,
        attachments: input.attachments,
        id: yield* newItemId,
        text: input.text,
      };
      yield* store.update(threadId, {
        queued: [...(thread.queued ?? []), queued],
      });
      return;
    }
    const projectScope = yield* project.scope;
    const paths = yield* currentPaths;
    const { blocks, labels } = yield* attachmentBlocks(input, paths);
    // `/init`, `/implement`: the agent is given the task, the transcript keeps what was typed.
    const task = yield* taskFor(thread, input.text);
    if (task !== null) {
      blocks[0] = { text: task, type: "text" };
    }
    // A copy: the store's own list grows with the prompt about to be pushed.
    const earlier = [...(yield* store.items(threadId))];
    yield* store.push(threadId, {
      at: yield* Clock.currentTimeMillis,
      attachments: labels,
      id: yield* newItemId,
      kind: "user",
      text: input.text,
    });
    const first = !earlier.some((i) => i.kind === "user");
    const scope = first && !thread.scope ? scopeOf(input.attachments) : null;
    yield* store.update(threadId, {
      error: undefined,
      status: "running",
      ...(thread.title === UNTITLED && first
        ? { title: titleOf(input.text) }
        : {}),
      ...(scope ? { scope } : {}),
    });
    // The request returns now. Whatever the agent takes to start is part of the turn, and
    // the turn reports through the transcript.
    const turn = Effect.withFiber((self) =>
      openTurn(input, earlier, blocks).pipe(
        Effect.catch((error) =>
          store.update(threadId, { error: error.message, status: "error" })
        ),
        Effect.catchDefect((defect) => turnBroke(threadId, defect)),
        Effect.onInterrupt(() =>
          Effect.gen(function* () {
            yield* store.push(threadId, {
              at: yield* Clock.currentTimeMillis,
              changedFiles: [],
              id: yield* newItemId,
              kind: "turn_end",
              stopReason: "cancelled",
            });
            yield* store.update(threadId, { status: "idle" });
          })
        ),
        Effect.ensuring(
          Effect.sync(() => {
            if (openings.get(threadId) === self) {
              openings.delete(threadId);
            }
          })
        )
      )
    );
    openings.set(threadId, yield* Effect.forkIn(turn, projectScope));
  });

  const takeQueued = Effect.fnUntraced(function* (
    threadId: string,
    id: string | null
  ) {
    const thread = yield* store.get(threadId);
    if (!thread) {
      return yield* new NotFound({ message: `unknown thread ${threadId}` });
    }
    const queue = thread.queued ?? [];
    const taken = id === null ? queue[0] : queue.find((q) => q.id === id);
    if (!taken) {
      return null;
    }
    yield* store.update(threadId, {
      queued: queue.filter((q) => q.id !== taken.id),
    });
    return taken;
  });

  const unqueue = (threadId: string, id: string) =>
    queueLock.withLock(threadId, takeQueued(threadId, id));

  // Typed: a turn that ends sends the next prompt, which opens a turn.
  const sendQueued = (threadId: string): Effect.Effect<void, ThreadFailure> =>
    queueLock.withLock(
      threadId,
      Effect.gen(function* () {
        const thread = yield* store.get(threadId);
        if (thread?.status === "running" || thread?.status === "cancelling") {
          return;
        }
        const next = yield* takeQueued(threadId, null);
        if (next) {
          yield* opening.withLock(
            threadId,
            prompt({
              attachments: next.attachments,
              text: next.text,
              threadId,
            })
          );
        }
      })
    );

  /** Stops a turn that has not reached the agent yet. Whether there was one. */
  const stopOpening = (threadId: string) =>
    Effect.suspend(() => {
      const fiber = openings.get(threadId);
      return fiber
        ? Effect.as(Fiber.interrupt(fiber), true)
        : Effect.succeed(false);
    });

  return { opening, prompt, sendQueued, stopOpening, unqueue };
});
