import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";
import { CanvasId, FileId } from "./base.ts";
import {
  Comment,
  CommentList,
  CreateCommentInput,
  ReplyInput,
  UpdateCommentInput,
} from "./comments.ts";
import {
  ComponentChange,
  ComponentEntry,
  ComponentList,
} from "./components.ts";
import { DesignSystem, DesignSystemState } from "./design-system.ts";
import { DesignSystemEditInput } from "./design-system-edit.ts";
import {
  DefineMode,
  DesignSystemSetup,
  MappingChange,
  RestoreEntry,
  SetupStepId,
  UsageInventory,
  UsageMapping,
} from "./design-system-setup.ts";
import {
  AppliedChanges,
  ApplyInput,
  DesignNode,
  DocumentChange,
  DocumentState,
} from "./document.ts";
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
  ImplementationChanges,
  ImplementationItem,
  ImplementationList,
  ImplementationTarget,
} from "./implementation.ts";
import {
  Canvas,
  CanvasLayout,
  FrameLayout,
  Page,
  PageList,
  UploadAssetInput,
} from "./pages.ts";
import { LogLine, ProjectInfo } from "./project.ts";
import { ScreenshotRequest, ScreenshotResult } from "./screenshots.ts";
import {
  PersistInput,
  PersistResult,
  Settings,
  SettingsValidation,
  UserProfile,
} from "./settings.ts";
import {
  CreateDesignsInput,
  CreateDesignsResult,
  ScaffoldInput,
  ScaffoldResult,
  SetupSuggestions,
} from "./setup.ts";
import { CustomiseMode, Skill, SkillList } from "./skills.ts";
import { Snapshot, SnapshotView } from "./snapshots.ts";
import {
  SyncPlan,
  TokenComparison,
  TokenDecision,
  TokenMatchInput,
  TokenSourceKind,
} from "./sync.ts";
import { TaskRequest } from "./tasks.ts";
import {
  AgentConfig,
  AgentEdited,
  AgentEvent,
  AgentFocus,
  AgentOptions,
  AgentTerminalOutput,
  Answers,
  ChatDefaults,
  McpConnection,
  PromptInput,
  QueuedPrompt,
  SlashCommand,
  Thread,
  ThreadItem,
  ThreadPurpose,
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
/** Writing to git with the project's git setting off is a BadRequest. */
const GitWriteError = Schema.Union([
  NotConfigured,
  ForbiddenPath,
  CommandFailed,
  BadRequest,
]);
const CheckpointError = Schema.Union([NotConfigured, NotFound, ForbiddenPath]);
/** A step out of order, or a snapshot that cannot be taken or put back, is a BadRequest. */
const SetupError = Schema.Union([
  NotConfigured,
  BadRequest,
  CommandFailed,
  ForbiddenPath,
  NotFound,
]);
const SetupStepRef = { step: SetupStepId };

const ThreadRef = { threadId: FileId };

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

  // A configuration file still under its earlier name takes the current one; returns its path.
  Rpc.make("settings.renameConfig", {
    error: Schema.Union([BadRequest, Conflict]),
    success: Schema.String,
  }),

  // First-run setup: what the repository looks like, and a designs directory to start in.
  Rpc.make("setup.detect", {
    error: BadRequest,
    payload: { repoPath: Schema.String },
    success: SetupSuggestions,
  }),
  /** A new application where the repository has none, Figma's tokens its theme when imported. */
  Rpc.make("setup.scaffold", {
    error: Schema.Union([BadRequest, ForbiddenPath]),
    payload: ScaffoldInput,
    success: ScaffoldResult,
  }),
  Rpc.make("setup.createDesigns", {
    error: Schema.Union([BadRequest, ForbiddenPath]),
    payload: CreateDesignsInput,
    success: CreateDesignsResult,
  }),

  Rpc.make("project.info", { success: ProjectInfo }),
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
      canvas: CanvasId,
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
   * The page drawn again in a state (ADR 0030): a copy of it in the file of the state
   * (`orders@empty.page.json`), with its frame beside the page's, the state listed in the
   * canvas's `states`.
   */
  Rpc.make("pages.createState", {
    error: PagesError,
    payload: { id: Schema.String, state: Schema.String },
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
        Schema.Struct({ canvas: CanvasId }),
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
    payload: { id: CanvasId, name: Schema.String },
    success: Canvas,
  }),
  /** A copy of everything the canvas holds, pages, layout and own assets, under a new name. */
  Rpc.make("canvases.duplicate", {
    error: PagesError,
    payload: { id: CanvasId, name: Schema.String },
    success: Canvas,
  }),
  /** The canvas's pages, layout and comments; the last canvas stays. */
  Rpc.make("canvases.delete", {
    error: PagesError,
    payload: { id: CanvasId },
  }),
  /**
   * The URL the canvas's prototype opens on. A page of the canvas must serve it; when that page
   * later serves another URL the canvas follows it, and when it goes another page's URL is taken.
   */
  Rpc.make("canvases.setHome", {
    error: PagesError,
    payload: { id: CanvasId, route: Schema.String },
    success: Canvas,
  }),
  Rpc.make("canvases.reorder", {
    error: PagesError,
    payload: { order: Schema.Array(Schema.String) },
  }),
  Rpc.make("canvas.get", {
    error: PagesError,
    payload: { canvas: CanvasId },
    success: CanvasLayout,
  }),
  /** Saves where the pages' frames sit; the canvas's nodes change through `documents.apply`. */
  Rpc.make("canvas.set", {
    error: PagesError,
    payload: {
      canvas: CanvasId,
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
    payload: { canvas: CanvasId },
    success: Schema.Array(DocumentState),
  }),
  Rpc.make("documents.get", {
    error: PagesError,
    payload: { doc: Schema.String },
    success: DocumentState,
  }),
  /**
   * Operations on one or several documents, as one undo step; answered with what changed in
   * each, as the event says it (ADR 0044).
   */
  Rpc.make("documents.apply", {
    error: EditError,
    payload: ApplyInput,
    success: AppliedChanges,
  }),

  Rpc.make("designSystem.get", {
    error: NotConfigured,
    success: DesignSystemState,
  }),
  /**
   * The design system changed by the editor's operations (ADR 0045), in order, as one undo
   * step; the code follows the values with `codeTokens: auto`. Returns the files written.
   */
  Rpc.make("designSystem.edit", {
    error: Schema.Union([BadRequest, NotConfigured]),
    payload: DesignSystemEditInput,
    success: Schema.Struct({ files: Schema.Array(Schema.String) }),
  }),
  /** Runs the fixed-rule scan and saves what it finds, without an agent. */
  Rpc.make("designSystem.detect", {
    error: EditError,
    success: DesignSystem,
  }),
  /**
   * Puts DESIGN.md at the root of the repository (ADR 0027): the designs directory's moved
   * there, or a first one written from the design system. One undo step.
   */
  Rpc.make("designSystem.placeDocument", {
    error: EditError,
    success: Schema.Struct({ path: Schema.String }),
  }),
  /** One `##` section of DESIGN.md given its text, or added in the format's order; one undo step. */
  Rpc.make("designSystem.setSection", {
    error: EditError,
    payload: { name: Schema.String, text: Schema.String },
  }),

  /** The design-system setup's steps (ADR 0023). */
  Rpc.make("dsSetup.get", { error: NotConfigured, success: DesignSystemSetup }),
  /** What the Inventory step found; null before it has run. */
  Rpc.make("dsSetup.inventory", {
    error: NotConfigured,
    success: Schema.NullOr(UsageInventory),
  }),
  /**
   * Starts a step once the ones before it are done: the inventory runs there and then; a step an
   * agent does gets a thread, returned for the editor to open with the step's task written in
   * its composer.
   */
  Rpc.make("dsSetup.start", {
    error: Schema.Union([SetupError, ThreadError]),
    payload: { ...SetupStepRef, mode: Schema.optional(DefineMode) },
    success: Schema.Struct({
      setup: DesignSystemSetup,
      /** What the step's thread is first asked, for the editor to write in its composer. */
      task: Schema.NullOr(TaskRequest),
      threadId: Schema.NullOr(Schema.String),
    }),
  }),
  /** Stops a step: its thread's turn is cancelled and what it did so far is kept. */
  Rpc.make("dsSetup.stop", {
    error: SetupError,
    payload: SetupStepRef,
    success: DesignSystemSetup,
  }),
  /** Takes a stopped step, or one in review, up again in its thread. */
  Rpc.make("dsSetup.resume", {
    error: SetupError,
    payload: SetupStepRef,
    success: DesignSystemSetup,
  }),
  /** The user goes on past a step. */
  Rpc.make("dsSetup.complete", {
    error: SetupError,
    payload: SetupStepRef,
    success: DesignSystemSetup,
  }),
  /** The code read against the saved design system, by Map and Verify; null before Map. */
  Rpc.make("dsSetup.audit", {
    error: NotConfigured,
    success: Schema.NullOr(UsageInventory),
  }),
  /** What each value off the system becomes; null before Map. */
  Rpc.make("dsSetup.mapping", {
    error: NotConfigured,
    success: Schema.NullOr(UsageMapping),
  }),
  /** The user's decisions on the mapping; what could not be taken says why. */
  Rpc.make("dsSetup.setMapping", {
    error: SetupError,
    payload: { changes: Schema.Array(MappingChange) },
    success: Schema.Struct({
      mapping: UsageMapping,
      problems: Schema.Array(Schema.String),
    }),
  }),
  /** The files reverting a batch of Migrate would put back. */
  Rpc.make("dsSetup.batchPreview", {
    error: SetupError,
    payload: { batchId: Schema.String },
    success: Schema.Array(RestoreEntry),
  }),
  /** Puts back what a batch of Migrate changed, and takes it back to todo. */
  Rpc.make("dsSetup.revertBatch", {
    error: SetupError,
    payload: { batchId: Schema.String },
    success: DesignSystemSetup,
  }),
  /** The files redoing a step would put back, before anything is. */
  Rpc.make("dsSetup.redoPreview", {
    error: SetupError,
    payload: SetupStepRef,
    success: Schema.Array(RestoreEntry),
  }),
  /**
   * Puts back every file this step and the later ones changed, as it was when this step began,
   * and takes them back to todo.
   */
  Rpc.make("dsSetup.redo", {
    error: SetupError,
    payload: SetupStepRef,
    success: DesignSystemSetup,
  }),

  /** The design-system sync's plan for the project as it is now (ADR 0025). */
  Rpc.make("sync.plan", { error: NotConfigured, success: SyncPlan }),
  /**
   * A source's tokens against the design system's: the newest Figma import's, DESIGN.md's front
   * matter (ADR 0027) or the code's (ADR 0028); null when there is no such source to compare.
   */
  Rpc.make("sync.tokens", {
    error: Schema.Union([BadRequest, NotConfigured]),
    payload: { source: TokenSourceKind },
    success: Schema.NullOr(TokenComparison),
  }),
  /** What a source's tokens are in the design system, as the user matched them in Sync. */
  Rpc.make("sync.match", {
    error: Schema.Union([BadRequest, NotConfigured]),
    payload: {
      entries: Schema.Array(TokenMatchInput),
      source: TokenSourceKind,
    },
    success: Schema.Struct({
      problems: Schema.Array(Schema.String),
      saved: Schema.Number,
      unmatched: Schema.Number,
    }),
  }),
  /**
   * What a source changed, and the conflicts given to it, taken into the design system. For the
   * code, what the design system changed, and the conflicts given to it, are written to the
   * code too (the export); `only` keeps to one direction, and `tokens`, when it names any, to
   * those tokens (by name, or `name@theme`).
   */
  Rpc.make("sync.apply", {
    error: Schema.Union([BadRequest, NotConfigured]),
    payload: {
      decisions: Schema.Array(TokenDecision),
      only: Schema.optional(Schema.Literals(["export", "import"])),
      source: TokenSourceKind,
      tokens: Schema.optional(Schema.Array(Schema.String)),
    },
    success: Schema.Struct({
      files: Schema.Array(Schema.String),
      written: Schema.Number,
    }),
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

  /** Thumbnails of the Library drawn earlier, under the key of what they were drawn from. */
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
    payload: { canvas: CanvasId },
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
    payload: { canvas: CanvasId, id: Schema.String },
  }),
  Rpc.make("comments.reply", {
    error: PagesError,
    payload: ReplyInput,
    success: Comment,
  }),
  Rpc.make("comments.deleteReply", {
    error: PagesError,
    payload: {
      canvas: CanvasId,
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

  Rpc.make("agents.list", { success: Schema.Array(AgentConfig) }),
  /** The options each agent's sessions offer, for the agents that have run here before. */
  Rpc.make("agents.options", { success: Schema.Array(AgentOptions) }),
  /** What an agent's sessions offer, starting one to ask when it has not answered this run. */
  Rpc.make("agents.discover", {
    error: ThreadError,
    payload: { agentId: Schema.String },
    success: AgentOptions,
  }),
  /** The user's own profile: the name comments are signed with when git has none. */
  Rpc.make("profile.get", { success: UserProfile }),
  Rpc.make("profile.set", {
    error: BadRequest,
    payload: UserProfile,
    success: UserProfile,
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
      /** `design` when absent (ADR 0030). */
      purpose: Schema.optional(ThreadPurpose),
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
    payload: { id: Schema.String, threadId: FileId },
    success: Schema.NullOr(QueuedPrompt),
  }),
  /** Sends the oldest queued prompt now, after a turn that was stopped or failed. */
  Rpc.make("threads.sendQueued", { error: ThreadError, payload: ThreadRef }),
  Rpc.make("threads.cancel", { error: ThreadError, payload: ThreadRef }),
  Rpc.make("threads.delete", { payload: ThreadRef }),
  /**
   * The user's answers to a question card: back to the agent that waits for them, or as the
   * next prompt.
   */
  Rpc.make("threads.answer", {
    error: ThreadError,
    payload: {
      ...ThreadRef,
      answers: Answers,
      itemId: Schema.String,
    },
  }),
  /** The user will not answer a card the agent waits on; the agent hears that they declined. */
  Rpc.make("threads.decline", {
    error: ThreadError,
    payload: { ...ThreadRef, itemId: Schema.String },
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
  Rpc.make("git.diff", {
    error: GitError,
    payload: { path: Schema.String },
    success: GitDiff,
  }),
  Rpc.make("git.commit", {
    error: GitWriteError,
    payload: GitCommitInput,
    success: GitCommitResult,
  }),
  /** Makes the project's folder a git repository, when writing to git is on and it is none. */
  Rpc.make("git.init", { error: GitWriteError }),
  Rpc.make("checkpoints.list", { success: Schema.Array(Checkpoint) }),
  Rpc.make("checkpoints.diff", {
    error: CheckpointError,
    payload: { id: Schema.String },
    success: Schema.Array(GitDiff),
  }),
  /** The design files put back as the checkpoint kept them: one undo step. */
  Rpc.make("checkpoints.revert", {
    error: EditError,
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

  /**
   * A node of a design as code, everything under it included (the inspector's Code tab): JSX
   * with the repository's components, its look in the classes of the project's style system
   * (ADR 0024). `parent` is how its parent lays it out; `component` names a page's function.
   * An instance's children are laid out as the catalogue's slots say (ADR 0042).
   */
  Rpc.make("code.write", {
    error: NotConfigured,
    payload: {
      component: Schema.optional(Schema.String),
      node: DesignNode,
      parent: Schema.optional(
        Schema.Literals(["row", "column", "block", "free"])
      ),
    },
    success: Schema.Struct({ code: Schema.String, language: Schema.String }),
  }),

  /** The components of the designs directory (ADR 0041), each read or with its problem. */
  Rpc.make("components.list", { error: NotConfigured, success: ComponentList }),
  /**
   * A change to an app component's properties or slots (ADR 0042), or to a system component's
   * look or one part's style in it (ADR 0045), made on its file as it is now; a rename follows
   * into its variants and its instances' props. One undo step.
   */
  Rpc.make("components.change", {
    error: EditError,
    payload: { change: ComponentChange, name: Schema.String },
    success: ComponentEntry,
  }),
  /**
   * A system component's look taken over (ADRs 0040, 0041): its file started from its default
   * look, keeping the behaviour notes one there was had.
   */
  Rpc.make("components.fromDefault", {
    error: EditError,
    payload: { name: Schema.String },
    success: ComponentEntry,
  }),
  /** A component's file removed: a system component is drawn in its default look again. */
  Rpc.make("components.remove", {
    error: EditError,
    payload: { name: Schema.String },
  }),
  /**
   * Nodes of a page made an app component (ADR 0041): they become its tree, and an instance of it
   * takes their place. One undo step.
   */
  Rpc.make("components.makeApp", {
    error: EditError,
    payload: {
      id: Schema.String,
      name: Schema.String,
      nodeIds: Schema.Array(Schema.String).check(Schema.isMinLength(1)),
    },
    success: ComponentEntry,
  }),

  /**
   * A new app component, its tree an empty column, placed nowhere yet (ADR 0045): the Library's
   * + New. One undo step.
   */
  Rpc.make("components.create", {
    error: EditError,
    payload: { name: Schema.String },
    success: ComponentEntry,
  }),

  /** Every page and component, with whether it is ready, implemented, or changed since (ADR 0030). */
  Rpc.make("implementation.list", {
    error: NotConfigured,
    success: ImplementationList,
  }),
  Rpc.make("implementation.setReady", {
    error: EditError,
    payload: { ready: Schema.Boolean, target: ImplementationTarget },
    success: ImplementationItem,
  }),
  /** Several designs marked ready, or not, in one undo step; one implemented already is left. */
  Rpc.make("implementation.setReadyAll", {
    error: EditError,
    payload: {
      ready: Schema.Boolean,
      targets: Schema.Array(ImplementationTarget),
    },
    success: Schema.Struct({ changed: Schema.Number }),
  }),
  /** The design marked implemented by these files, as it is now: one undo step. */
  Rpc.make("implementation.mark", {
    error: EditError,
    payload: {
      files: Schema.Array(Schema.String),
      target: ImplementationTarget,
    },
    success: ImplementationItem,
  }),
  /** The binding taken off: the design is a draft again. */
  Rpc.make("implementation.unbind", {
    error: EditError,
    payload: { target: ImplementationTarget },
  }),
  /** What changed in the design since it was implemented. */
  Rpc.make("implementation.changes", {
    error: EditError,
    payload: { target: ImplementationTarget },
    success: ImplementationChanges,
  }),
] as const;

/** Everything the server pushes. Each is a stream that stays open for the life of the socket. */
export const eventSchemas = {
  agent: AgentEvent,
  "agent.edited": AgentEdited,
  "agent.focus": AgentFocus,
  "agent.terminal": AgentTerminalOutput,
  canvas: Schema.Struct({ canvas: Schema.String, layout: CanvasLayout }),
  /** The open repository's agent turn checkpoints, newest first: one taken, or let go of. */
  checkpoints: Schema.Array(Checkpoint),
  comments: Schema.Struct({ canvas: Schema.String, list: CommentList }),
  /** A component's file changed (ADR 0041). */
  components: ComponentList,
  designSystem: DesignSystemState,
  /**
   * A document changed: an edit, an undo, an agent, a branch switch. What changed when it can be
   * said, else the whole document (ADR 0044).
   */
  document: DocumentChange,
  /** A step of the design-system setup changed. */
  dsSetup: DesignSystemSetup,
  /** The mapping changed: the rules, the agent, the user, or a redo that dropped it. */
  dsSetupMapping: Schema.NullOr(UsageMapping),
  "edit.state": UndoState,
  "file.changed": Schema.Struct({ file: Schema.String, hash: Schema.String }),
  git: GitStatus,
  /** A binding, a design or a bound file changed (ADR 0030). */
  implementation: ImplementationList,
  log: LogLine,
  pages: PageList,
  project: ProjectInfo,
  /** An agent wants a picture of a node: an editor that can draw it answers with `screenshots.deliver`. */
  screenshot: ScreenshotRequest,
  /** A skill file changed, or the settings turned one on or off. */
  skills: SkillList,
  /** The open repository's named snapshots, newest first: one saved, or deleted. */
  snapshots: Schema.Array(Snapshot),
  /** The sync's plan, worked out again because something it reads changed. */
  syncPlan: SyncPlan,
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
  Rpc.make("events.checkpoints", {
    stream: true,
    success: eventSchemas.checkpoints,
  }),
  Rpc.make("events.document", { stream: true, success: eventSchemas.document }),
  Rpc.make("events.designSystem", {
    stream: true,
    success: eventSchemas.designSystem,
  }),
  Rpc.make("events.dsSetup", {
    stream: true,
    success: eventSchemas.dsSetup,
  }),
  Rpc.make("events.dsSetupMapping", {
    stream: true,
    success: eventSchemas.dsSetupMapping,
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
  Rpc.make("events.snapshots", {
    stream: true,
    success: eventSchemas.snapshots,
  }),
  Rpc.make("events.syncPlan", {
    stream: true,
    success: eventSchemas.syncPlan,
  }),
  Rpc.make("events.components", {
    stream: true,
    success: eventSchemas.components,
  }),
  Rpc.make("events.implementation", {
    stream: true,
    success: eventSchemas.implementation,
  }),
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
