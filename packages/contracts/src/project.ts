import { Schema } from "effect";
import { StorageInfo } from "./settings.ts";

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
  /** Where settings and tool state are kept; drives the "not saved" warning. */
  storage: StorageInfo,
});
export type ProjectInfo = typeof ProjectInfo.Type;

export const LogLine = Schema.Struct({
  at: Schema.Number,
  level: Schema.Literals(["info", "warn", "error"]),
  source: Schema.Literals(["host", "server", "agent"]),
  text: Schema.String,
});
export type LogLine = typeof LogLine.Type;
