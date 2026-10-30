/**
 * `get_screenshot`: a picture of a page or a node, so an agent can see what it made and fix it.
 *
 * Every other tool answers with JSON, which the toolkit turns into text. A picture has to reach
 * the agent as an image, so this one is answered by hand (`rawTool`).
 */
import { type Page, presetSize } from "@ultrapaint/contracts/pages";
import { findNode, findPath } from "@ultrapaint/design-document/tree";
import { Effect, Schema } from "effect";
import { McpSchema, Tool } from "effect/ai";
import { PagesService } from "../pages.ts";
import { Screenshots } from "../screenshots.ts";
import { TOOLS } from "../threads/agent-ways.ts";
import { makeLookup, type Where } from "./lookup.ts";
import {
  doing,
  finite,
  missing,
  opt,
  rawTool,
  reported,
} from "./tool-helpers.ts";

/** The width a node on the canvas is drawn in, when it fills its parent. */
const CANVAS_WIDTH = 1200;
const CANVAS_HEIGHT = 900;

export const GetScreenshot = Tool.make("get_screenshot", {
  description:
    "A picture of a page or node as drawn, at its frame's size or width: look after a change; fix spacing, alignment, overflow, contrast. node may be a node reference; loose: true for a loose one.",
  parameters: Schema.Struct({
    /** Needed only when the project has several canvases. */
    canvas: opt(Schema.String),
    /** Picture a node placed on the canvas beside the pages; `node` says which. */
    loose: opt(Schema.Boolean),
    /** Id of the node to crop to; the whole page when left out. */
    node: opt(Schema.String),
    /** URL or file of the page; leave out with `loose: true`. */
    route: opt(Schema.String),
    /** Viewport width in CSS pixels, for a page: 390 for a phone, 1440 for a desktop. */
    width: opt(finite(200, 4000)),
  }),
}).annotateMerge(doing("read"));

/** `get_screenshot`, answered with the picture and a line on what it shows. */
export const screenshotTool = Effect.gen(function* () {
  const screenshots = yield* Screenshots;
  const { documents, project, where } = yield* makeLookup;

  /** A node on the canvas, drawn inside the one placed there that holds it, at its own size. */
  const drawOnCanvas = Effect.fnUntraced(function* (
    { canvas, doc, nodeId }: Where,
    width: number | undefined
  ) {
    if (nodeId === undefined) {
      return yield* missing(
        `say which node on the canvas with \`node\`; ${TOOLS.read_canvas} lists them`
      );
    }
    const state = yield* documents((d) => d.get(doc));
    const placed = findPath(state.root, nodeId)?.[1];
    if (!placed) {
      return yield* missing(
        `no node ${nodeId} on the canvas; ${TOOLS.read_canvas} lists them`
      );
    }
    const bytes = yield* reported(
      screenshots.capture({
        canvas,
        height: CANVAS_HEIGHT,
        mode: "fit",
        root: placed,
        width: width ?? CANVAS_WIDTH,
        ...(placed.id !== nodeId && { nodeId }),
      })
    );
    return { bytes, what: `node ${nodeId} on the canvas` };
  });

  /** A page as a window of its frame's size shows it, or one node of it in place. */
  const drawPage = Effect.fnUntraced(function* (
    page: Page,
    nodeId: string | undefined,
    width: number | undefined
  ) {
    const state = yield* documents((d) => d.get(page.id));
    if (state.problem !== undefined || !state.root) {
      return yield* missing(
        `${page.file} is not a valid page: ${state.problem ?? "it is empty"}`
      );
    }
    if (nodeId !== undefined && !findNode(state.root, nodeId)) {
      return yield* missing(
        `no node ${nodeId} on ${page.route ?? page.file}; ${TOOLS.read_page} lists them`
      );
    }
    const layout = yield* reported(
      project.use(
        Effect.flatMap(PagesService, (pages) => pages.readCanvas(page.canvas))
      )
    );
    const frame = layout.frames[page.path] ?? presetSize.desktop;
    const viewport = width ?? frame.width;
    const bytes = yield* reported(
      screenshots.capture({
        canvas: page.canvas,
        height: frame.height,
        mode: "page",
        root: state.root,
        width: viewport,
        ...(nodeId !== undefined && { nodeId }),
      })
    );
    const shown = `${page.route ?? page.file} at ${viewport}px wide`;
    return {
      bytes,
      what: nodeId === undefined ? shown : `node ${nodeId} of ${shown}`,
    };
  });

  /** Where it is, by the one rule every tool reads it by (`where`): a reference says it all. */
  const draw = Effect.fnUntraced(function* ({
    width,
    ...given
  }: typeof GetScreenshot.parametersSchema.Type) {
    const at = yield* where(given);
    return at.page === null
      ? yield* drawOnCanvas(at, width)
      : yield* drawPage(at.page, at.nodeId, width);
  });

  return rawTool(GetScreenshot, (parameters) =>
    Effect.map(
      draw(parameters),
      ({ bytes, what }) =>
        new McpSchema.CallToolResult({
          content: [
            { data: bytes, mimeType: "image/png", type: "image" },
            { text: what, type: "text" },
          ],
          isError: false,
        })
    )
  );
});
