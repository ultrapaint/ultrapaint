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
