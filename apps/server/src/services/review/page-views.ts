/**
 * The pages as a review model is shown them (ADR 0063): each page's design document, and its
 * picture as the editor draws it at its frame's size (as `get_screenshot` draws a page). The
 * editor draws the pictures: with none open, or one that can't, the page goes without one and
 * the review says why.
 */
import { presetSize } from "@ultrapaint/contracts/pages";
import {
  Effect,
  FileSystem,
  Option,
  Path,
  Result,
  Schema,
  Stream,
} from "effect";
import { OpenProject } from "../../project.ts";
import { DocumentService } from "../documents.ts";
import { PagesService } from "../pages.ts";
import { Screenshots } from "../screenshots.ts";
import type { PageView } from "./review-prompts.ts";

const encodeDocument = Schema.encodeEffect(
  Schema.fromJsonString(Schema.Unknown)
);
const decodeDocument = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Unknown)
);

/** Why a page has no picture when no editor is open. */
export const NO_EDITOR = "no editor is open to draw it.";

const DATA_URL_RE = /data:([\w.+-]+\/[\w.+-]+);base64,[A-Za-z0-9+/=]+/g;

/**
 * A document with each image inlined as data said only by its type and size: the picture shows
 * it, and one such image made a reviewer's prompt 2.4M tokens long, past what it takes.
 */
export const withoutDataUrls = (document: string): string =>
  document.replace(
    DATA_URL_RE,
    (url, type: string) =>
      `(a ${type} inlined as data, ${Math.round((url.length * 3) / 4 / 1024)} KB)`
  );

export const makePageViews = Effect.fnUntraced(function* () {
  const screenshots = yield* Screenshots;
  const project = yield* OpenProject;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  /** A page's URL and its picture, as the editor draws it; a page the editor doesn't list has none. */
  const drawn = (file: string) =>
    project
      .use(
        Effect.gen(function* () {
          const pages = yield* PagesService;
          const documents = yield* DocumentService;
          const page = (yield* pages.list).pages.find((p) => p.file === file);
          if (!page) {
            return { picture: null, route: undefined };
          }
          const state = yield* documents.get(page.id);
          if (!state.root) {
            return { picture: null, route: page.route };
          }
          const layout = yield* pages.readCanvas(page.canvas);
          const frame = layout.frames[page.path] ?? presetSize.desktop;
          const bytes = yield* screenshots.capture({
            canvas: page.canvas,
            height: frame.height,
            mode: "page",
            root: state.root,
            width: frame.width,
          });
          return {
            picture: Buffer.from(bytes).toString("base64"),
            route: page.route,
          };
        })
      )
      .pipe(Effect.result);

  /** The page's picture, or why it has none. */
  const pictureOf = Effect.fnUntraced(function* (
    file: string,
    editors: number
  ) {
    if (editors === 0) {
      const none: Pick<PageView, "picture" | "route"> = {
        picture: { kind: "none", why: NO_EDITOR },
      };
      return none;
    }
    const result = yield* drawn(file);
    if (Result.isFailure(result)) {
      const failed: Pick<PageView, "picture" | "route"> = {
        picture: { kind: "none", why: `${result.failure.message}.` },
      };
      return failed;
    }
    const { picture, route } = result.success;
    const view: Pick<PageView, "picture" | "route"> = {
      picture:
        picture === null
          ? { kind: "none", why: "the editor couldn't draw it." }
          : { data: picture, kind: "png" },
      route,
    };
    return view;
  });

  /** Each page as the reviewers see it; a page deleted since is left out. */
  return Effect.fnUntraced(function* (root: string, files: readonly string[]) {
    const editors = Option.getOrElse(
      yield* Stream.runHead(screenshots.editors),
      () => 0
    );
    const views: PageView[] = [];
    for (const file of files) {
      const text = yield* fs
        .readFileString(path.join(root, file))
        .pipe(Effect.option);
      if (Option.isSome(text)) {
        // Compact: the reviewer reads it whole, an image inlined as data said only by its size.
        const document = withoutDataUrls(
          yield* decodeDocument(text.value).pipe(
            Effect.flatMap(encodeDocument),
            Effect.orElseSucceed(() => text.value)
          )
        );
        views.push({ document, file, ...(yield* pictureOf(file, editors)) });
      }
    }
    return views;
  });
});
