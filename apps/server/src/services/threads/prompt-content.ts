/**
 * What a prompt gives the agent, its content: the prompt's text, or the task a command stands
 * for and the purpose it gives the thread, its attachments as content, and what leads a
 * session's first prompt (the briefing, and what was said before the session). A thread's title
 * and scope come from its first prompt. The turn itself, its queue and its end are the thread
 * session's (`thread-session.ts`).
 */
import { pathToFileURL } from "node:url";
import type { ContentBlock } from "@ultrapaint/acp/acp-agent";
import { parseCommand, taskPurpose } from "@ultrapaint/contracts/tasks";
import type {
  BoardAttachment,
  BoardPickKind,
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

const DATA_URL_RE = /^data:([^;]+);base64,(.*)$/s;

/** What a design thread whose agent is running is told when asked to implement. */
const DESIGN_THREAD_IMPLEMENT = `<ultrapaint-task command="implement">
The user ran /implement in a thread that designs: its agent can write the designs directory only,
not the application's code (ADR 0030). Do not try to write the code. Tell the user, in a sentence,
to press Implement on the page (or start a new chat with /implement), which opens a thread that
can, and stop.
</ultrapaint-task>`;

/**
 * What a prompt that is a command makes its thread for, before its session starts, which it
 * decides (ADR 0030): a task that implements makes a thread that has not started its agent an
 * implement thread, whose session is then started with the repository writable. One already
 * running keeps its purpose and its sandbox. Null when the prompt is not a command.
 */
export const purposeFor = (
  thread: Thread,
  text: string
): ThreadPurpose | null => {
  const parsed = parseCommand(text);
  if (parsed === null) {
    return null;
  }
  const purpose = thread.purpose ?? "design";
  const wanted =
    parsed._tag === "Request" ? taskPurpose(parsed.request) : "design";
  return wanted === "implement" && thread.sessionId === undefined
    ? "implement"
    : purpose;
};

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

/**
 * Where a system component's file keeps its look at a place: `variantStates.variant.outline.hover`
 * for an outline button's hover, `variants.size.lg`, `states.hover`, else `base`.
 */
const lookPathOf = (variant: string | undefined, state: string | undefined) => {
  const [axis, member] = variant?.split("=") ?? [];
  if (axis && member) {
    return state
      ? `variantStates.${axis}.${member}.${state}`
      : `variants.${axis}.${member}`;
  }
  return state ? `states.${state}` : "base";
};

/** A system component's look at the place picked, or the component when none is. */
const systemComponentText = (a: BoardAttachment, now: string) => {
  if (!(a.variant || a.state)) {
    return `The user has picked the system component ${a.name}${now}, whose look is ${a.file}. Changes should target its look unless told otherwise.`;
  }
  const place = [a.variant, a.state && `the ${a.state} state`]
    .filter(Boolean)
    .join(" in ");
  return `The user has picked the look of the system component ${a.name} at ${place}${now}: ${lookPathOf(a.variant, a.state)} of ${a.file}. Changes should target that place of its look unless told otherwise.`;
};

/** What each kind of pick is told as, `now` what it is now in brackets, or nothing. */
const PICK_TEXT: Record<
  BoardPickKind,
  (a: BoardAttachment, now: string) => string
> = {
  appComponent: (a, now) =>
    a.variant
      ? `The user has picked the variant ${a.variant} of the app component ${a.name}${now || ` (what its nodes override under at["${a.variant}"])`}, kept in ${a.file}. Changes should target that variant unless told otherwise.`
      : `The user has picked the app component ${a.name}${now}, kept in ${a.file}. Changes should target this component unless told otherwise.`,
  foundation: (a, now) =>
    `The user is looking at the design system's ${a.name}${now}, kept in ${a.file}. Changes should target these tokens unless told otherwise.`,
  group: (a, now) =>
    `The user has picked the colour group ${a.name} of the design system${now}, kept in ${a.file}. Changes should target this group's tokens unless told otherwise.`,
  guideline: (a, now) =>
    `The user is looking at the section "${a.name}" of ${a.file}, the design system's guidelines${now}. Changes should target this section unless told otherwise.`,
  systemComponent: systemComponentText,
  textStyle: (a, now) =>
    `The user has picked the text style ${a.name} of the design system${now}, kept in ${a.file}. Changes should target this text style unless told otherwise.`,
  token: (a, now) =>
    `The user has picked the token ${a.name} of the design system${now}, kept in ${a.file}. Changes should target this token unless told otherwise.`,
};

/** What the user picked on a board, told as the agent should take it (ADR 0045, B11). */
export const boardPickText = (a: BoardAttachment): string =>
  PICK_TEXT[a.pick](a, a.detail ? ` (${a.detail})` : "");

/** How the transcript names a board's pick: `Button variant=outline hover @ components/Button.component.json`. */
const boardPickLabel = (a: BoardAttachment) =>
  `${[a.name, a.variant, a.state].filter(Boolean).join(" ")} @ ${a.file}`;

/** A thread's title from its first prompt: the first line, cut to fit the thread menu. */
export const titleOf = (text: string) => {
  const line = text.trim().split("\n")[0]?.trim() ?? "";
  if (!line) {
    return UNTITLED;
  }
  return line.length > TITLE_LIMIT ? `${line.slice(0, TITLE_LIMIT)}…` : line;
};

export const makePromptContent = Effect.fnUntraced(function* () {
  const briefing = yield* ProjectBriefing;
  const commands = yield* SlashCommands;
  const { briefing: briefingEnabled } = yield* ServerConfig;
  const fs = yield* FileSystem.FileSystem;

  /** A board's pick: what it is, and its file linked, when it has one yet. */
  const boardBlocks = Effect.fnUntraced(function* (
    a: BoardAttachment,
    paths: RepoPaths["Service"]
  ) {
    const abs = yield* paths.resolve(a.file);
    // A system component in its default look has no file yet: it is named, not linked.
    const exists = yield* Effect.orElseSucceed(fs.exists(abs), () => false);
    const text: ContentBlock = { text: boardPickText(a), type: "text" };
    return exists
      ? [
          text,
          {
            name: a.file,
            type: "resource_link",
            uri: pathToFileURL(abs).href,
          } satisfies ContentBlock,
        ]
      : [text];
  });

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
          resource: {
            mimeType: "text/plain",
            text,
            uri: pathToFileURL(abs).href,
          },
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
          { name: a.file, type: "resource_link", uri: pathToFileURL(abs).href }
        );
        labels.push(`${a.name} @ ${a.file}`);
      } else if (a.kind === "board") {
        blocks.push(...(yield* boardBlocks(a, paths)));
        labels.push(boardPickLabel(a));
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
    purpose: ThreadPurpose,
    tools: boolean
  ) {
    if (resumed && earlier.some((i) => i.kind === "user")) {
      return [];
    }
    const about = briefingEnabled
      ? yield* briefing.text(purpose, { tools })
      : undefined;
    const recap = resumed ? null : recapOf(earlier);
    return [about, recap].flatMap((text): ContentBlock[] =>
      text ? [{ text, type: "text" }] : []
    );
  });

  /**
   * The task a prompt stands for, worded for an agent with the editor's tools (`tools`) or
   * without them; null when the prompt is not a command. A thread whose agent was started to
   * design is told to send the user to an implement thread instead (`purposeFor`).
   */
  const taskFor = Effect.fnUntraced(function* (
    thread: Thread,
    text: string,
    tools: boolean
  ): Effect.fn.Return<string | null> {
    const task = yield* commands.expand(text, { tools });
    if (task === null) {
      return null;
    }
    const designing =
      task.purpose === "implement" && purposeFor(thread, text) !== "implement";
    return designing ? DESIGN_THREAD_IMPLEMENT : task.text;
  });

  return { attachmentBlocks, sessionContext, taskFor };
});
