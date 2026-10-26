/**
 * What a thread's agent asks of the editor while it works, as an ACP client answers it: its
 * session updates projected into the transcript, permission requests and the questions an MCP
 * server puts through it drawn as cards the user answers, and its file and terminal calls,
 * confined to the repository.
 */
import type {
  AcpHandlers,
  CreateElicitationRequest,
  CreateElicitationResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
} from "@ultrapaint/acp/acp-agent";
import type { TerminalManager } from "@ultrapaint/acp/terminal-manager";
import { ForbiddenPath } from "@ultrapaint/contracts/errors";
import { Clock, Deferred, Effect, FileSystem, Path } from "effect";
import { AppLog } from "../../app-log.ts";
import { makeWriteAtomic } from "../../atomic-write.ts";
import { EventBus } from "../../events.ts";
import { hashContent } from "../../hash.ts";
import { makeId } from "../../ids.ts";
import type { RepoPaths } from "../repo-paths.ts";
import { questionsOf } from "./elicitation.ts";
import type { Live } from "./live-sessions.ts";
import { ThreadStore } from "./thread-store.ts";
import { projectUpdate } from "./transcript.ts";

export const DECLINE: CreateElicitationResponse = { action: "decline" };
const CANCEL: CreateElicitationResponse = { action: "cancel" };

export const makeAgentClient = Effect.fnUntraced(function* (
  newItemId: Effect.Effect<string>
) {
  const store = yield* ThreadStore;
  const log = yield* AppLog;
  const events = yield* EventBus;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const writeAtomic = makeWriteAtomic(fs, path);

  // ---- transcript ----
  const onUpdate = Effect.fnUntraced(function* (
    threadId: string,
    session: Live,
    update: Parameters<typeof projectUpdate>[0],
    relative: (file: string) => string
  ) {
    if (session.replaying) {
      return;
    }
    // Ids are drawn up front because the projection itself is pure and synchronous.
    const ids = [yield* newItemId];
    const actions = projectUpdate(update, {
      hasItem: (itemId) => store.hasItem(threadId, itemId),
      newId: () => ids.pop() ?? `item_${ids.length}`,
      now: yield* Clock.currentTimeMillis,
      relative,
      turn: session.turn,
    });
    for (const action of actions) {
      if (action.type === "push") {
        yield* store.push(threadId, action.item);
      } else if (action.type === "patch") {
        yield* store.patchItem(threadId, action.itemId, action.patch);
      } else {
        yield* store.update(threadId, action.patch);
      }
    }
  });

  // ---- questions an MCP server asks through the agent ----
  const shown = new Map<string, number>();

  /**
   * A form the agent waits on: drawn as a question card, answered when the user sends it.
   * A link to follow, or a field the card has no input for, is declined at once.
   */
  const onElicitation = Effect.fnUntraced(function* (
    threadId: string,
    session: Live,
    request: CreateElicitationRequest
  ) {
    const questions =
      request.mode === "form" && "requestedSchema" in request
        ? questionsOf(request.requestedSchema)
        : null;
    if (questions === null || questions.length === 0) {
      yield* log.log(
        "agent",
        "info",
        `declined a question the editor cannot show: ${request.message}`
      );
      return DECLINE;
    }
    const itemId = yield* newItemId;
    const reply = yield* Deferred.make<CreateElicitationResponse>();
    session.asking.set(itemId, { questions, reply });
    shown.set(threadId, (shown.get(threadId) ?? 0) + 1);
    yield* store.push(threadId, {
      answers: null,
      at: yield* Clock.currentTimeMillis,
      elicitation: { message: request.message },
      id: itemId,
      kind: "question",
      questions,
    });
    return yield* Deferred.await(reply).pipe(
      Effect.ensuring(Effect.sync(() => session.asking.delete(itemId)))
    );
  });

  /** The agent stops waiting: its open cards say so, and it hears `cancel` for each. */
  const letGo = Effect.fnUntraced(function* (threadId: string, session: Live) {
    for (const [itemId, pending] of session.asking) {
      yield* store.patchItem(threadId, itemId, (item) =>
        item.kind === "question" && item.answers === null
          ? { ...item, outcome: "cancelled" as const }
          : item
      );
      yield* Deferred.succeed(pending.reply, CANCEL);
    }
    session.asking.clear();
  });

  // ---- permissions ----
  const onPermission = Effect.fnUntraced(function* (
    threadId: string,
    session: Live,
    request: RequestPermissionRequest
  ) {
    const { toolCall } = request;
    const rememberKey = toolCall.kind ?? toolCall.title ?? "tool";
    const remembered = session.remembered.get(rememberKey);
    if (remembered && request.options.some((o) => o.optionId === remembered)) {
      return {
        outcome: { optionId: remembered, outcome: "selected" },
      } satisfies RequestPermissionResponse;
    }
    const requestId = yield* makeId("perm");
    const detail = [
      ...(toolCall.locations ?? []).map((l) => l.path),
      ...(toolCall.rawInput
        ? [JSON.stringify(toolCall.rawInput).slice(0, 500)]
        : []),
    ].join("\n");
    const decision = yield* Deferred.make<RequestPermissionResponse>();
    session.pending.set(requestId, { decision, rememberKey });
    yield* store.push(threadId, {
      at: yield* Clock.currentTimeMillis,
      decision: null,
      id: requestId,
      kind: "permission",
      options: request.options.map((o) => ({
        kind: o.kind,
        name: o.name,
        optionId: o.optionId,
      })),
      requestId,
      title: toolCall.title ?? "Permission request",
      ...(detail ? { detail } : {}),
      ...(toolCall.toolCallId ? { toolCallId: toolCall.toolCallId } : {}),
    });
    const response = yield* Deferred.await(decision);
    session.pending.delete(requestId);
    const chosen =
      response.outcome.outcome === "selected"
        ? response.outcome.optionId
        : "cancelled";
    yield* store.patchItem(threadId, requestId, (i) =>
      i.kind === "permission" ? { ...i, decision: chosen } : i
    );
    return response;
  });

  // ---- what the host does for the agent ----
  const handlersFor = (
    threadId: string,
    agentName: string,
    paths: RepoPaths["Service"],
    terminals: TerminalManager,
    session: () => Live,
    /**
     * The only directory the agent may write through the editor, when not the whole repository:
     * a design thread's designs directory (ADR 0030). The sandbox closes the rest to its own
     * tools; this closes it to the writes the editor makes for it.
     */
    writable?: string
  ): AcpHandlers => ({
    onElicitation: (request) => onElicitation(threadId, session(), request),
    onPermission: (request) => onPermission(threadId, session(), request),
    onStderr: (text) => log.log("agent", "info", `[${agentName}] ${text}`),
    readTextFile: Effect.fn("ThreadService.readTextFile")(function* (request) {
      const abs = yield* paths.resolve(request.path);
      const content = yield* fs.readFileString(abs);
      if (!(request.line || request.limit)) {
        return { content };
      }
      const start = Math.max(0, (request.line ?? 1) - 1);
      const end = request.limit ? start + request.limit : undefined;
      return {
        content: content.split("\n").slice(start, end).join("\n"),
      };
    }),
    terminal: {
      create: Effect.fn("ThreadService.createTerminal")(function* (request) {
        const cwd = request.cwd
          ? yield* paths.resolve(request.cwd)
          : paths.root;
        const terminalId = yield* terminals.create({
          args: request.args ?? [],
          command: request.command,
          cwd,
          env: Object.fromEntries(
            (request.env ?? []).map((e) => [e.name, e.value])
          ),
          outputByteLimit: request.outputByteLimit,
        });
        return { terminalId };
      }),
      kill: (request) => terminals.kill(request.terminalId),
      output: (request) => terminals.output(request.terminalId),
      release: (request) => terminals.release(request.terminalId),
      waitForExit: (request) => terminals.waitForExit(request.terminalId),
    },
    writeTextFile: Effect.fn("ThreadService.writeTextFile")(
      function* (request) {
        const abs = yield* paths.resolve(request.path);
        // The editor writes this file, outside the sandbox that keeps `.git` read-only: an agent
        // asking it to write a git configuration or a hook would escape through git (0013).
        if (paths.relative(abs).split(path.sep).includes(".git")) {
          return yield* new ForbiddenPath({
            message: `${paths.relative(abs)} is git's own: agents do not write in .git.`,
          });
        }
        if (
          writable !== undefined &&
          abs !== writable &&
          !abs.startsWith(`${writable}${path.sep}`)
        ) {
          return yield* new ForbiddenPath({
            message: `${paths.relative(abs)} is outside the designs directory: this thread designs, and writes only ${paths.relative(writable)}. The application's code is an implement thread's (the Implement button).`,
          });
        }
        yield* writeAtomic(abs, request.content);
        yield* events.publish("file.changed", {
          file: paths.relative(abs),
          hash: hashContent(request.content),
        });
      }
    ),
  });

  return { handlersFor, letGo, onUpdate, shown };
});

export type AgentClient = Effect.Success<ReturnType<typeof makeAgentClient>>;
