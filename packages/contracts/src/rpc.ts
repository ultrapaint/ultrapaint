import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";
import { Catalogue } from "./catalogue.ts";
import {
  Comment,
  CommentList,
  CreateCommentInput,
  ReplyInput,
  UpdateCommentInput,
} from "./comments.ts";
import { DesignSystem, DesignSystemState } from "./design-system.ts";
import { ApplyInput, ApplyResult, DocumentState } from "./document.ts";
import { UndoResult, UndoState } from "./edit.ts";
import {
  AgentFailure,
  BadRequest,
  CommandFailed,
  Conflict,
  ForbiddenPath,
  NotConfigured,
  NotFound,
  Stale,
} from "./errors.ts";
import { FigmaImport } from "./figma.ts";
import {
  Checkpoint,
  GitCommitInput,
  GitCommitResult,
  GitDiff,
  GitStatus,
} from "./git.ts";
import {
  Canvas,
  CanvasLayout,
  FrameLayout,
  Page,
  PageList,
  UploadAssetInput,
} from "./pages.ts";
import { HostStatus, LogLine, ProjectInfo } from "./project.ts";
import { ScreenshotRequest, ScreenshotResult } from "./screenshots.ts";
import {
  PersistInput,
  PersistResult,
  Settings,
  SettingsValidation,
} from "./settings.ts";
import {
  CreateDesignsInput,
  CreateDesignsResult,
  SetupSuggestions,
} from "./setup.ts";
import { CustomiseMode, Skill, SkillList } from "./skills.ts";
import { Snapshot, SnapshotView } from "./snapshots.ts";
import {
  AgentConfig,
  AgentEdited,
  AgentEvent,
  AgentFocus,
  AgentOptions,
  AgentTerminalOutput,
  ChatDefaults,
  McpConnection,
  PromptInput,
  QueuedPrompt,
  SlashCommand,
  Thread,
  ThreadItem,
} from "./threads.ts";

const PagesError = Schema.Union([
  NotConfigured,
  NotFound,
  Conflict,
  ForbiddenPath,
  BadRequest,
  // Page changes go through the edit journal, which reports files changed behind its back.
  Stale,
]);
const EditError = Schema.Union([
  NotConfigured,
  NotFound,
  ForbiddenPath,
  Stale,
  Conflict,
  BadRequest,
]);
const ThreadError = Schema.Union([
  NotConfigured,
  NotFound,
  Conflict,
  ForbiddenPath,
  AgentFailure,
]);
const GitError = Schema.Union([NotConfigured, ForbiddenPath, CommandFailed]);
const CheckpointError = Schema.Union([NotConfigured, NotFound, ForbiddenPath]);

const ThreadRef = { threadId: Schema.String };

/** Every request the editor can make. Tags are the method names the editor already uses. */
const requestRpcs = [
  Rpc.make("health", {
    success: Schema.Struct({ ok: Schema.Boolean, version: Schema.String }),
  }),

  Rpc.make("settings.get", { success: Schema.NullOr(Settings) }),
  Rpc.make("settings.validate", {
    payload: Settings,
    success: SettingsValidation,
  }),
  Rpc.make("settings.set", { payload: Settings, success: SettingsValidation }),
  // Only while nothing is saved: writes the configuration file and keeps saving from then on.
  Rpc.make("settings.persist", {
    error: Schema.Union([BadRequest, Conflict]),
    payload: PersistInput,
    success: PersistResult,
  }),

  // First-run setup: what the repository looks like, and a designs directory to start in.
  Rpc.make("setup.detect", {
    error: BadRequest,
    payload: { repoPath: Schema.String },
    success: SetupSuggestions,
  }),
  Rpc.make("setup.createDesigns", {
    error: Schema.Union([BadRequest, ForbiddenPath]),
    payload: CreateDesignsInput,
    success: CreateDesignsResult,
  }),

  Rpc.make("project.info", { success: ProjectInfo }),
  Rpc.make("host.start", { error: NotConfigured, success: HostStatus }),
  Rpc.make("host.stop", { error: NotConfigured, success: HostStatus }),
  Rpc.make("logs.recent", { success: Schema.Array(LogLine) }),

  Rpc.make("pages.list", { error: NotConfigured, success: PageList }),
  Rpc.make("pages.templates", {
    error: NotConfigured,
    success: Schema.Array(
      Schema.Struct({ id: Schema.String, name: Schema.String })
    ),
  }),
  /** A page named as typed, its file that name made safe, serving a URL when one is given. */
  Rpc.make("pages.create", {
    error: PagesError,
    payload: {
      canvas: Schema.String,
      name: Schema.String,
      route: Schema.optional(Schema.String),
      template: Schema.optional(Schema.String),
    },
    success: Page,
  }),
  /** Renames the page: its file and its variants' move, its URL stays. */
  Rpc.make("pages.rename", {
    error: PagesError,
    payload: { id: Schema.String, name: Schema.String },
    success: Page,
  }),
  /** The URL the page serves in the prototype from now on; null takes it off. */
  Rpc.make("pages.setRoute", {
    error: PagesError,
    payload: { id: Schema.String, route: Schema.NullOr(Schema.String) },
    success: Page,
  }),
  Rpc.make("pages.duplicate", {
    error: PagesError,
    payload: { id: Schema.String },
    success: Page,
  }),
  Rpc.make("pages.delete", {
    error: PagesError,
    payload: { id: Schema.String },
  }),
  /**
   * The page drawn again for a variant: a copy of it serving the same URL, in the file of the
   * variant (`pricing@bold.page.json`), with its frame under the page's.
   */
  Rpc.make("pages.createVariant", {
    error: PagesError,
    payload: { id: Schema.String, variant: Schema.String },
    success: Page,
  }),
  /**
   * Pages copied, or moved, into another canvas with the same URLs, their frames where they
   * were. The target is a canvas, or one to create with that name. Refused when the target has a
   * page of the same file, or serving one of the URLs, already.
   */
  Rpc.make("pages.copyTo", {
    error: PagesError,
    payload: {
      ids: Schema.Array(Schema.String),
      move: Schema.Boolean,
      target: Schema.Union([
        Schema.Struct({ canvas: Schema.String }),
        Schema.Struct({ name: Schema.String }),
      ]),
    },
    success: Schema.Array(Page),
  }),

  Rpc.make("canvases.create", {
    error: PagesError,
    payload: { name: Schema.String },
    success: Canvas,
  }),
  /** What the canvas is called; its directory, and every link into it, stay. */
  Rpc.make("canvases.rename", {
    error: PagesError,
    payload: { id: Schema.String, name: Schema.String },
    success: Canvas,
  }),
  /** A copy of everything the canvas holds, pages, layout and own assets, under a new name. */
  Rpc.make("canvases.duplicate", {
    error: PagesError,
    payload: { id: Schema.String, name: Schema.String },
    success: Canvas,
  }),
  /** The canvas's pages, layout and comments; the last canvas stays. */
  Rpc.make("canvases.delete", {
    error: PagesError,
    payload: { id: Schema.String },
  }),
  /**
   * The URL the canvas's prototype opens on. A page of the canvas must serve it; when that page
   * later serves another URL the canvas follows it, and when it goes another page's URL is taken.
   */
  Rpc.make("canvases.setHome", {
    error: PagesError,
    payload: { id: Schema.String, route: Schema.String },
    success: Canvas,
  }),
  Rpc.make("canvases.reorder", {
    error: PagesError,
    payload: { order: Schema.Array(Schema.String) },
  }),
  Rpc.make("canvas.get", {
    error: PagesError,
    payload: { canvas: Schema.String },
    success: CanvasLayout,
  }),
  /** Saves where the pages' frames sit; the canvas's nodes change through `documents.apply`. */
  Rpc.make("canvas.set", {
    error: PagesError,
    payload: {
      canvas: Schema.String,
      frames: Schema.Record(Schema.String, FrameLayout),
    },
  }),
  /** Saves an image into the shared assets; the node that shows it is inserted separately. */
  Rpc.make("assets.upload", {
    error: EditError,
    payload: UploadAssetInput,
    success: Schema.Struct({
      /** What an image node's `src` holds: `assets/<file>`. */
      src: Schema.String,
    }),
  }),

  /** Every document of a canvas: its pages and its loose nodes. */
  Rpc.make("documents.list", {
    error: PagesError,
    payload: { canvas: Schema.String },
    success: Schema.Array(DocumentState),
  }),
  Rpc.make("documents.get", {
    error: PagesError,
    payload: { doc: Schema.String },
    success: DocumentState,
  }),
  /** Operations on one or several documents, as one undo step. */
  Rpc.make("documents.apply", {
    error: EditError,
    payload: ApplyInput,
    success: ApplyResult,
  }),

  Rpc.make("designSystem.get", {
    error: NotConfigured,
    success: DesignSystemState,
  }),
  /** Runs the fixed-rule scan and saves what it finds, without an agent. */
  Rpc.make("designSystem.detect", {
    error: EditError,
    success: DesignSystem,
  }),

  /** The design skills agents are told, built-in and the project's own, with what is off. */
  Rpc.make("skills.list", {
    error: NotConfigured,
    success: SkillList,
  }),
  /**
   * Starts a project file for a built-in skill: a copy of its text to replace it, or a stub
   * that extends it. A skill the project already has is returned as it is.
   */
  Rpc.make("skills.customise", {
    error: EditError,
    payload: { mode: CustomiseMode, name: Schema.String },
    success: Skill,
  }),

  /** Thumbnails of the palette drawn earlier, under the key of what they were drawn from. */
  Rpc.make("thumbnails.get", {
    error: NotConfigured,
    payload: { key: Schema.String },
    success: Schema.Record(Schema.String, Schema.String),
  }),
  Rpc.make("thumbnails.put", {
    error: Schema.Union([NotConfigured, BadRequest]),
    payload: {
      /** PNG data URL. */
      dataUrl: Schema.String,
      key: Schema.String,
      name: Schema.String,
    },
  }),

  /** An editor's answer to a `screenshot` event. */
  Rpc.make("screenshots.deliver", { payload: ScreenshotResult }),

  Rpc.make("comments.list", {
    error: PagesError,
    payload: { canvas: Schema.String },
    success: CommentList,
  }),
  Rpc.make("comments.create", {
    error: PagesError,
    payload: CreateCommentInput,
    success: Comment,
  }),
  Rpc.make("comments.update", {
    error: PagesError,
    payload: UpdateCommentInput,
    success: Comment,
  }),
  Rpc.make("comments.delete", {
    error: PagesError,
    payload: { canvas: Schema.String, id: Schema.String },
  }),
  Rpc.make("comments.reply", {
    error: PagesError,
    payload: ReplyInput,
    success: Comment,
  }),
  Rpc.make("comments.deleteReply", {
    error: PagesError,
    payload: {
      canvas: Schema.String,
      id: Schema.String,
      replyId: Schema.String,
    },
    success: Comment,
  }),

  Rpc.make("edit.undo", {
    error: EditError,
    success: Schema.NullOr(UndoResult),
  }),
  Rpc.make("edit.redo", {
    error: EditError,
    success: Schema.NullOr(UndoResult),
  }),
  Rpc.make("edit.state", { error: NotConfigured, success: UndoState }),

  Rpc.make("catalogue.get", {
    error: Schema.Union([NotConfigured, ForbiddenPath]),
    payload: { refresh: Schema.Boolean },
    success: Catalogue,
  }),
  Rpc.make("catalogue.storyUrl", {
    error: NotConfigured,
    payload: { storyId: Schema.String },
    success: Schema.NullOr(Schema.String),
  }),

  Rpc.make("agents.list", { success: Schema.Array(AgentConfig) }),
  /** The options each agent's sessions offer, for the agents that have run here before. */
  Rpc.make("agents.options", { success: Schema.Array(AgentOptions) }),
  /** What an agent's sessions offer, starting one to ask when it has not answered this run. */
  Rpc.make("agents.discover", {
    error: ThreadError,
    payload: { agentId: Schema.String },
    success: AgentOptions,
  }),
  Rpc.make("chat.defaults", { success: ChatDefaults }),
  Rpc.make("chat.setDefaults", { payload: ChatDefaults }),
  /** The commands a prompt may start with, `/init`, which the server expands. */
  Rpc.make("commands.list", { success: Schema.Array(SlashCommand) }),
  /** What an agent outside the editor needs to reach the editor's own MCP server. */
  Rpc.make("mcp.connection", { success: McpConnection }),
  Rpc.make("threads.list", { success: Schema.Array(Thread) }),
  Rpc.make("threads.create", {
    error: ThreadError,
    /** Without an agent, the chat's default one. */
    payload: {
      agentId: Schema.optional(Schema.String),
      title: Schema.optional(Schema.String),
    },
    success: Thread,
  }),
  Rpc.make("threads.items", {
    payload: ThreadRef,
    success: Schema.Array(ThreadItem),
  }),
  /** Sends a prompt; while the agent works, it waits in the thread's queue instead. */
  Rpc.make("threads.prompt", { error: ThreadError, payload: PromptInput }),
  /** Takes a queued prompt back out, to drop it or to edit it in the composer. */
  Rpc.make("threads.unqueue", {
    error: ThreadError,
    payload: { id: Schema.String, threadId: Schema.String },
    success: Schema.NullOr(QueuedPrompt),
  }),
  /** Sends the oldest queued prompt now, after a turn that was stopped or failed. */
  Rpc.make("threads.sendQueued", { error: ThreadError, payload: ThreadRef }),
  Rpc.make("threads.cancel", { error: ThreadError, payload: ThreadRef }),
  Rpc.make("threads.delete", { payload: ThreadRef }),
  /** The user's answers to a question card; they reach the agent as the next prompt. */
  Rpc.make("threads.answer", {
    error: ThreadError,
    payload: {
      ...ThreadRef,
      answers: Schema.Record(Schema.String, Schema.String),
      itemId: Schema.String,
    },
  }),
  Rpc.make("threads.permission", {
    error: ThreadError,
    payload: {
      ...ThreadRef,
      optionId: Schema.String,
      remember: Schema.Boolean,
      requestId: Schema.String,
    },
  }),
  /** The agent the thread's next prompt goes to. Its session ends; the transcript stays. */
  Rpc.make("threads.setAgent", {
    error: ThreadError,
    payload: { ...ThreadRef, agentId: Schema.String },
  }),
  Rpc.make("threads.setMode", {
    error: ThreadError,
    payload: { ...ThreadRef, modeId: Schema.String },
  }),
  Rpc.make("threads.setConfigOption", {
    error: ThreadError,
    payload: { ...ThreadRef, optionId: Schema.String, value: Schema.String },
  }),

  Rpc.make("git.status", { error: GitError, success: GitStatus }),

  /** The Figma files imported so far, newest first. The file itself arrives over HTTP. */
  Rpc.make("figma.list", {
    error: NotConfigured,
    success: Schema.Array(FigmaImport),
  }),
  Rpc.make("figma.delete", {
    error: Schema.Union([NotConfigured, NotFound]),
    payload: { id: Schema.String },
  }),
  Rpc.make("git.diff", {
    error: GitError,
    payload: { path: Schema.String },
    success: GitDiff,
  }),
  Rpc.make("git.commit", {
    error: GitError,
    payload: GitCommitInput,
    success: GitCommitResult,
  }),
  Rpc.make("checkpoints.list", { success: Schema.Array(Checkpoint) }),
  Rpc.make("checkpoints.diff", {
    error: CheckpointError,
    payload: { id: Schema.String },
    success: Schema.Array(GitDiff),
  }),
  Rpc.make("checkpoints.revert", {
    error: CheckpointError,
    payload: { id: Schema.String },
  }),

  /** Named points in the history of the designs, newest first. */
  Rpc.make("snapshots.list", {
    error: NotConfigured,
    success: Schema.Array(Snapshot),
  }),
  /** The designs as they are now, or as an agent turn's checkpoint kept them, under a name. */
  Rpc.make("snapshots.create", {
    error: CheckpointError,
    payload: {
      /** Name that checkpoint instead of the designs as they are now. */
      checkpoint: Schema.optional(Schema.String),
      name: Schema.String,
    },
    success: Snapshot,
  }),
  Rpc.make("snapshots.delete", {
    error: CheckpointError,
    payload: { id: Schema.String },
  }),
  /** What changed since: one diff per design file that is not as the snapshot kept it. */
  Rpc.make("snapshots.diff", {
    error: CheckpointError,
    payload: { id: Schema.String },
    success: Schema.Array(GitDiff),
  }),
  /** The snapshot to look at, without touching a file. */
  Rpc.make("snapshots.view", {
    error: CheckpointError,
    payload: { id: Schema.String },
    success: SnapshotView,
  }),
  /** The design files put back as the snapshot kept them: one undo step. */
  Rpc.make("snapshots.restore", {
    error: EditError,
    payload: { id: Schema.String },
  }),
] as const;

/** Everything the server pushes. Each is a stream that stays open for the life of the socket. */
export const eventSchemas = {
  agent: AgentEvent,
  "agent.edited": AgentEdited,
  "agent.focus": AgentFocus,
  "agent.terminal": AgentTerminalOutput,
  canvas: Schema.Struct({ canvas: Schema.String, layout: CanvasLayout }),
  comments: Schema.Struct({ canvas: Schema.String, list: CommentList }),
  designSystem: DesignSystemState,
  /** A document changed: an edit, an undo, an agent, a branch switch. */
  document: DocumentState,
  "edit.state": UndoState,
  "file.changed": Schema.Struct({ file: Schema.String, hash: Schema.String }),
  git: GitStatus,
  log: LogLine,
  pages: PageList,
  project: ProjectInfo,
  /** An agent wants a picture of a node: an editor that can draw it answers with `screenshots.deliver`. */
  screenshot: ScreenshotRequest,
  /** A skill file changed, or the settings turned one on or off. */
  skills: SkillList,
} as const;

const eventRpcs = [
  Rpc.make("events.agent", { stream: true, success: eventSchemas.agent }),
  Rpc.make("events.agent.edited", {
    stream: true,
    success: eventSchemas["agent.edited"],
  }),
  Rpc.make("events.agent.focus", {
    stream: true,
    success: eventSchemas["agent.focus"],
  }),
  Rpc.make("events.agent.terminal", {
    stream: true,
    success: eventSchemas["agent.terminal"],
  }),
  Rpc.make("events.canvas", { stream: true, success: eventSchemas.canvas }),
  Rpc.make("events.document", { stream: true, success: eventSchemas.document }),
  Rpc.make("events.designSystem", {
    stream: true,
    success: eventSchemas.designSystem,
  }),
  Rpc.make("events.comments", {
    stream: true,
    success: eventSchemas.comments,
  }),
  Rpc.make("events.edit.state", {
    stream: true,
    success: eventSchemas["edit.state"],
  }),
  Rpc.make("events.file.changed", {
    stream: true,
    success: eventSchemas["file.changed"],
  }),
  Rpc.make("events.git", { stream: true, success: eventSchemas.git }),
  Rpc.make("events.log", { stream: true, success: eventSchemas.log }),
  Rpc.make("events.project", { stream: true, success: eventSchemas.project }),
  Rpc.make("events.pages", { stream: true, success: eventSchemas.pages }),
  Rpc.make("events.screenshot", {
    stream: true,
    success: eventSchemas.screenshot,
  }),
  Rpc.make("events.skills", { stream: true, success: eventSchemas.skills }),
] as const;

export class UltrapaintRpcs extends RpcGroup.make(...requestRpcs, ...eventRpcs) {}

export type UltrapaintRpc = RpcGroup.Rpcs<typeof UltrapaintRpcs>;

export type EventName = keyof typeof eventSchemas;
export type EventPayload<E extends EventName> =
  (typeof eventSchemas)[E]["Type"];
export const eventNames = Object.keys(eventSchemas) as EventName[];

export type RequestName = Exclude<UltrapaintRpc["_tag"], `events.${string}`>;
// Distributive on purpose: callers pass unions such as `"edit.undo" | "edit.redo"`.
export type RequestInput<M extends RequestName> = M extends RequestName
  ? Rpc.Payload<Rpc.ExtractTag<UltrapaintRpc, M>>
  : never;
export type RequestOutput<M extends RequestName> = M extends RequestName
  ? Rpc.Success<Rpc.ExtractTag<UltrapaintRpc, M>>
  : never;
