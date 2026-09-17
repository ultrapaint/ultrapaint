import { Schema as S } from "effect";

export const HostStatus = S.Struct({
  error: S.optional(S.String),
  pid: S.optional(S.Number),
  port: S.optional(S.Number),
  state: S.Literal("stopped", "starting", "running", "error"),
  url: S.optional(S.String),
});
export type HostStatus = typeof HostStatus.Type;

export const ProjectInfo = S.Struct({
  branch: S.optional(S.String),
  configured: S.Boolean,
  designsDir: S.optional(S.String),
  host: HostStatus,
  name: S.optional(S.String),
  repoPath: S.optional(S.String),
});
export type ProjectInfo = typeof ProjectInfo.Type;

export const LogLine = S.Struct({
  at: S.Number,
  level: S.Literal("info", "warn", "error"),
  source: S.Literal("host", "server", "agent"),
  text: S.String,
});
export type LogLine = typeof LogLine.Type;
