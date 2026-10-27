/**
 * What a turn sends the agent: the prompt's text, or the task a command stands for, its
 * attachments as content, and what leads a session's first prompt (the briefing, and what was
 * said before the session). A thread's title and scope come from its first prompt. The turn
 * itself, its queue and its end are the thread session's (`thread-session.ts`).
 */
import type { ContentBlock } from "@ultrapaint/acp/acp-agent";
import type {
  PromptInput,
  Thread,
  ThreadItem,
  ThreadPurpose,
  ThreadScope,
} from "@ultrapaint/contracts/threads";
import { Effect, FileSystem } from "effect";
import { ServerConfig } from "../../config.ts";
import type { RepoPaths } from "../repo-paths.ts";
import { ProjectBriefing } from "./briefing.ts";
import { SlashCommands } from "./commands.ts";
import { recapOf } from "./recap.ts";
import { ThreadStore } from "./thread-store.ts";

const DATA_URL_RE = /^data:([^;]+);base64,(.*)$/s;

/** What a design thread whose agent is running is told when asked to implement. */
const DESIGN_THREAD_IMPLEMENT = `<ultrapaint-task command="implement">
The user ran /implement in a thread that designs: its agent can write the designs directory only,
not the application's code (ADR 0030). Do not try to write the code. Tell the user, in a sentence,
to press Implement on the page (or start a new chat with /implement), which opens a thread that
can, and stop.
</ultrapaint-task>`;

/** Until the first prompt names it. */
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
export const titleOf = (text: string) => {
  const line = text.trim().split("\n")[0]?.trim() ?? "";
  if (!line) {
    return UNTITLED;
  }
  return line.length > TITLE_LIMIT ? `${line.slice(0, TITLE_LIMIT)}…` : line;
};

export const makePromptContent = Effect.fnUntraced(function* () {
  const store = yield* ThreadStore;
  const briefing = yield* ProjectBriefing;
  const commands = yield* SlashCommands;
  const { briefing: briefingEnabled } = yield* ServerConfig;
  const fs = yield* FileSystem.FileSystem;

  /** The prompt's text and attachments as the agent gets them, and as the transcript names them. */
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

  /**
   * What leads a session's first prompt. A resumed session has the conversation back, and
   * the briefing with it if anything was ever asked. A new one is told the project, then
   * what was said before it.
   */
  const sessionContext = Effect.fnUntraced(function* (
    resumed: boolean,
    earlier: readonly ThreadItem[],
    purpose: ThreadPurpose
  ) {
    if (resumed && earlier.some((i) => i.kind === "user")) {
      return [];
    }
    const about = briefingEnabled ? yield* briefing.text(purpose) : undefined;
    const recap = resumed ? null : recapOf(earlier);
    return [about, recap].flatMap((text): ContentBlock[] =>
      text ? [{ text, type: "text" }] : []
    );
  });

  /**
   * The task a prompt stands for. A task that implements turns a thread that has not started its
   * agent into an implement thread: its session is then started with the repository writable
   * (ADR 0030). One already running keeps its sandbox, and is told to send the user to an
   * implement thread.
   */
  const taskFor = Effect.fnUntraced(function* (thread: Thread, text: string) {
    const task = yield* commands.expand(text);
    if (
      task === null ||
      task.purpose !== "implement" ||
      thread.purpose === "implement"
    ) {
      return task?.text ?? null;
    }
    if (thread.sessionId !== undefined) {
      return DESIGN_THREAD_IMPLEMENT;
    }
    yield* store.update(thread.id, { purpose: "implement" });
    return task.text;
  });

  return { attachmentBlocks, sessionContext, taskFor };
});
