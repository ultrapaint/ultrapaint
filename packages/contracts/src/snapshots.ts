import { Schema } from "effect";
import { DesignNode, DocumentState } from "./document.ts";
import { Canvas, CanvasLayout, Page } from "./pages.ts";

/**
 * What made a point of the designs' history (ADR 0087):
 * - `start`: where the history begins, the designs as they were when it was first kept;
 * - `edits`: the person's own edits, closed two minutes after the last one, every ten minutes
 *   while they go on, and before anything else writes;
 * - `turn`: an agent's turn, from its prompt to its end;
 * - `outside`: the designs' files changed by something else (a pull, a checkout, a text editor,
 *   the files as they were found when the server started);
 * - `restore`: the designs put back as another point kept them;
 * - `imported`: a named snapshot or an agent's checkpoint kept before the history was.
 */
export const PointKind = Schema.Literals([
  "start",
  "edits",
  "turn",
  "outside",
  "restore",
  "imported",
]);
export type PointKind = typeof PointKind.Type;

/**
 * A point of the designs' history: the text of every design file as it was right after it, kept
 * in the snapshot store. Nothing of the history is ever let go of; a point the person names is a
 * version (ADR 0087).
 */
export const HistoryPoint = Schema.Struct({
  /** A turn: the agent that made it. */
  agentId: Schema.optional(Schema.String),
  /** When it closed. */
  at: Schema.Number,
  /** The canvases whose pages it changed, by id ("" for the designs directory's own). */
  canvases: Schema.Array(Schema.String),
  /** The person's edits: how many. */
  edits: Schema.optional(Schema.Number),
  /** The design files it changed from the point before it, repository-relative. */
  files: Schema.Array(Schema.String),
  /** The person's edits: when the first was made. */
  from: Schema.optional(Schema.Number),
  id: Schema.String,
  kind: PointKind,
  /** A turn: its prompt; a restore: the words of the point restored; imported: what it was. */
  label: Schema.optional(Schema.String),
  /** A turn: the model, as the thread named it when the turn began. */
  model: Schema.optional(Schema.String),
  /** A version: the name the person gave it. */
  name: Schema.optional(Schema.String),
  /** A turn: its thread. */
  threadId: Schema.optional(Schema.String),
});
export type HistoryPoint = typeof HistoryPoint.Type;

/** The person's edits since the last point, not closed into one yet. */
export const PendingEdits = Schema.Struct({
  edits: Schema.Number,
  since: Schema.Number,
});
export type PendingEdits = typeof PendingEdits.Type;

/** The open project's history: its points, newest first, and the edits not in one yet. */
export const History = Schema.Struct({
  pending: Schema.NullOr(PendingEdits),
  points: Schema.Array(HistoryPoint),
});
export type History = typeof History.Type;

/** A page a point changed, as it was before the point and after it (null: not there). */
export const PageChange = Schema.Struct({
  after: Schema.NullOr(DesignNode),
  before: Schema.NullOr(DesignNode),
  /** Repository-relative. */
  file: Schema.String,
});
export type PageChange = typeof PageChange.Type;

/** A git diff of one file: the git tab's view of a file's change. */
export const FileDiff = Schema.Struct({
  diff: Schema.String,
  path: Schema.String,
});
export type FileDiff = typeof FileDiff.Type;

/** A point opened to look at: the canvases, pages and documents as they were then. */
export const PointView = Schema.Struct({
  canvases: Schema.Array(Canvas),
  documents: Schema.Array(DocumentState),
  /** Each canvas's layout, by canvas id. */
  layouts: Schema.Record(Schema.String, CanvasLayout),
  pages: Schema.Array(Page),
  point: HistoryPoint,
});
export type PointView = typeof PointView.Type;
