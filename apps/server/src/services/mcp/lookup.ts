import type { Page } from "@ultrapaint/contracts/pages";
import { canvasDocOf } from "@ultrapaint/design-document/tree";
import { parseNodeRef } from "@ultrapaint/shared/node-ref";
import { Effect } from "effect";
import { OpenProject } from "../../project.ts";
import { DocumentService } from "../documents.ts";
import { pageMissed, pageTargetNamed } from "../page-names.ts";
import { PagesService } from "../pages.ts";
import { RepoPaths } from "../repo-paths.ts";
import { missing, reported } from "./tool-helpers.ts";

/** Where a tool works: a page, or the nodes beside a canvas's pages, maybe one node of either. */
export interface Where {
  readonly canvas: string;
  /** The document: the page's id, or the canvas's own (`canvasDocOf`). */
  readonly doc: string;
  /** Its file, repository-relative: the page's, or the canvas's `canvas.json`. */
  readonly file: string;
  /** A node id, never a reference: the one `node` or the name's reference says. */
  readonly nodeId?: string;
  /** Null for the nodes beside the pages. */
  readonly page: Page | null;
}

/** Where to work, as the parameters of every tool that takes it say it. */
export interface Given {
  readonly canvas?: string | undefined;
  /** The nodes beside the pages, rather than a page. */
  readonly loose?: boolean | undefined;
  /** A node id, or a node reference, which names its page as well. */
  readonly node?: string | undefined;
  /** A page's URL or file, a node reference, or `canvas#id` for a node beside the pages. */
  readonly route?: string | undefined;
}

/** The node id a reference such as `/home#c_1` stands for; any other text as it is. */
export const nodeIdOf = (text: string) => parseNodeRef(text)?.nodeId ?? text;

/**
 * How a tool finds what an agent names: a canvas, where to work (`where`: a page or the nodes
 * beside the pages, and a node of either), a document. Every miss is a sentence that says what
 * there is instead.
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

  /** The nodes beside a canvas's pages, maybe one of them. */
  const beside = Effect.fnUntraced(function* (
    canvas: string | undefined,
    nodeId: string | undefined
  ) {
    const id = yield* canvasOf(canvas);
    const paths = yield* reported(project.use(RepoPaths));
    return {
      canvas: id,
      doc: canvasDocOf(id),
      file: paths.relative(
        `${paths.designsDir}/${id === "" ? "" : `${id}/`}canvas.json`
      ),
      page: null,
      ...(nodeId !== undefined && { nodeId }),
    } satisfies Where;
  });

  /** The page a name means, or the node beside the pages its reference does; a miss says why. */
  const targetNamed = Effect.fnUntraced(function* (
    named: string,
    canvas: string | undefined
  ) {
    const { pages } = yield* reported(pagesOf);
    const found = pageTargetNamed(pages, named, canvas);
    return found._tag === "Page" || found._tag === "Loose"
      ? found
      : yield* missing(pageMissed(pages, found, named, canvas));
  });

  /**
   * Where a tool works, by one rule for every tool (ADR 0018: a node reference is taken wherever
   * a page or a node id is). `route` names a page by URL or by file, in the canvas named or in
   * the only canvas that has it (`pageTargetNamed`), a canvas written first
   * (`marketing:/pricing`); a node reference names its page and its node (`/orders#c_1`), or a
   * node beside the pages (`canvas#c_1`). `node` names a node by id or by reference, and its
   * reference names the page too when `route` does not. `loose: true` is the nodes beside the
   * pages of the canvas named, or of the page's. A miss says it as a design target's does, the
   * pages listed.
   */
  const where = Effect.fnUntraced(function* ({
    canvas,
    loose,
    node,
    route,
  }: Given) {
    const nodeId = node === undefined ? undefined : nodeIdOf(node);
    const named =
      route ?? (node !== undefined && parseNodeRef(node) ? node : undefined);
    if (named === undefined) {
      return loose
        ? yield* beside(canvas, nodeId)
        : yield* missing(
            "say which page with `route`, or pass `loose: true` for the nodes beside the pages"
          );
    }
    const found = yield* targetNamed(named, canvas);
    if (found._tag === "Loose") {
      return yield* beside(canvas ?? found.canvas, nodeId ?? found.nodeId);
    }
    const { page } = found;
    const id = nodeId ?? found.nodeId;
    return loose
      ? yield* beside(page.canvas, id)
      : ({
          canvas: page.canvas,
          doc: page.id,
          file: page.file,
          page,
          ...(id !== undefined && { nodeId: id }),
        } satisfies Where);
  });

  /** A page by `where`'s rule, for a tool that works on pages only. */
  const pageAt = Effect.fnUntraced(function* (
    route: string,
    canvas: string | undefined
  ) {
    const at = yield* where({ canvas, route });
    return at.page === null
      ? yield* missing(
          `${route} is a node on the canvas beside the pages, not a page`
        )
      : at.page;
  });

  const documents = <A, E extends { readonly message: string }>(
    f: (service: DocumentService["Service"]) => Effect.Effect<A, E>
  ) => reported(project.use(Effect.flatMap(DocumentService, f)));

  const pagesService = <A, E extends { readonly message: string }>(
    f: (service: PagesService["Service"]) => Effect.Effect<A, E>
  ) => reported(project.use(Effect.flatMap(PagesService, f)));

  return {
    canvasOf,
    documents,
    pageAt,
    pagesOf,
    pagesService,
    project,
    where,
  };
});
