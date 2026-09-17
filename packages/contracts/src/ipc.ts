import { Schema } from "effect";
import { SourceLocation } from "./base.ts";
import { Catalogue } from "./catalogue.ts";
import { EditRequest, EditResult, ElementSource, UndoState } from "./edit.ts";
import {
  Checkpoint,
  GitCommitInput,
  GitCommitResult,
  GitDiff,
  GitStatus,
} from "./git.ts";
import { HostStatus, LogLine, ProjectInfo } from "./project.ts";
import { CanvasLayout, Screen, ScreenList } from "./screens.ts";
import { Settings, SettingsValidation } from "./settings.ts";
import {
  AgentConfig,
  AgentEvent,
  PromptInput,
  Thread,
  ThreadItem,
} from "./threads.ts";

const { Void } = Schema;

/** Every request the editor can make, with its input and output schema. */
export const requests = {
  "agents.list": { input: Void, output: Schema.Array(AgentConfig) },

  "canvas.get": {
    input: Schema.Struct({ flow: Schema.String }),
    output: CanvasLayout,
  },
  "canvas.set": {
    input: Schema.Struct({ flow: Schema.String, layout: CanvasLayout }),
    output: Void,
  },

  "catalogue.get": {
    input: Schema.Struct({ refresh: Schema.Boolean }),
    output: Catalogue,
  },
  "catalogue.storyUrl": {
    input: Schema.Struct({ storyId: Schema.String }),
    output: Schema.NullOr(Schema.String),
  },
  "checkpoints.diff": {
    input: Schema.Struct({ id: Schema.String }),
    output: Schema.Array(GitDiff),
  },
  "checkpoints.list": { input: Void, output: Schema.Array(Checkpoint) },
  "checkpoints.revert": {
    input: Schema.Struct({ id: Schema.String }),
    output: Void,
  },

  "edit.apply": { input: EditRequest, output: EditResult },
  "edit.redo": { input: Void, output: Schema.NullOr(EditResult) },
  "edit.state": { input: Void, output: UndoState },
  "edit.undo": { input: Void, output: Schema.NullOr(EditResult) },
  "git.commit": { input: GitCommitInput, output: GitCommitResult },
  "git.diff": {
    input: Schema.Struct({ path: Schema.String }),
    output: GitDiff,
  },

  "git.status": { input: Void, output: GitStatus },
  health: {
    input: Void,
    output: Schema.Struct({ ok: Schema.Boolean, version: Schema.String }),
  },
  "host.start": { input: Void, output: HostStatus },
  "host.stop": { input: Void, output: HostStatus },
  "logs.recent": { input: Void, output: Schema.Array(LogLine) },

  "project.info": { input: Void, output: ProjectInfo },
  "screens.create": {
    input: Schema.Struct({
      flow: Schema.String,
      name: Schema.String,
      template: Schema.optional(Schema.String),
    }),
    output: Screen,
  },
  "screens.delete": {
    input: Schema.Struct({ id: Schema.String }),
    output: Void,
  },
  "screens.duplicate": {
    input: Schema.Struct({ id: Schema.String }),
    output: Screen,
  },

  "screens.list": { input: Void, output: ScreenList },
  "screens.rename": {
    input: Schema.Struct({ id: Schema.String, name: Schema.String }),
    output: Screen,
  },
  "screens.templates": {
    input: Void,
    output: Schema.Array(
      Schema.Struct({ id: Schema.String, name: Schema.String })
    ),
  },

  "settings.get": { input: Void, output: Schema.NullOr(Settings) },
  "settings.set": { input: Settings, output: SettingsValidation },
  "settings.validate": { input: Settings, output: SettingsValidation },

  "source.element": {
    input: SourceLocation,
    output: Schema.NullOr(ElementSource),
  },
  "source.read": {
    input: Schema.Struct({ file: Schema.String }),
    output: Schema.Struct({ content: Schema.String, hash: Schema.String }),
  },
  "threads.cancel": {
    input: Schema.Struct({ threadId: Schema.String }),
    output: Void,
  },
  "threads.create": {
    input: Schema.Struct({
      agentId: Schema.String,
      title: Schema.optional(Schema.String),
    }),
    output: Thread,
  },
  "threads.delete": {
    input: Schema.Struct({ threadId: Schema.String }),
    output: Void,
  },
  "threads.items": {
    input: Schema.Struct({ threadId: Schema.String }),
    output: Schema.Array(ThreadItem),
  },
  "threads.list": { input: Void, output: Schema.Array(Thread) },
  "threads.permission": {
    input: Schema.Struct({
      optionId: Schema.String,
      remember: Schema.Boolean,
      requestId: Schema.String,
      threadId: Schema.String,
    }),
    output: Void,
  },
  "threads.prompt": { input: PromptInput, output: Void },
  "threads.setConfigOption": {
    input: Schema.Struct({
      optionId: Schema.String,
      threadId: Schema.String,
      value: Schema.String,
    }),
    output: Void,
  },
  "threads.setMode": {
    input: Schema.Struct({ modeId: Schema.String, threadId: Schema.String }),
    output: Void,
  },
} as const;

export type Requests = typeof requests;
export type RequestName = keyof Requests;
export type RequestInput<M extends RequestName> = Requests[M]["input"]["Type"];
export type RequestOutput<M extends RequestName> =
  Requests[M]["output"]["Type"];

/** Every event the server pushes to subscribed clients. */
export const events = {
  agent: AgentEvent,
  canvas: Schema.Struct({ flow: Schema.String, layout: CanvasLayout }),
  "edit.state": UndoState,
  "file.changed": Schema.Struct({ file: Schema.String, hash: Schema.String }),
  git: GitStatus,
  log: LogLine,
  project: ProjectInfo,
  screens: ScreenList,
} as const;

export type Events = typeof events;
export type EventName = keyof Events;
export type EventPayload<E extends EventName> = Events[E]["Type"];

export const ClientFrame = Schema.Struct({
  id: Schema.Number,
  input: Schema.optional(Schema.Unknown),
  method: Schema.String,
});
export type ClientFrame = typeof ClientFrame.Type;

export const ErrorCode = Schema.Literals([
  "bad_request",
  "not_found",
  "not_configured",
  "forbidden_path",
  "stale",
  "conflict",
  "host_error",
  "agent_error",
  "internal",
]);
export type ErrorCode = typeof ErrorCode.Type;

export const WireError = Schema.Struct({
  code: ErrorCode,
  message: Schema.String,
});
export type WireError = typeof WireError.Type;

export const ServerFrame = Schema.Union([
  Schema.Struct({
    id: Schema.Number,
    ok: Schema.Literal(true),
    output: Schema.optional(Schema.Unknown),
  }),
  Schema.Struct({
    error: WireError,
    id: Schema.Number,
    ok: Schema.Literal(false),
  }),
  Schema.Struct({
    event: Schema.String,
    payload: Schema.optional(Schema.Unknown),
  }),
]);
export type ServerFrame = typeof ServerFrame.Type;

export const decodeClientFrame = Schema.decodeUnknownResult(ClientFrame);
export const decodeServerFrame = Schema.decodeUnknownResult(ServerFrame);
