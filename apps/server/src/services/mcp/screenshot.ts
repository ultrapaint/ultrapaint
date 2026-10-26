/**
 * `get_screenshot`: a picture of a page or a node, so an agent can see what it made and fix it.
 *
 * Every other tool answers with JSON, which the toolkit turns into text. A picture has to reach
 * the agent as an image, so this one is registered on the MCP server by hand.
 */
import { presetSize } from "@ultrapaint/contracts/pages";
import {
  canvasDocOf,
  findNode,
  findPath,
} from "@ultrapaint/design-document/tree";
import { parseNodeRef } from "@ultrapaint/shared/node-ref";
import { Effect, Layer, Schema } from "effect";
import { McpSchema, McpServer, Tool } from "effect/ai";
import { PagesService } from "../pages.ts";
import { Screenshots } from "../screenshots.ts";
import { makeLookup } from "./lookup.ts";
import {
  finite,
  missing,
  opt,
  PAGE_PARAMETER,
  reported,
} from "./tool-helpers.ts";

/** The width a node on the canvas is drawn in, when it fills its parent. */
const CANVAS_WIDTH = 1200;
const CANVAS_HEIGHT = 900;

const GetScreenshot = Tool.make("get_screenshot", {
  description:
    "A picture of a page, or of one node, as the repository draws it: look after a change; fix spacing, alignment, overflow, contrast. Drawn at its frame's size, or at width. node may be a node reference (/orders#c_8x2k1q) alone; a loose node needs loose: true. Needs the editor open in a browser.",
  parameters: Schema.Struct({
    /** Needed only when the project has several canvases. */
    canvas: opt(Schema.String),
    /** Picture a node placed on the canvas beside the pages; `node` says which. */
    loose: opt(Schema.Boolean),
    /** Id of the node to crop to; the whole page when left out. */
    node: opt(Schema.String),
    /** URL or file of the page; leave out with `loose: true`. */
    route: opt(Schema.String.annotate({ description: PAGE_PARAMETER })),
    /** Viewport width in CSS pixels, for a page: 390 for a phone, 1440 for a desktop. */
    width: opt(finite(200, 4000)),
  }),
}).annotate(Tool.Readonly, true);

const decodeParameters = Schema.decodeUnknownEffect(
  GetScreenshot.parametersSchema
);

const failed = (text: string) =>
  new McpSchema.CallToolResult({
    content: [{ text, type: "text" }],
    isError: true,
  });

export const ScreenshotToolLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const server = yield* McpServer.McpServer;
    const screenshots = yield* Screenshots;
    const { documents, pageAt, project, canvasOf } = yield* makeLookup;

    type Parameters = typeof GetScreenshot.parametersSchema.Type;

    /** A node on the canvas, drawn inside the one placed there that holds it, at its own size. */
    const drawOnCanvas = Effect.fnUntraced(function* ({
      node,
      canvas,
      width,
    }: Parameters) {
      if (node === undefined) {
        return yield* missing(
          "say which node on the canvas with `node`; read_canvas lists them"
        );
      }
      const inCanvas = yield* canvasOf(canvas);
      const state = yield* documents((d) => d.get(canvasDocOf(inCanvas)));
      const placed = findPath(state.root, node)?.[1];
      if (!placed) {
        return yield* missing(
          `no node ${node} on the canvas; read_canvas lists them`
        );
      }
      const bytes = yield* reported(
        screenshots.capture({
          canvas: inCanvas,
          height: CANVAS_HEIGHT,
          mode: "fit",
          root: placed,
          width: width ?? CANVAS_WIDTH,
          ...(placed.id !== node && { nodeId: node }),
        })
      );
      return { bytes, what: `node ${node} on the canvas` };
    });

    /** A page as a window of its frame's size shows it, or one node of it in place. */
    const drawPage = Effect.fnUntraced(function* (
      route: string,
      { node, canvas, width }: Parameters
    ) {
      const page = yield* pageAt(route, canvas);
      const state = yield* documents((d) => d.get(page.id));
      if (state.problem !== undefined || !state.root) {
        return yield* missing(
          `${page.file} is not a valid page: ${state.problem ?? "it is empty"}`
        );
      }
      if (node !== undefined && !findNode(state.root, node)) {
        return yield* missing(
          `no node ${node} on ${page.route ?? page.file}; read_page lists them`
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
          ...(node !== undefined && { nodeId: node }),
        })
      );
      const where = `${page.route ?? page.file} at ${viewport}px wide`;
      return {
        bytes,
        what: node === undefined ? where : `node ${node} of ${where}`,
      };
    });

    const draw = (given: Parameters) => {
      // A node reference says the page, or the canvas, and the node at once.
      const ref = given.node === undefined ? null : parseNodeRef(given.node);
      const parameters: Parameters = ref
        ? {
            ...given,
            node: ref.nodeId,
            ...(ref.page === null
              ? { loose: true }
              : { route: given.route ?? ref.page }),
            ...(ref.canvas === undefined || given.canvas !== undefined
              ? {}
              : { canvas: ref.canvas }),
          }
        : given;
      if (parameters.loose) {
        return drawOnCanvas(parameters);
      }
      if (parameters.route === undefined) {
        return missing(
          "say which page with `route`, or pass `loose: true` and a `node` for a node beside the pages"
        );
      }
      return drawPage(parameters.route, parameters);
    };

    yield* server.addTool({
      annotations: GetScreenshot.annotations,
      handle: (payload) =>
        decodeParameters(payload ?? {}).pipe(
          Effect.mapError(
            (error) => new McpSchema.InvalidParams({ message: error.message })
          ),
          Effect.flatMap((parameters) =>
            draw(parameters).pipe(
              Effect.map(
                ({ bytes, what }) =>
                  new McpSchema.CallToolResult({
                    content: [
                      { data: bytes, mimeType: "image/png", type: "image" },
                      { text: what, type: "text" },
                    ],
                    isError: false,
                  })
              ),
              Effect.catchTag("ToolFailure", (failure) =>
                Effect.succeed(failed(failure.message))
              )
            )
          )
        ),
      tool: new McpSchema.Tool({
        annotations: { readOnlyHint: true },
        description: Tool.getDescription(GetScreenshot),
        inputSchema: Tool.getJsonSchema(GetScreenshot) as McpSchema.ToolJson,
        name: GetScreenshot.name,
      }),
    });
  })
);
