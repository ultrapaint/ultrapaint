/**
 * `gallery`: the shots a person may take references from, on one page, to choose from. Every shot
 * of the sources (`gallery/shots.json`, from Dribbble) is shown with the ones already references
 * marked, one at a time to swipe (right to take, left to skip) or all in a grid; each decision is
 * saved as it is made (`gallery/selection.json`), for references to be made from those taken.
 *
 * The page is `evals/viewers/gallery.html`; the shots and the selection are the data directory's.
 */
import { createServer } from "node:http";
import path from "node:path";
import { NodeHttpServer } from "@effect/platform-node";
import { Effect, FileSystem, Layer, Schema, Semaphore } from "effect";
import {
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
  HttpStaticServer,
} from "effect/http";
import { EvalsConfig } from "./config.ts";
import { readJson, viewerPage, writeJson } from "./layout.ts";
import { loadReferences } from "./reference.ts";

export const GALLERY_SETS = ["shadcn", "shots"] as const;
export type GallerySet = (typeof GALLERY_SETS)[number];

/**
 * The sets a person can swipe: the shots to take references from, or looks to like (shadcn's
 * showcase in random presets), each with its own file of decisions and its own words.
 */
const SETS: Record<
  GallerySet,
  {
    readonly heading: string;
    readonly link: string;
    readonly selection: string;
    readonly shots: string;
    readonly skip: string;
    readonly take: string;
    readonly taken: string;
  }
> = {
  shadcn: {
    heading: "Which looks do you like?",
    link: "open in shadcn",
    selection: "shadcn-selection.json",
    shots: "shadcn.json",
    skip: "Skip",
    take: "Like",
    taken: "Liked",
  },
  shots: {
    heading: "Choose references",
    link: "on Dribbble",
    selection: "selection.json",
    shots: "shots.json",
    skip: "Skip",
    take: "Take",
    taken: "Taken",
  },
};

const Shot = Schema.Struct({
  href: Schema.String,
  image: Schema.String,
  index: Schema.Number,
  source: Schema.String,
  title: Schema.String,
});
const Selection = Schema.Struct({
  /** Shots looked at and left out, by their page. */
  rejected: Schema.optionalKey(Schema.Array(Schema.String)),
  /** Each selected shot, by its page, with a note when one was given. */
  selected: Schema.Array(
    Schema.Struct({ href: Schema.String, note: Schema.optional(Schema.String) })
  ),
});
type Selection = typeof Selection.Type;

/** A shot taken, skipped, or put back among those still to decide. */
const Decision = Schema.Struct({
  decision: Schema.Literals(["take", "skip", "undecided"]),
  href: Schema.String,
  note: Schema.optional(Schema.String),
});

export const gallery = Effect.fn("gallery")(function* (options: {
  readonly host: string;
  readonly port: number;
  readonly set: GallerySet;
}) {
  const { data } = yield* EvalsConfig;
  const fs = yield* FileSystem.FileSystem;
  const set = SETS[options.set];
  const SHOTS = path.join(data.gallery, set.shots);
  const SELECTION = path.join(data.gallery, set.selection);
  const shots = yield* readJson(Schema.Array(Shot), SHOTS);
  const page = yield* viewerPage("gallery");
  // Shots already references are marked; looks to like have none.
  const used =
    options.set === "shots"
      ? (yield* loadReferences([])).flatMap((r) => (r.source ? [r.source] : []))
      : [];
  const lock = yield* Semaphore.make(1);
  const current = Effect.gen(function* () {
    return (yield* fs.exists(SELECTION))
      ? yield* readJson(Selection, SELECTION)
      : ({ selected: [] } satisfies Selection);
  });

  const session = Effect.map(current, (selection) =>
    HttpServerResponse.jsonUnsafe({
      selection,
      shots,
      used,
      words: {
        heading: set.heading,
        link: set.link,
        skip: set.skip,
        take: set.take,
        taken: set.taken,
      },
    })
  );
  const toggle = Effect.gen(function* () {
    const input = yield* HttpServerRequest.schemaBodyJson(Decision);
    if (!shots.some((s) => s.href === input.href)) {
      return HttpServerResponse.jsonUnsafe(
        { message: `no shot ${input.href}` },
        { status: 404 }
      );
    }
    yield* lock.withPermits(1)(
      Effect.gen(function* () {
        const was = yield* current;
        const selected = was.selected.filter((s) => s.href !== input.href);
        const rejected = (was.rejected ?? []).filter((h) => h !== input.href);
        yield* writeJson(SELECTION, {
          rejected:
            input.decision === "skip" ? [...rejected, input.href] : rejected,
          selected:
            input.decision === "take"
              ? [
                  ...selected,
                  {
                    href: input.href,
                    ...(input.note?.trim() && { note: input.note.trim() }),
                  },
                ]
              : selected,
        });
      })
    );
    return HttpServerResponse.jsonUnsafe({ ok: true });
  }).pipe(
    Effect.catch((error) =>
      Effect.succeed(
        HttpServerResponse.jsonUnsafe(
          { message: String(error) },
          { status: 400 }
        )
      )
    )
  );

  const routes = Layer.mergeAll(
    HttpRouter.add("GET", "/api/gallery", session),
    HttpRouter.add("POST", "/api/gallery", toggle),
    HttpRouter.add("GET", "/", Effect.succeed(HttpServerResponse.html(page))),
    HttpStaticServer.layer({ root: data.root })
  );
  yield* Effect.log(
    `${shots.length} shots: open http://${options.host}:${options.port}/ (Ctrl-C to stop; the selection is saved as you go)`
  );
  return yield* Layer.launch(
    HttpRouter.serve(routes, { disableLogger: true }).pipe(
      Layer.provide(
        NodeHttpServer.layer(createServer, {
          host: options.host,
          port: options.port,
        })
      )
    )
  );
});
