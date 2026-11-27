/**
 * The pages as a review model is shown them (ADR 0063): each page's design document, and its
 * picture as the editor draws it at its frame's size (as `get_screenshot` draws a page). The
 * editor draws the pictures: with none open, or one that can't, the page goes without one and
 * the review says why. Beside them, for the designer and never for the reviewers (ADR 0081), what
 * the checks measured: the values its document sets by hand where the design system has a token,
 * and what the editor measured on the page it drew, when it could.
 */
import { PageDocument } from "@ultrapaint/contracts/document";
import { presetSize } from "@ultrapaint/contracts/pages";
import type { RenderedFinding } from "@ultrapaint/contracts/screenshots";
import { offSystemValues } from "@ultrapaint/design-document/off-system";
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

const decodePage = Schema.decodeUnknownEffect(PageDocument);

/** What the editor measured on a page it did not draw: nothing. */
const UNMEASURED: readonly RenderedFinding[] = [];

/** A page's picture, or why it has none, and what the editor measured on the page it drew. */
type Drawn = Pick<PageView, "name" | "picture" | "route"> & {
  readonly rendered: readonly RenderedFinding[];
};

/** Why a page has no picture when no editor is open. */
const NO_EDITOR = "no editor is open to draw it.";

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

  /**
   * A page's name, its URL and its picture, as the editor lists and draws it; a page the editor
   * doesn't list has none.
   */
  const drawn = (file: string) =>
    project
      .use(
        Effect.gen(function* () {
          const pages = yield* PagesService;
          const documents = yield* DocumentService;
          const page = (yield* pages.list).pages.find((p) => p.file === file);
          if (!page) {
            return { picture: null, rendered: UNMEASURED, route: undefined };
          }
          const state = yield* documents.get(page.id);
          if (!state.root) {
            return {
              name: page.name,
              picture: null,
              rendered: UNMEASURED,
              route: page.route,
            };
          }
          const layout = yield* pages.readCanvas(page.canvas);
          const frame = layout.frames[page.path] ?? presetSize.desktop;
          // Measured as it is drawn: the checks on the rendered page (ADR 0081).
          const { findings, png } = yield* screenshots.captureChecked({
            canvas: page.canvas,
            height: frame.height,
            mode: "page",
            root: state.root,
            width: frame.width,
          });
          return {
            name: page.name,
            picture: Buffer.from(png).toString("base64"),
            rendered: findings,
            route: page.route,
          };
        })
      )
      .pipe(Effect.result);

  /** The page's picture, or why it has none, and what the editor measured on it. */
  const pictureOf = Effect.fnUntraced(function* (
    file: string,
    editors: number
  ) {
    if (editors === 0) {
      const none: Drawn = {
        picture: { kind: "none", why: NO_EDITOR },
        rendered: UNMEASURED,
      };
      return none;
    }
    const result = yield* drawn(file);
    if (Result.isFailure(result)) {
      const failed: Drawn = {
        picture: { kind: "none", why: `${result.failure.message}.` },
        rendered: UNMEASURED,
      };
      return failed;
    }
    const { name, picture, rendered, route } = result.success;
    const view: Drawn = {
      name,
      picture:
        picture === null
          ? { kind: "none", why: "the editor couldn't draw it." }
          : { data: picture, kind: "png" },
      rendered,
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
        const json = yield* decodeDocument(text.value).pipe(Effect.option);
        // Compact: the reviewer reads it whole, an image inlined as data said only by its size.
        const document = withoutDataUrls(
          yield* Option.match(json, {
            onNone: () => Effect.succeed(text.value),
            onSome: (value) =>
              encodeDocument(value).pipe(
                Effect.orElseSucceed(() => text.value)
              ),
          })
        );
        // A document that doesn't read as a page goes without its checks, not without review.
        const page = Option.isSome(json)
          ? yield* decodePage(json.value).pipe(Effect.option)
          : Option.none();
        const { rendered, ...drawnView } = yield* pictureOf(file, editors);
        views.push({
          checks: {
            offSystem: Option.isSome(page)
              ? offSystemValues(page.value.root)
              : [],
            rendered,
          },
          document,
          file,
          ...drawnView,
        });
      }
    }
    return views;
  });
});
