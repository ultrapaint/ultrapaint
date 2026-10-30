/**
 * The editor's tools that a toolkit cannot answer, each answered by hand (`rawTool`): a picture of
 * a page (`get_screenshot`) and questions for the user (`ask_user`). The MCP server registers them
 * beside the toolkits' (`route.ts`), and a test calls them as an agent's call reaches them
 * (`callRawTool`).
 */
import { Context, Effect, Layer } from "effect";
import { askUserTool } from "./ask-user.ts";
import { screenshotTool } from "./screenshot.ts";
import type { RawTool } from "./tool-helpers.ts";

export class RawTools extends Context.Service<
  RawTools,
  {
    /** Each tool as the MCP server registers it. */
    readonly all: readonly RawTool[];
  }
>()("ultrapaint/server/RawTools") {
  static readonly layer = Layer.effect(
    RawTools,
    Effect.map(Effect.all([screenshotTool, askUserTool]), (all) =>
      RawTools.of({ all })
    )
  );
}
