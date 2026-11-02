/**
 * A thread's turn, from the prompt that opens it to its end: on its way to the agent (its
 * session starting, the designs checkpointed), then at the agent, whose updates it places in
 * the transcript, then over. The one place a turn's end is written (`turn_end`, with the files
 * it changed and what it spent) and a turn's failure ("Turn failed: …"), each with the status
 * that goes with it. The thread session keeps one, and asks it whether a turn is under way.
 * What the turn changed is the stamps' difference, told apart from what others changed meanwhile
 * by its witness (`turn-witness.ts`), which hears the files its agent's tool calls edit.
 */
import type { PromptResponse, SessionUpdate } from "@ultrapaint/acp/acp-agent";
import type { ThreadItem } from "@ultrapaint/contracts/threads";
import { Clock, Deferred, Effect, Fiber, type Scope } from "effect";
import type { AppLog } from "../../app-log.ts";
import type { OpenProject } from "../../project.ts";
import { type TreeStamp, WorkingTree } from "../working-tree.ts";
import type { ThreadStore } from "./thread-store.ts";
import {
  emptyCursor,
  projectUpdate,
  type TranscriptAction,
  type TurnCursor,
  turnUsage,
} from "./transcript.ts";
import type { TurnFiles, TurnWitness } from "./turn-witness.ts";

/** Where a thread's turn is. */
export type TurnState =
  | { readonly _tag: "None" }
  /** On its way to the agent: stopping it interrupts the fiber that takes it there. */
  | { readonly _tag: "Opening"; readonly fiber: Fiber.Fiber<void> }
  /**
   * At the agent: the folder's files before it, where its streamed chunks go, who else changed
   * files meanwhile, and the tool calls that edit files (by id: an update may not repeat its kind).
   */
  | {
      readonly _tag: "AtAgent";
      readonly before: TreeStamp;
      readonly cursor: TurnCursor;
      readonly editing: Set<string>;
      readonly witness: TurnWitness;
    };

/** The kinds of tool call that change the files they name. */
const EDITING_KINDS: ReadonlySet<string> = new Set(["delete", "edit", "move"]);

/**
 * The files an update says its tool call changes: those of a diff, and those named by a call
 * that edits, moves or deletes (a read names files too, which it leaves as they were).
 */
const filesEdited = (
  update: SessionUpdate,
  editing: Set<string>,
  relative: (file: string) => string
): string[] => {
  if (
    update.sessionUpdate !== "tool_call" &&
    update.sessionUpdate !== "tool_call_update"
  ) {
    return [];
  }
  if (update.kind && EDITING_KINDS.has(update.kind)) {
    editing.add(update.toolCallId);
  }
  const named = editing.has(update.toolCallId)
    ? (update.locations ?? []).map((l) => l.path)
    : [];
  const diffs = (update.content ?? []).flatMap((c) =>
    c.type === "diff" ? [c.path] : []
  );
  return [...named, ...diffs].map(relative);
};

/** What the turn moves the thread's status with. */
export type TurnStatusEvent =
  | { readonly _tag: "TurnEnded" }
  | { readonly _tag: "Failed"; readonly message: string };

export interface Turn {
  /**
   * The prompt has reached the agent: from now on its updates are the turn's. The witness,
   * opened before the files were stamped, is the turn's to close.
   */
  readonly atAgent: (
    before: TreeStamp,
    witness: TurnWitness
  ) => Effect.Effect<void>;
  /**
   * Opens a turn: `opening` takes it to the agent, in `scope`, and calls `atAgent` when it is
   * there. A failure on the way fails the turn; stopped on the way, the turn ends cancelled.
   */
  readonly begin: (
    opening: Effect.Effect<void, { readonly message: string }>,
    scope: Scope.Scope
  ) => Effect.Effect<void>;
  /** A bug of ours in a turn: logged, and the turn fails rather than stay "running". */
  readonly broke: (defect: unknown) => Effect.Effect<void>;
  /** The session the turn was at closed under it: nothing more of it is placed. */
  readonly drop: Effect.Effect<void>;
  /** The agent answered: the turn is over, with the files it changed and what it spent. */
  readonly end: (response: PromptResponse) => Effect.Effect<void>;
  /** The turn went wrong: the transcript says why, and the thread takes prompts again. */
  readonly fail: (message: string) => Effect.Effect<void>;
  /** A terminal of the agent's is done with: the tool call that ran it keeps its output's tail. */
  readonly keepTerminal: (
    terminalId: string,
    output: string
  ) => Effect.Effect<void>;
  /** An update of the agent's, placed in the transcript. */
  readonly place: (
    update: SessionUpdate,
    relative: (file: string) => string
  ) => Effect.Effect<void>;
  /** Where the turn is now. */
  readonly state: Effect.Effect<TurnState>;
  /** Stops a turn on its way to the agent; whether there was one. */
  readonly stopOpening: Effect.Effect<boolean>;
}

export const makeTurn = (
  threadId: string,
  deps: {
    readonly log: AppLog["Service"];
    readonly newItemId: Effect.Effect<string>;
    readonly project: OpenProject["Service"];
    readonly store: ThreadStore["Service"];
    readonly transition: (event: TurnStatusEvent) => Effect.Effect<void>;
  }
): Turn => {
  const { log, newItemId, project, store, transition } = deps;
  let state: TurnState = { _tag: "None" };

  /** Over: a cancel that sees no turn leaves the status alone. Set before the status moves. */
  const over = Effect.sync(() => {
    const was = state;
    state = { _tag: "None" };
    return was;
  });

  /** Over, with nothing to say of its files. */
  const overSilently = Effect.flatMap(over, (was) =>
    was._tag === "AtAgent" ? was.witness.close : Effect.void
  );

  const fail = Effect.fnUntraced(function* (message: string) {
    yield* overSilently;
    yield* store.push(threadId, {
      at: yield* Clock.currentTimeMillis,
      id: yield* newItemId,
      kind: "status",
      text: `Turn failed: ${message}`,
    });
    yield* transition({ _tag: "Failed", message });
  });

  const broke = (defect: unknown) => {
    const message = defect instanceof Error ? defect.message : String(defect);
    return Effect.andThen(
      log.log("agent", "error", `a turn of ${threadId} broke: ${message}`),
      fail(message)
    );
  };

  const end = Effect.fnUntraced(function* (response: PromptResponse) {
    const was = yield* over;
    // Stopped before the agent had it: nothing was changed.
    let files: TurnFiles = { changedFiles: [] };
    if (was._tag === "AtAgent") {
      const changed = yield* project
        .use(
          Effect.flatMap(WorkingTree, (tree) => tree.changedSince(was.before))
        )
        // Attribution is a nicety; a project closed meanwhile must not fail the turn.
        .pipe(Effect.orElseSucceed((): string[] => []));
      yield* was.witness.close;
      files = was.witness.split(changed);
    }
    const usage = turnUsage(response);
    yield* store.push(threadId, {
      at: yield* Clock.currentTimeMillis,
      ...files,
      id: yield* newItemId,
      kind: "turn_end",
      stopReason: response.stopReason,
      ...(usage ? { usage } : {}),
    });
    yield* transition({ _tag: "TurnEnded" });
  });

  /** One thing an update does to the transcript, done. */
  const apply = (action: TranscriptAction): Effect.Effect<void> => {
    switch (action.type) {
      case "push":
        return store.push(threadId, action.item);
      case "patch":
        return store.patchItem(threadId, action.itemId, action.patch);
      case "append":
        return store.appendText(threadId, action.itemId, action.text);
      default:
        return Effect.flatMap(store.get(threadId), (thread) =>
          thread ? store.update(threadId, action.patch(thread)) : Effect.void
        );
    }
  };

  const place = Effect.fnUntraced(function* (
    update: SessionUpdate,
    relative: (file: string) => string
  ) {
    // Ids are drawn up front because the projection itself is pure and synchronous.
    const ids = [yield* newItemId];
    const at = state._tag === "AtAgent" ? state : null;
    for (const file of at ? filesEdited(update, at.editing, relative) : []) {
      at?.witness.claim(file);
    }
    const projected = projectUpdate(update, {
      hasItem: (itemId) => store.hasItem(threadId, itemId),
      newId: () => ids.pop() ?? `item_${ids.length}`,
      now: yield* Clock.currentTimeMillis,
      relative,
      turn: at?.cursor ?? null,
    });
    if (at && state === at && projected.turn) {
      state = { ...at, cursor: projected.turn };
    }
    for (const action of projected.actions) {
      yield* apply(action);
    }
  });

  const begin = Effect.fnUntraced(function* (
    opening: Effect.Effect<void, { readonly message: string }>,
    scope: Scope.Scope
  ) {
    // The turn is on its way once it is known to be: only then does the fiber set out.
    const known = yield* Deferred.make<void>();
    const fiber = yield* Effect.forkIn(
      Effect.withFiber((self) =>
        Effect.andThen(Deferred.await(known), opening).pipe(
          Effect.catch((error) => fail(error.message)),
          Effect.catchDefect(broke),
          Effect.onInterrupt(() => end({ stopReason: "cancelled" })),
          // The fiber is the turn's only while it is on its way.
          Effect.ensuring(
            Effect.sync(() => {
              if (state._tag === "Opening" && state.fiber === self) {
                state = { _tag: "None" };
              }
            })
          )
        )
      ),
      scope
    );
    state = { _tag: "Opening", fiber };
    yield* Deferred.succeed(known, undefined);
  });

  return {
    atAgent: (before, witness) =>
      Effect.sync(() => {
        state = {
          _tag: "AtAgent",
          before,
          cursor: emptyCursor(),
          editing: new Set(),
          witness,
        };
      }),
    begin,
    broke,
    drop: overSilently,
    end,
    fail,
    keepTerminal: Effect.fnUntraced(function* (
      terminalId: string,
      output: string
    ) {
      const runs = (item: ThreadItem) =>
        item.kind === "tool" &&
        item.content.some(
          (c) => c.type === "terminal" && c.terminalId === terminalId
        );
      const tool = (yield* store.items(threadId)).findLast(runs);
      if (tool) {
        yield* store.patchItem(threadId, tool.id, (item) =>
          item.kind === "tool"
            ? {
                ...item,
                content: item.content.map((c) =>
                  c.type === "terminal" && c.terminalId === terminalId
                    ? { ...c, output }
                    : c
                ),
              }
            : item
        );
      }
    }),
    place,
    state: Effect.sync(() => state),
    stopOpening: Effect.suspend(() =>
      state._tag === "Opening"
        ? Effect.as(Fiber.interrupt(state.fiber), true)
        : Effect.succeed(false)
    ),
  };
};
