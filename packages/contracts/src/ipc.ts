import * as S from "effect/Schema";
import { SourceLocation } from "./base.ts";
import { Catalogue } from "./catalogue.ts";
import { EditRequest, EditResult, ElementSource, UndoState } from "./edit.ts";
import { Checkpoint, GitCommitInput, GitCommitResult, GitDiff, GitStatus } from "./git.ts";
import { HostStatus, LogLine, ProjectInfo } from "./project.ts";
import { CanvasLayout, Screen, ScreenList } from "./screens.ts";
import { Settings, SettingsValidation } from "./settings.ts";
import { AgentConfig, AgentEvent, PromptInput, Thread, ThreadItem } from "./threads.ts";

const Void = S.Void;

/** Every request the editor can make, with its input and output schema. */
export const requests = {
  health: { input: Void, output: S.Struct({ ok: S.Boolean, version: S.String }) },

  "settings.get": { input: Void, output: S.NullOr(Settings) },
  "settings.validate": { input: Settings, output: SettingsValidation },
  "settings.set": { input: Settings, output: SettingsValidation },

  "project.info": { input: Void, output: ProjectInfo },
  "host.start": { input: Void, output: HostStatus },
  "host.stop": { input: Void, output: HostStatus },
  "logs.recent": { input: Void, output: S.Array(LogLine) },

  "screens.list": { input: Void, output: ScreenList },
  "screens.create": {
    input: S.Struct({ flow: S.String, name: S.String, template: S.optional(S.String) }),
    output: Screen,
  },
  "screens.rename": { input: S.Struct({ id: S.String, name: S.String }), output: Screen },
  "screens.duplicate": { input: S.Struct({ id: S.String }), output: Screen },
  "screens.delete": { input: S.Struct({ id: S.String }), output: Void },
  "screens.templates": { input: Void, output: S.Array(S.Struct({ id: S.String, name: S.String })) },

  "canvas.get": { input: S.Struct({ flow: S.String }), output: CanvasLayout },
  "canvas.set": { input: S.Struct({ flow: S.String, layout: CanvasLayout }), output: Void },

  "source.element": { input: SourceLocation, output: S.NullOr(ElementSource) },
  "source.read": {
    input: S.Struct({ file: S.String }),
    output: S.Struct({ content: S.String, hash: S.String }),
  },

  "edit.apply": { input: EditRequest, output: EditResult },
  "edit.undo": { input: Void, output: S.NullOr(EditResult) },
  "edit.redo": { input: Void, output: S.NullOr(EditResult) },
  "edit.state": { input: Void, output: UndoState },

  "catalogue.get": { input: S.Struct({ refresh: S.Boolean }), output: Catalogue },
  "catalogue.storyUrl": {
    input: S.Struct({ storyId: S.String }),
    output: S.NullOr(S.String),
  },

  "agents.list": { input: Void, output: S.Array(AgentConfig) },
  "threads.list": { input: Void, output: S.Array(Thread) },
  "threads.create": {
    input: S.Struct({ agentId: S.String, title: S.optional(S.String) }),
    output: Thread,
  },
  "threads.items": { input: S.Struct({ threadId: S.String }), output: S.Array(ThreadItem) },
  "threads.prompt": { input: PromptInput, output: Void },
  "threads.cancel": { input: S.Struct({ threadId: S.String }), output: Void },
  "threads.delete": { input: S.Struct({ threadId: S.String }), output: Void },
  "threads.permission": {
    input: S.Struct({
      threadId: S.String,
      requestId: S.String,
      optionId: S.String,
      remember: S.Boolean,
    }),
    output: Void,
  },
  "threads.setMode": { input: S.Struct({ threadId: S.String, modeId: S.String }), output: Void },
  "threads.setConfigOption": {
    input: S.Struct({ threadId: S.String, optionId: S.String, value: S.String }),
    output: Void,
  },

  "git.status": { input: Void, output: GitStatus },
  "git.diff": { input: S.Struct({ path: S.String }), output: GitDiff },
  "git.commit": { input: GitCommitInput, output: GitCommitResult },
  "checkpoints.list": { input: Void, output: S.Array(Checkpoint) },
  "checkpoints.diff": { input: S.Struct({ id: S.String }), output: S.Array(GitDiff) },
  "checkpoints.revert": { input: S.Struct({ id: S.String }), output: Void },
} as const;

export type Requests = typeof requests;
export type RequestName = keyof Requests;
export type RequestInput<M extends RequestName> = Requests[M]["input"]["Type"];
export type RequestOutput<M extends RequestName> = Requests[M]["output"]["Type"];

/** Every event the server pushes to subscribed clients. */
export const events = {
  project: ProjectInfo,
  screens: ScreenList,
  "file.changed": S.Struct({ file: S.String, hash: S.String }),
  canvas: S.Struct({ flow: S.String, layout: CanvasLayout }),
  log: LogLine,
  agent: AgentEvent,
  "edit.state": UndoState,
  git: GitStatus,
} as const;

export type Events = typeof events;
export type EventName = keyof Events;
export type EventPayload<E extends EventName> = Events[E]["Type"];

export const ClientFrame = S.Struct({
  id: S.Number,
  method: S.String,
  input: S.Unknown,
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
  "internal",
);
export type ErrorCode = typeof ErrorCode.Type;

export const WireError = S.Struct({ code: ErrorCode, message: S.String });
export type WireError = typeof WireError.Type;

export const ServerFrame = S.Union(
  S.Struct({ id: S.Number, ok: S.Literal(true), output: S.Unknown }),
  S.Struct({ id: S.Number, ok: S.Literal(false), error: WireError }),
  S.Struct({ event: S.String, payload: S.Unknown }),
);
export type ServerFrame = typeof ServerFrame.Type;

export const decodeClientFrame = S.decodeUnknownEither(ClientFrame);
export const decodeServerFrame = S.decodeUnknownEither(ServerFrame);
