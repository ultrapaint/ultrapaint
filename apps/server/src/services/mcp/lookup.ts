import { Effect } from "effect";
import { OpenProject } from "../../project.ts";
import { DocumentService } from "../documents.ts";
import { pageMissed, pageTargetNamed } from "../page-names.ts";
import { PagesService } from "../pages.ts";
import { missing, reported } from "./tool-helpers.ts";

/**
 * How a tool finds what an agent names: a canvas, a page by route or file, a document. Every
 * miss is a sentence that says what there is instead.
 */
export const makeLookup = Effect.gen(function* () {
  const project = yield* OpenProject;

  const pagesOf = project.use(Effect.flatMap(PagesService, (p) => p.list));

  /** A canvas's id as an agent would pass it back: the designs directory's own is `""`. */
  const quoted = (id: string) => JSON.stringify(id);

  /**
   * The canvas a tool was told to work in, or the only one there is. With several and none
   * named, the tool says so rather than pick one: the first is not what the agent meant.
   */
  const canvasOf = Effect.fnUntraced(function* (canvas: string | undefined) {
    const { canvases } = yield* reported(pagesOf);
    const ids = canvases.map((s) => quoted(s.id)).join(", ");
    if (canvas !== undefined) {
      return canvases.some((s) => s.id === canvas)
        ? canvas
        : yield* missing(
            `no canvas ${quoted(canvas)}; the canvases are ${ids}`
          );
    }
    if (canvases.length <= 1) {
      return canvases[0]?.id ?? "";
    }
    return yield* missing(
      `this project has several canvases (${ids}); say which with \`canvas\``
    );
  });

  /**
   * A page by URL or by file (repository-relative, designs-relative or inside its canvas), in the
   * canvas named, or in the only canvas that has it, by the one rule for page names
   * (`pageTargetNamed`): a canvas written first (`marketing:/pricing`) and a node reference
   * (`/orders#c_1`, `marketing:/pricing#c_1`, `drafts.page.json#c_1`) name their page as well.
   * A miss says it as a design target's does, the pages listed.
   */
  const pageAt = Effect.fnUntraced(function* (
    given: string,
    canvas: string | undefined
  ) {
    const { pages } = yield* reported(pagesOf);
    const named = pageTargetNamed(pages, given, canvas);
    if (named._tag === "Page") {
      return named.page;
    }
    if (named._tag === "Loose") {
      return yield* missing(
        `${given} is a node on the canvas beside the pages; pass \`loose: true\` instead of a page`
      );
    }
    return yield* missing(pageMissed(pages, named, given, canvas));
  });

  const documents = <A, E extends { readonly message: string }>(
    f: (service: DocumentService["Service"]) => Effect.Effect<A, E>
  ) => reported(project.use(Effect.flatMap(DocumentService, f)));

  const pagesService = <A, E extends { readonly message: string }>(
    f: (service: PagesService["Service"]) => Effect.Effect<A, E>
  ) => reported(project.use(Effect.flatMap(PagesService, f)));

  return { canvasOf, documents, pageAt, pagesOf, pagesService, project };
});
