/**
 * A reference: a screen someone made well, that the agents are asked to make again from its
 * content alone. `reference.json` says where it is and why it is worth learning from; `capture/`
 * holds its pictures and its text, and `brief.md` what the agent is told.
 *
 * A reference without a URL (a prototype, a logged-in dashboard, a shot from a gallery) is
 * captured by hand: its pictures go in `capture/` under the names `capture` would give them.
 */

import path from "node:path";
import { Effect, Schema } from "effect";
import { listDir, REFERENCES, readJson, referenceDir } from "./layout.ts";

export const Viewport = Schema.Struct({
  /** The window's height: what is seen before scrolling. */
  height: Schema.Number,
  name: Schema.String,
  width: Schema.Number,
});
export type Viewport = typeof Viewport.Type;

/** Where every reference and every generated page is looked at. */
export const VIEWPORTS: readonly Viewport[] = [
  { height: 900, name: "desktop", width: 1440 },
  { height: 844, name: "mobile", width: 390 },
];

export const Reference = Schema.Struct({
  /** Selectors removed before the pictures are taken: cookie banners, chat bubbles. */
  hide: Schema.optional(Schema.Array(Schema.String)),
  /** landing, dashboard, app, settings, form…: what kind of screen it is, for the report. */
  kind: Schema.String,
  name: Schema.String,
  /** Absent for a reference captured by hand. */
  url: Schema.optional(Schema.String),
  /** Milliseconds to wait after loading, for what arrives late. */
  waitMs: Schema.optional(Schema.Number),
  /** What makes it good: what the judge should look at first. */
  why: Schema.String,
});
export type Reference = typeof Reference.Type;

export interface LoadedReference extends Reference {
  readonly id: string;
}

export const loadReference = Effect.fn("loadReference")(function* (id: string) {
  const reference = yield* readJson(
    Reference,
    path.join(referenceDir(id), "reference.json")
  );
  return { ...reference, id } satisfies LoadedReference;
});

/** The references asked for, or every one there is. */
export const loadReferences = Effect.fn("loadReferences")(function* (
  ids: readonly string[]
) {
  const all = ids.length > 0 ? ids : yield* listDir(REFERENCES);
  return yield* Effect.forEach(all, loadReference);
});
