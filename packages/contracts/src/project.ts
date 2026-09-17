import { Schema } from "effect";

export const HostStatus = Schema.Struct({
  error: Schema.optional(Schema.String),
  pid: Schema.optional(Schema.Number),
  port: Schema.optional(Schema.Number),
  state: Schema.Literals(["stopped", "starting", "running", "error"]),
  url: Schema.optional(Schema.String),
});
export type HostStatus = typeof HostStatus.Type;

export const ProjectInfo = Schema.Struct({
  branch: Schema.optional(Schema.String),
  configured: Schema.Boolean,
  designsDir: Schema.optional(Schema.String),
  host: HostStatus,
  name: Schema.optional(Schema.String),
  repoPath: Schema.optional(Schema.String),
});
export type ProjectInfo = typeof ProjectInfo.Type;

export const LogLine = Schema.Struct({
  at: Schema.Number,
  level: Schema.Literals(["info", "warn", "error"]),
  source: Schema.Literals(["host", "server", "agent"]),
  text: Schema.String,
});
export type LogLine = typeof LogLine.Type;
