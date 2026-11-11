/**
 * The pages as a review model is shown them (ADR 0063): each page's design document, and its
 * picture as the editor draws it at its frame's size (as `get_screenshot` draws a page). The
 * editor draws the pictures: with none open, or one that can't, the page goes without one and
 * the review says why.
 */
import { PageDocument } from "@ultrapaint/contracts/document";
import { presetSize } from "@ultrapaint/contracts/pages";
import {
  type OffSystemValue,
  offSystemValues,
} from "@ultrapaint/design-document/off-system";
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

/** How many of the values off the system a reviewer is shown, the rest counted. */
const SHOWN_OFF_SYSTEM = 12;

/**
 * What the checks measured on a page's document (ADR 0061), as facts for the reviewer: the
 * values set by hand where the design system has a token, counted by kind, the first few named.
 */
export const documentChecks = (values: readonly OffSystemValue[]): string => {
  if (values.length === 0) {
    return "No value is set by hand where the design system has a token.";
  }
  const kinds = new Map<string, number>();
  for (const v of values) {
    kinds.set(v.kind, (kinds.get(v.kind) ?? 0) + 1);
  }
  const counted = [...kinds].map(([kind, n]) => `${n} ${kind}`).join(", ");
  const named = values
    .slice(0, SHOWN_OFF_SYSTEM)
    .map((v) => `- ${v.node}: \`${v.field}\` ${JSON.stringify(v.value)}`);
  return [
    `${values.length} values are set by hand where the design system has a token (${counted}):`,
    ...named,
    ...(values.length > SHOWN_OFF_SYSTEM
      ? [`- and ${values.length - SHOWN_OFF_SYSTEM} more.`]
      : []),
  ].join("\n");
};

const decodePage = Schema.decodeUnknownEffect(PageDocument);

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
        views.push({
          ...(Option.isSome(page)
            ? { checks: documentChecks(offSystemValues(page.value.root)) }
            : {}),
          document,
          file,
          ...(yield* pictureOf(file, editors)),
        });
      }
    }
    return views;
  });
});
