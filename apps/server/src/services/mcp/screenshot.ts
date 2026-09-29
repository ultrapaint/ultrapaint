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
import { McpSchema, McpServer, Tool } from "effect/unstable/ai";
import { PagesService } from "../pages.ts";
import { Screenshots } from "../screenshots.ts";
import { makeLookup, missing, reported } from "./tools.ts";

/** The width a node on the canvas is drawn in, when it fills its parent. */
const CANVAS_WIDTH = 1200;
const CANVAS_HEIGHT = 900;

const GetScreenshot = Tool.make("get_screenshot", {
  description:
    "A picture of a page, or of one node of it, drawn by the editor's preview with the repository's own stylesheet and components: look at it after changing a design to check spacing, alignment, overflow and contrast, then fix what is off. A page is drawn at the size of its frame on the canvas, or at `width`; with `node` the picture is cropped to that node, drawn in place. For a node on the canvas beside the pages, pass `canvas: true` and its id. A node reference the user copied from the editor (/orders#c_8x2k1q, canvas#g_1) can be passed as `node` alone. Needs the editor open in a browser.",
  parameters: Schema.Struct({
    /** Picture a node placed on the canvas beside the pages; `node` says which. */
    canvas: Schema.optional(Schema.Boolean),
    /** Id of the node to crop to; the whole page when left out. */
    node: Schema.optional(Schema.String),
    /** Route or file of the page; leave out with `canvas: true`. */
    route: Schema.optional(Schema.String),
    space: Schema.optional(Schema.String),
    /** Viewport width in CSS pixels, for a page: 390 for a phone, 1440 for a desktop. */
    width: Schema.optional(
      Schema.Number.check(Schema.isBetween({ maximum: 4000, minimum: 200 }))
    ),
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
    const { documents, pageAt, project, spaceOf } = yield* makeLookup;

    type Parameters = typeof GetScreenshot.parametersSchema.Type;

    /** A node on the canvas, drawn inside the one placed there that holds it, at its own size. */
    const drawOnCanvas = Effect.fnUntraced(function* ({
      node,
      space,
      width,
    }: Parameters) {
      if (node === undefined) {
        return yield* missing(
          "say which node on the canvas with `node`; read_canvas lists them"
        );
      }
      const inSpace = yield* spaceOf(space);
      const state = yield* documents((d) => d.get(canvasDocOf(inSpace)));
      const placed = findPath(state.root, node)?.[1];
      if (!placed) {
        return yield* missing(
          `no node ${node} on the canvas; read_canvas lists them`
        );
      }
      const bytes = yield* reported(
        screenshots.capture({
          height: CANVAS_HEIGHT,
          mode: "fit",
          root: placed,
          space: inSpace,
          width: width ?? CANVAS_WIDTH,
          ...(placed.id !== node && { nodeId: node }),
        })
      );
      return { bytes, what: `node ${node} on the canvas` };
    });

    /** A page as a window of its frame's size shows it, or one node of it in place. */
    const drawPage = Effect.fnUntraced(function* (
      route: string,
      { node, space, width }: Parameters
    ) {
      const page = yield* pageAt(route, space);
      const state = yield* documents((d) => d.get(page.id));
      if (state.problem !== undefined || !state.root) {
        return yield* missing(
          `${page.file} is not a valid page: ${state.problem ?? "it is empty"}`
        );
      }
      if (node !== undefined && !findNode(state.root, node)) {
        return yield* missing(
          `no node ${node} on ${page.route}; read_page lists them`
        );
      }
      const layout = yield* reported(
        project.use(
          Effect.flatMap(PagesService, (pages) => pages.readCanvas(page.space))
        )
      );
      const frame = layout.frames[page.path] ?? presetSize.desktop;
      const viewport = width ?? frame.width;
      const bytes = yield* reported(
        screenshots.capture({
          height: frame.height,
          mode: "page",
          root: state.root,
          space: page.space,
          width: viewport,
          ...(node !== undefined && { nodeId: node }),
        })
      );
      const where = `${page.route} at ${viewport}px wide`;
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
            ...(ref.route === null
              ? { canvas: true }
              : { route: given.route ?? ref.route }),
            ...(ref.space === undefined || given.space !== undefined
              ? {}
              : { space: ref.space }),
          }
        : given;
      if (parameters.canvas) {
        return drawOnCanvas(parameters);
      }
      if (parameters.route === undefined) {
        return missing(
          "say which page with `route`, or pass `canvas: true` and a `node` for the canvas"
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
        inputSchema: Tool.getJsonSchema(
          GetScreenshot
        ) as McpSchema.ToolJsonSchema,
        name: GetScreenshot.name,
      }),
    });
  })
);
