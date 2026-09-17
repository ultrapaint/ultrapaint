import { Schema as S } from "effect";
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

const { Void } = S;

/** Every request the editor can make, with its input and output schema. */
export const requests = {
  "agents.list": { input: Void, output: S.Array(AgentConfig) },

  "canvas.get": { input: S.Struct({ flow: S.String }), output: CanvasLayout },
  "canvas.set": {
    input: S.Struct({ flow: S.String, layout: CanvasLayout }),
    output: Void,
  },

  "catalogue.get": {
    input: S.Struct({ refresh: S.Boolean }),
    output: Catalogue,
  },
  "catalogue.storyUrl": {
    input: S.Struct({ storyId: S.String }),
    output: S.NullOr(S.String),
  },
  "checkpoints.diff": {
    input: S.Struct({ id: S.String }),
    output: S.Array(GitDiff),
  },
  "checkpoints.list": { input: Void, output: S.Array(Checkpoint) },
  "checkpoints.revert": { input: S.Struct({ id: S.String }), output: Void },

  "edit.apply": { input: EditRequest, output: EditResult },
  "edit.redo": { input: Void, output: S.NullOr(EditResult) },
  "edit.state": { input: Void, output: UndoState },
  "edit.undo": { input: Void, output: S.NullOr(EditResult) },
  "git.commit": { input: GitCommitInput, output: GitCommitResult },
  "git.diff": { input: S.Struct({ path: S.String }), output: GitDiff },

  "git.status": { input: Void, output: GitStatus },
  health: {
    input: Void,
    output: S.Struct({ ok: S.Boolean, version: S.String }),
  },
  "host.start": { input: Void, output: HostStatus },
  "host.stop": { input: Void, output: HostStatus },
  "logs.recent": { input: Void, output: S.Array(LogLine) },

  "project.info": { input: Void, output: ProjectInfo },
  "screens.create": {
    input: S.Struct({
      flow: S.String,
      name: S.String,
      template: S.optional(S.String),
    }),
    output: Screen,
  },
  "screens.delete": { input: S.Struct({ id: S.String }), output: Void },
  "screens.duplicate": { input: S.Struct({ id: S.String }), output: Screen },

  "screens.list": { input: Void, output: ScreenList },
  "screens.rename": {
    input: S.Struct({ id: S.String, name: S.String }),
    output: Screen,
  },
  "screens.templates": {
    input: Void,
    output: S.Array(S.Struct({ id: S.String, name: S.String })),
  },

  "settings.get": { input: Void, output: S.NullOr(Settings) },
  "settings.set": { input: Settings, output: SettingsValidation },
  "settings.validate": { input: Settings, output: SettingsValidation },

  "source.element": { input: SourceLocation, output: S.NullOr(ElementSource) },
  "source.read": {
    input: S.Struct({ file: S.String }),
    output: S.Struct({ content: S.String, hash: S.String }),
  },
  "threads.cancel": { input: S.Struct({ threadId: S.String }), output: Void },
  "threads.create": {
    input: S.Struct({ agentId: S.String, title: S.optional(S.String) }),
    output: Thread,
  },
  "threads.delete": { input: S.Struct({ threadId: S.String }), output: Void },
  "threads.items": {
    input: S.Struct({ threadId: S.String }),
    output: S.Array(ThreadItem),
  },
  "threads.list": { input: Void, output: S.Array(Thread) },
  "threads.permission": {
    input: S.Struct({
      optionId: S.String,
      remember: S.Boolean,
      requestId: S.String,
      threadId: S.String,
    }),
    output: Void,
  },
  "threads.prompt": { input: PromptInput, output: Void },
  "threads.setConfigOption": {
    input: S.Struct({
      optionId: S.String,
      threadId: S.String,
      value: S.String,
    }),
    output: Void,
  },
  "threads.setMode": {
    input: S.Struct({ modeId: S.String, threadId: S.String }),
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
  canvas: S.Struct({ flow: S.String, layout: CanvasLayout }),
  "edit.state": UndoState,
  "file.changed": S.Struct({ file: S.String, hash: S.String }),
  git: GitStatus,
  log: LogLine,
  project: ProjectInfo,
  screens: ScreenList,
} as const;

export type Events = typeof events;
export type EventName = keyof Events;
export type EventPayload<E extends EventName> = Events[E]["Type"];

export const ClientFrame = S.Struct({
  id: S.Number,
  input: S.Unknown,
  method: S.String,
});
export type ClientFrame = typeof ClientFrame.Type;

export const ErrorCode = S.Literal(
  "bad_request",
  "not_found",
  "not_configured",
  "forbidden_path",
  "stale",
  "conflict",
  "host_error",
  "agent_error",
  "internal"
);
export type ErrorCode = typeof ErrorCode.Type;

export const WireError = S.Struct({ code: ErrorCode, message: S.String });
export type WireError = typeof WireError.Type;

export const ServerFrame = S.Union(
  S.Struct({ id: S.Number, ok: S.Literal(true), output: S.Unknown }),
  S.Struct({ error: WireError, id: S.Number, ok: S.Literal(false) }),
  S.Struct({ event: S.String, payload: S.Unknown })
);
export type ServerFrame = typeof ServerFrame.Type;

export const decodeClientFrame = S.decodeUnknownEither(ClientFrame);
export const decodeServerFrame = S.decodeUnknownEither(ServerFrame);
