/**
 * A reference: a screen someone made well, that the agents are asked to make again from its
 * content alone. `reference.json` says where it is and why it is worth learning from; `capture/`
 * holds its pictures and its text, and `brief.md` what the agent is told.
 *
 * A reference is a site (`url`), a picture (`image`: a shot from a gallery such as Dribbble), or
 * neither (a prototype, a logged-in dashboard), captured by hand: its pictures go in `capture/`
 * under the names `capture` would give them.
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

export const ViewportName = Schema.Literals(["desktop", "mobile"]);
export type ViewportName = typeof ViewportName.Type;

export const Reference = Schema.Struct({
  /**
   * The product, or design system, the screen belongs to: references of one family share one
   * extracted design system and one library to compose with.
   */
  family: Schema.optional(Schema.String),
  /** Selectors removed before the pictures are taken: cookie banners, chat bubbles. */
  hide: Schema.optional(Schema.Array(Schema.String)),
  /** The picture the reference is, for a shot: downloaded by `capture`, as the desktop fold. */
  image: Schema.optional(Schema.String),
  /** landing, dashboard, app, settings, form…: what kind of screen it is, for the report. */
  kind: Schema.String,
  name: Schema.String,
  /** Where it was found: the shot's page, for a person to look at. */
  source: Schema.optional(Schema.String),
  /** The site, for a reference `capture` takes from the web. */
  url: Schema.optional(Schema.String),
  /**
   * The viewports it shows, and the agent designs for: both by default. A shot shows one, so a
   * phone design asked for would have nothing to be compared with.
   */
  viewports: Schema.optional(Schema.Array(ViewportName)),
  /** Milliseconds to wait after loading, for what arrives late. */
  waitMs: Schema.optional(Schema.Number),
  /** What makes it good: what the judge should look at first. */
  why: Schema.String,
});
export type Reference = typeof Reference.Type;

export interface LoadedReference extends Reference {
  readonly id: string;
}

/** A reference's family: its own id when it names none. */
export const familyOf = (reference: LoadedReference) =>
  reference.family ?? reference.id;

/** The viewports a reference is designed and judged at. */
export const viewportsOf = (reference: Reference): readonly Viewport[] =>
  VIEWPORTS.filter(
    (v) =>
      reference.viewports === undefined ||
      reference.viewports.some((name) => name === v.name)
  );

/** "a desktop window 1440 wide and a phone 390 wide", for the prompts. */
export const describeViewports = (viewports: readonly Viewport[]) =>
  viewports
    .map((v) =>
      v.name === "mobile"
        ? `a phone ${v.width} wide`
        : `a desktop window ${v.width} wide`
    )
    .join(" and ");

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
