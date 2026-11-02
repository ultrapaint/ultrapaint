/**
 * The editor's tools that a toolkit cannot answer, each answered by hand (`rawTool`): a picture of
 * a page (`get_screenshot`) and questions for the user (`ask_user`). The MCP server registers them
 * beside the toolkits' (`route.ts`), and a test calls them as an agent's call reaches them
 * (`callRawTool`). A fixed list with nothing to vary, so a value made on the services they answer
 * with, not a service of its own (ADR 0037).
 */
import { Effect } from "effect";
import { askUserTool } from "./ask-user.ts";
import { screenshotTool } from "./screenshot.ts";

/** Each tool as the MCP server registers it. */
export const rawTools = Effect.all([screenshotTool, askUserTool]);
