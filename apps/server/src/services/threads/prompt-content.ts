/**
 * What a prompt gives the agent, its content: the prompt's text, or the task a command stands
 * for and the purpose it gives the thread, its attachments as content, and what leads a
 * session's first prompt (the briefing, and what was said before the session). A thread's title
 * and scope come from its first prompt. The turn itself, its queue and its end are the thread
 * session's (`thread-session.ts`).
 */
import { pathToFileURL } from "node:url";
import type { ContentBlock } from "@ultrapaint/acp/acp-agent";
import type { LookPlace } from "@ultrapaint/contracts/components";
import {
  parseCommand,
  taskPurpose,
  toldTheDesignSkill,
} from "@ultrapaint/contracts/tasks";
import type {
  BoardAttachment,
  BoardPickKind,
  PromptInput,
  Thread,
  ThreadItem,
  ThreadPurpose,
  ThreadScope,
} from "@ultrapaint/contracts/threads";
import { lookPathOf } from "@ultrapaint/design-document/look-places";
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

/** Two lists of skills' names hold the same ones, in any order. */
const sameNames = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((name) => b.includes(name));

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

/** A variant's member as a component's file keys it: `variant=outline`, `tone=featured`. */
const memberKey = (place: LookPlace | undefined) =>
  place?.variant ? `${place.variant.axis}=${place.variant.member}` : null;

/** A system component's look at the place picked, or the component when none is. */
const systemComponentText = (a: BoardAttachment, now: string) => {
  const { place } = a;
  if (!(place?.variant || place?.state)) {
    return `The user has picked the system component ${a.name}${now}, whose look is ${a.file}. Changes should target its look unless told otherwise.`;
  }
  const where = [memberKey(place), place.state && `the ${place.state} state`]
    .filter(Boolean)
    .join(" in ");
  return `The user has picked the look of the system component ${a.name} at ${where}${now}: ${lookPathOf(place)} of ${a.file}. Changes should target that place of its look unless told otherwise.`;
};

/** What each kind of pick is told as, `now` what it is now in brackets, or nothing. */
const PICK_TEXT: Record<
  BoardPickKind,
  (a: BoardAttachment, now: string) => string
> = {
  appComponent: (a, now) => {
    const key = memberKey(a.place);
    return key
      ? `The user has picked the variant ${key} of the app component ${a.name}${now || ` (what its nodes override under at["${key}"])`}, kept in ${a.file}. Changes should target that variant unless told otherwise.`
      : `The user has picked the app component ${a.name}${now}, kept in ${a.file}. Changes should target this component unless told otherwise.`;
  },
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
  `${[a.name, memberKey(a.place), a.place?.state].filter(Boolean).join(" ")} @ ${a.file}`;

/**
 * A text file from the person's disk as the agent reads it (ADR 0064): in the prompt's text,
 * which every agent takes, since it has no path in the project to link to.
 */
const attachedText = (name: string, text: string) =>
  `The user attached the file ${name}:\n<attached-file name=${JSON.stringify(name)}>\n${text}\n</attached-file>`;

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
      } else if (a.kind === "text") {
        blocks.push({ text: attachedText(a.name, a.text), type: "text" });
        labels.push(a.name);
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
   * What leads a session's first prompt, `text`, its `blocks`. A resumed session has the
   * conversation back, and the briefing with it if anything was ever asked: `briefed` is false.
   * A new one is told the project, then what was said before it. `reviewed`: the editor reviews
   * what the thread's turns make. `skills`: the chat's own design skills (`Thread.skills`).
   * `told`: the design skills the briefing told, by name, the thread's record of them
   * (`Thread.toldSkills`); absent when it told nothing of them.
   */
  const sessionContext = Effect.fnUntraced(function* (
    resumed: boolean,
    earlier: readonly ThreadItem[],
    purpose: ThreadPurpose,
    tools: boolean,
    text: string,
    reviewed: boolean,
    skills: readonly string[] | undefined
  ): Effect.fn.Return<{
    readonly blocks: readonly ContentBlock[];
    readonly briefed: boolean;
    readonly told: readonly string[] | undefined;
  }> {
    if (resumed && earlier.some((i) => i.kind === "user")) {
      return { blocks: [], briefed: false, told: undefined };
    }
    // A session started for a task that draws nothing (Map, an implementation's link) is not
    // told how to design well.
    const parsed = parseCommand(text);
    const designs =
      parsed?._tag !== "Request" || toldTheDesignSkill(parsed.request);
    const about = briefingEnabled
      ? yield* briefing.text(purpose, { designs, reviewed, skills, tools })
      : undefined;
    const told =
      about !== undefined && purpose === "design" && designs
        ? yield* briefing.told(skills)
        : undefined;
    const recap = resumed ? null : recapOf(earlier);
    return {
      blocks: [about, recap].flatMap((said): ContentBlock[] =>
        said ? [{ text: said, type: "text" }] : []
      ),
      briefed: true,
      told,
    };
  });

  /**
   * What leads a later prompt of a design thread whose design skills changed since it was told
   * them (`Thread.toldSkills`, ADR 0095): the skills it chose now, or to stop following any, and
   * the new record. Null when nothing changed, or its session was told nothing of them.
   */
  const skillsChange = Effect.fnUntraced(function* (
    thread: Thread,
    tools: boolean,
    reviewed: boolean
  ): Effect.fn.Return<{
    readonly block: ContentBlock;
    readonly told: readonly string[];
  } | null> {
    const before = thread.toldSkills;
    if (before === undefined || (thread.purpose ?? "design") !== "design") {
      return null;
    }
    const now = yield* briefing.told(thread.skills);
    if (now === undefined || sameNames(now, before)) {
      return null;
    }
    const note = yield* briefing.changed(now, {
      method: before.length === 0,
      reviewed,
      tools,
    });
    return note === undefined
      ? null
      : { block: { text: note, type: "text" }, told: now };
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

  return { attachmentBlocks, sessionContext, skillsChange, taskFor };
});
