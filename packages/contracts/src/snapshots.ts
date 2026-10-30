import { Schema } from "effect";
import { DocumentState } from "./document.ts";
import { Canvas, CanvasLayout, Page } from "./pages.ts";

/**
 * A named point in the history of the designs: "the version shown to the client". It keeps the
 * text of every design file as it was, the way an agent turn's checkpoint does, but it is named,
 * kept until it is deleted, and can be opened to look at as it was (ADR 0019).
 */
export const Snapshot = Schema.Struct({
  at: Schema.Number,
  /** How many design files it keeps. */
  files: Schema.Number,
  id: Schema.String,
  name: Schema.String,
});
export type Snapshot = typeof Snapshot.Type;

/**
 * The designs before an agent's turn, kept so that the turn can be taken back (ADR 0008): the
 * thread's, what it was asked, and the design files it keeps.
 */
export const Checkpoint = Schema.Struct({
  at: Schema.Number,
  files: Schema.Array(Schema.String),
  id: Schema.String,
  label: Schema.String,
  threadId: Schema.String,
});
export type Checkpoint = typeof Checkpoint.Type;

/**
 * A file's change as a unified diff: a snapshot's or a checkpoint's file compared with now, or
 * git's diff of a file.
 */
export const FileDiff = Schema.Struct({
  diff: Schema.String,
  path: Schema.String,
});
export type FileDiff = typeof FileDiff.Type;

/** A snapshot opened to look at: the canvases, pages and documents as they were then. */
export const SnapshotView = Schema.Struct({
  canvases: Schema.Array(Canvas),
  documents: Schema.Array(DocumentState),
  /** Each canvas's layout, by canvas id. */
  layouts: Schema.Record(Schema.String, CanvasLayout),
  pages: Schema.Array(Page),
  snapshot: Snapshot,
});
export type SnapshotView = typeof SnapshotView.Type;
