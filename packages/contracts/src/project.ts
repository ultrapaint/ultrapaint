import * as S from "effect/Schema";

export const HostStatus = S.Struct({
  state: S.Literal("stopped", "starting", "running", "error"),
  port: S.optional(S.Number),
  url: S.optional(S.String),
  pid: S.optional(S.Number),
  error: S.optional(S.String),
});
export type HostStatus = typeof HostStatus.Type;

export const ProjectInfo = S.Struct({
  configured: S.Boolean,
  name: S.optional(S.String),
  repoPath: S.optional(S.String),
  branch: S.optional(S.String),
  designsDir: S.optional(S.String),
  host: HostStatus,
});
export type ProjectInfo = typeof ProjectInfo.Type;

export const LogLine = S.Struct({
  source: S.Literal("host", "server", "agent"),
  level: S.Literal("info", "warn", "error"),
  text: S.String,
  at: S.Number,
});
export type LogLine = typeof LogLine.Type;
