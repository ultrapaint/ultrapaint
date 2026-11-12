/**
 * A point of the history opened to look at (ADR 0087): its pages, canvases and documents read
 * off the files it kept, as the editor shows the designs.
 */
import type { DocumentState } from "@ultrapaint/contracts/document";
import {
  type CanvasLayout,
  emptyCanvasLayout,
  type Page,
} from "@ultrapaint/contracts/pages";
import type { HistoryPoint, PointView } from "@ultrapaint/contracts/snapshots";
import { canvasDocOf, canvasRoot } from "@ultrapaint/design-document/tree";
import { CANVAS_FILE, CANVASES_FILE } from "@ultrapaint/shared/canvas";
import { Effect } from "effect";
import { hashContent } from "../hash.ts";
import { parseCanvasText } from "./canvas-files.ts";
import { parseDocument } from "./document-file.ts";
import { canvasIdsIn, decodeOrder, pageListOf } from "./pages-layout.ts";

/** Designs-relative path to content, of the files kept under the designs directory. */
const underDesigns = (
  files: { readonly [file: string]: string },
  prefix: string
): { [rel: string]: string } =>
  Object.fromEntries(
    Object.entries(files).flatMap(([file, content]) =>
      file.startsWith(prefix)
        ? [[file.slice(prefix.length), content] as const]
        : []
    )
  );

/** Each canvas's layout, from its canvas.json; one that cannot be read is empty. */
const layoutsOf = Effect.fnUntraced(function* (files: {
  readonly [rel: string]: string;
}) {
  const layouts: { [canvas: string]: CanvasLayout } = {};
  for (const canvas of canvasIdsIn(Object.keys(files))) {
    const text =
      files[canvas === "" ? CANVAS_FILE : `${canvas}/${CANVAS_FILE}`];
    layouts[canvas] =
      text === undefined
        ? emptyCanvasLayout()
        : yield* parseCanvasText(text).pipe(
            Effect.map(({ layout }): CanvasLayout => layout),
            Effect.orElseSucceed(() => emptyCanvasLayout())
          );
  }
  return layouts;
});

const orderOf = (files: { readonly [rel: string]: string }) => {
  const text = files[CANVASES_FILE];
  return text === undefined
    ? Effect.succeed([] as readonly string[])
    : decodeOrder(text).pipe(
        Effect.map((o) => o.order),
        Effect.orElseSucceed((): readonly string[] => [])
      );
};

/** Every page's document and every canvas's loose nodes, as the editor holds them. */
const documentsOf = Effect.fnUntraced(function* (
  files: { readonly [rel: string]: string },
  pages: readonly Page[],
  layouts: { readonly [canvas: string]: CanvasLayout }
) {
  const documents: DocumentState[] = [];
  for (const page of pages) {
    const text = files[page.id] ?? "";
    const parsed = yield* parseDocument(text);
    documents.push({
      doc: page.id,
      hash: hashContent(text),
      ...("problem" in parsed
        ? { problem: parsed.problem, root: null }
        : { root: parsed.root }),
    });
  }
  for (const [canvas, layout] of Object.entries(layouts)) {
    documents.push({
      doc: canvasDocOf(canvas),
      hash: "",
      root: canvasRoot(layout.nodes ?? []),
    });
  }
  return documents;
});

/** The designs as a point kept them, from its files (repository-relative). */
export const pointViewOf = Effect.fnUntraced(function* (
  kept: { readonly [file: string]: string },
  options: {
    readonly point: HistoryPoint;
    /** The designs directory, repository-relative, with its trailing slash ("" at the root). */
    readonly prefix: string;
    readonly rootName: string;
  }
) {
  const files = underDesigns(kept, options.prefix);
  const layouts = yield* layoutsOf(files);
  const list = pageListOf({
    fileOf: (rel) => `${options.prefix}${rel}`,
    files: Object.keys(files),
    layouts,
    order: yield* orderOf(files),
    rootName: options.rootName,
  });
  return {
    canvases: list.canvases,
    documents: yield* documentsOf(files, list.pages, layouts),
    layouts,
    pages: list.pages,
    point: options.point,
  } satisfies PointView;
});
