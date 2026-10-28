/**
 * How an agent does what a task or the briefing asks of it, with the editor's MCP server or
 * without it: each capability written once, both ways, so the texts say "mark it implemented"
 * or "bring the tokens over" in the same words wherever they ask for it. A text names one of the
 * editor's tools only through here: in a capability's words, or by `tools`, the tools' own names,
 * which is null without the server. The `handoff` tool's actions are named here too, for its
 * schema (`mcp/handoff-tools.ts`) and every text that tells an agent to call it.
 */
import {
  DESIGN_MD_FILE,
  DESIGN_SYSTEM_FILE,
} from "@ultrapaint/contracts/design-system";
import type { Toolkit } from "effect/ai";
import { DESIGN_TOKENS_FILE } from "../dtcg.ts";
import type { AskUser } from "../mcp/ask-user.ts";
import type { FigmaTools } from "../mcp/figma-tools.ts";
import type { GetScreenshot } from "../mcp/screenshot.ts";
import type { SetupTools } from "../mcp/setup-tools.ts";
import type { EditorTools } from "../mcp/tools.ts";
import { designSystemSchema, pageSchema } from "./task-text.ts";

/** A tool the editor's MCP server offers, by the name its definition (`Tool.make`) gives it. */
export type ToolName =
  | keyof Toolkit.Tools<typeof EditorTools>
  | keyof Toolkit.Tools<typeof FigmaTools>
  | keyof Toolkit.Tools<typeof SetupTools>
  | (typeof AskUser)["name"]
  | (typeof GetScreenshot)["name"];

/** The editor's tools, each by its own name: a text writes `${tools.ask_user}`. */
export type ToolNames = { readonly [N in ToolName]: N };

/** Every tool the server offers: one renamed, added or taken out fails to compile here. */
const TOOLS: ToolNames = {
  apply_operations: "apply_operations",
  ask_user: "ask_user",
  copy_pages: "copy_pages",
  create_canvas: "create_canvas",
  create_page: "create_page",
  delete_page: "delete_page",
  duplicate_page: "duplicate_page",
  finish_setup_step: "finish_setup_step",
  focus: "focus",
  get_component: "get_component",
  get_context: "get_context",
  get_document_format: "get_document_format",
  get_screenshot: "get_screenshot",
  handoff: "handoff",
  list_comments: "list_comments",
  list_components: "list_components",
  list_figma_imports: "list_figma_imports",
  list_links: "list_links",
  list_pages: "list_pages",
  list_templates: "list_templates",
  map_figma_component: "map_figma_component",
  map_values: "map_values",
  next_batch: "next_batch",
  read_canvas: "read_canvas",
  read_design_system: "read_design_system",
  read_figma_component: "read_figma_component",
  read_figma_frame: "read_figma_frame",
  read_figma_import: "read_figma_import",
  read_page: "read_page",
  rename_page: "rename_page",
  reply_to_comment: "reply_to_comment",
  resolve_comment: "resolve_comment",
  scan_design_system: "scan_design_system",
  set_frame: "set_frame",
  set_home: "set_home",
  set_page_url: "set_page_url",
  write_design_system: "write_design_system",
  write_figma_frame: "write_figma_frame",
};

/** The actions of the `handoff` tool. */
export const HANDOFF_ACTIONS = [
  "list",
  "read",
  "mark",
  "note",
  "export",
  "import",
] as const;
export type HandoffAction = (typeof HANDOFF_ACTIONS)[number];

/**
 * A call of `handoff` as a text asks for it: `handoff with action "export" and tokens […]`. Also
 * for what the tool answers, which only an agent with the tools reads.
 */
export const handoffCall = (action: HandoffAction, args?: string) =>
  `${TOOLS.handoff} with action "${action}"${args ? ` and ${args}` : ""}`;

/** Which tokens a step brings over: these, the ones the text just listed, or all that wait. */
export type TokensNamed = readonly string[] | "named" | "all";

const tokensArgument = (which: TokensNamed) => {
  if (which === "all") {
    return "no tokens";
  }
  return which === "named"
    ? "tokens, their names"
    : `tokens ${JSON.stringify(which)}`;
};

export interface AgentWays {
  /**
   * Asking the user what is theirs to decide, and waiting for the answers: a phrase after "ask
   * the user" or "put them to the user".
   */
  readonly askUser: string;
  /** The briefing's paragraph on changing designs. */
  readonly changingDesigns: string;
  /** How the pages of a canvas are read and changed. */
  readonly editPages: (canvas: string) => string;
  /** Bringing the design's values of tokens into the code: a clause, its verb first. */
  readonly exportTokens: (which: TokensNamed) => string;
  /** How an agent's step of the design-system setup ends. */
  readonly finishStep: (step: string) => string;
  /** Taking the code's values of tokens into the design: a clause, its verb first. */
  readonly importTokens: (which: TokensNamed) => string;
  /** How a page built already is linked to the files that draw it: a clause after a comma. */
  readonly linkBuilt: string;
  /**
   * Saying a design is implemented by the files written for it: a clause, its verb first. The
   * target as the text names it (`"home.page.json"`, or what stands for it).
   */
  readonly markImplemented: (target: string) => string;
  /** Writing down what the code must do that a design cannot show: a clause, its verb first. */
  readonly noteBehaviour: string;
  /** What Define, proposing a design system, works with. */
  readonly proposeWith: string;
  /** Reading a component's props and variants: a clause, its verb first. */
  readonly readComponent: string;
  /** Where the design system is read, with DESIGN.md: a clause, "it" the design system. */
  readonly readDesignSystem: (designsDir: string) => string;
  /**
   * Reading what the stylesheets' theme declares: a step's text. `before` is what the tools say
   * of earlier work.
   */
  readonly readTheme: (stylesheets: string, before: string) => string;
  /** Saving the design system with DESIGN.md, and the formats it is written in: a step's text. */
  readonly saveDesignSystem: (designsDir: string) => string;
  /** Settling a token changed on both sides, once the user said which value to keep. */
  readonly settleTokens: string;
  /**
   * The editor's tools by their names, when they are offered: a text that names one gets it
   * here, and what only they can do is refused when this is null.
   */
  readonly tools: ToolNames | null;
}

const withTools: AgentWays = {
  askUser: `with ${TOOLS.ask_user}`,
  changingDesigns: `The "ultrapaint" MCP server is the editor itself. Change designs through it: ${TOOLS.read_page}
and ${TOOLS.read_canvas} return a document with its ids, ${TOOLS.apply_operations} changes it (insert, remove,
move, update, setProps, wrap, unwrap, duplicate) — validated, shown on the canvas at once and
undoable by the user. ${TOOLS.create_page} adds a page (from a template of ${TOOLS.list_templates}), ${TOOLS.rename_page}
renames it, ${TOOLS.duplicate_page} copies it, ${TOOLS.delete_page} deletes it with its variants, ${TOOLS.set_page_url} sets
or takes off its URL, and ${TOOLS.set_frame} sizes its frame on the canvas (a long page needs a tall one to
be seen whole). ${TOOLS.create_canvas} makes a canvas, ${TOOLS.copy_pages} copies or moves pages into another,
${TOOLS.set_home} says which URL its prototype opens on, and ${TOOLS.list_links} finds the links that lead
nowhere — run it after changing URLs or deleting pages. Ask
${TOOLS.get_component} for a component's props and an instance to start from, ${TOOLS.get_document_format} for
the whole format. ${TOOLS.list_comments}, ${TOOLS.reply_to_comment} and ${TOOLS.resolve_comment} answer the user where
they asked, and ${TOOLS.focus} tells the canvas which page you are on so the user can watch you work;
before changing nodes, pass their ids to ${TOOLS.focus} as nodes with a few words as action, and the
canvas shows your work on them. Tools name a page by its URL, or by its file when it has none.
A node reference such as /orders#c_8x2k1q (or drafts.page.json#c_8x2k1q), which the user may
paste, is a page and a node id.
After a change, ${TOOLS.get_screenshot} shows you the page or a node as it draws: look, and fix what is off.
When a decision is the user's, ${TOOLS.ask_user} puts your questions to them as a card with answers to
pick, and its result is their answers. Only if it says the questions were shown instead, end your
turn: the answers come as the next message.
Prefer these to editing the JSON files yourself; if you do write a file, keep it valid.`,
  editPages: (
    canvas
  ) => `Through the ultrapaint MCP server, always passing canvas: ${canvas}: ${TOOLS.read_page} and
${TOOLS.get_screenshot} to see a page, ${TOOLS.apply_operations} to change it, ${TOOLS.focus} to show the user where you are,
${TOOLS.read_design_system}, ${TOOLS.list_components} and ${TOOLS.get_component} for what the design system offers.`,
  exportTokens: (which) =>
    `call ${handoffCall("export", tokensArgument(which))}: it writes the design's values into the stylesheets through the style system and moves the agreement`,
  finishStep: (
    step
  ) => `End by calling ${TOOLS.finish_setup_step} with a summary of a few lines: what you wrote, and what you
   were unsure of. The user reviews the step and goes on to the next one; ${step} is all this thread does.`,
  importTokens: (which) =>
    `call ${handoffCall("import", tokensArgument(which))}: it takes the code's values into the design`,
  linkBuilt: `mark it implemented: ${handoffCall("mark")}, target the page's id as listed and files,
   the repository files that draw it (the route's module, the screen's component, the components
   only it uses). A state's page is implemented by the same files as its page.`,
  markImplemented: (target) =>
    `mark it implemented: call ${handoffCall("mark")}, target ${target} and files, every repository file you wrote or changed for it. The editor then knows which code implements it, and tells the next implementation what changed.`,
  noteBehaviour: `write it down with ${handoffCall("note")}: on the node it belongs to, or on a component's spec (target spec:<Component>, node a slot)`,
  proposeWith: `${TOOLS.scan_design_system} has what the theme declares; ${TOOLS.ask_user} puts a card of questions to the user; ${TOOLS.write_design_system} saves the result.`,
  readComponent: `call ${TOOLS.get_component}`,
  readDesignSystem: () =>
    `${TOOLS.read_design_system} returns it with DESIGN.md`,
  readTheme: (
    stylesheets,
    before
  ) => `Call ${TOOLS.scan_design_system}. It reads the Tailwind v4 @theme blocks of the stylesheets the
   preview imports (${stylesheets}) and answers with a
   first design system, the files it read, and notes on what it could not interpret.${before}`,
  saveDesignSystem:
    () => `Save it with ${TOOLS.write_design_system}: \`designSystem\` is the design-system.json object and
   \`designMd\` the whole of DESIGN.md. ${TOOLS.get_document_format} with kind "design-system" has its JSON
   Schema. The tool validates both, puts the design system's values in DESIGN.md's front matter
   and tells you what is wrong; fix it and call it again. Do not write the two files by hand.`,
  settleTokens: `bring it over with ${handoffCall("export")} for the design's value or "import" for the code's, and tokens, their names`,
  tools: TOOLS,
};

const withoutTools: AgentWays = {
  askUser: "in your reply, ending your turn for the answers",
  changingDesigns:
    "Edit the .page.json files directly and keep them valid; every node needs a unique id.",
  editPages:
    () => `Edit the files above directly; the editor validates each one and reports what is wrong. The
page format: ${pageSchema()}`,
  exportTokens: () =>
    "write the design's value of each into the stylesheet where the token is declared (or have the user press Export in the Design system panel's Sync view, which does it)",
  finishStep:
    () => `End with a summary of a few lines: what you wrote, and what you were unsure of. The user marks
   the step done in the Setup view.`,
  importTokens: () =>
    "have the user take them into the design with the Take button of the Design system panel's Sync view",
  linkBuilt:
    "note its files: without the editor's MCP server the user marks each page in the inspector.",
  markImplemented: () =>
    "tell the user which files implement it, so they can mark it implemented in the editor.",
  noteBehaviour: "write it down as a comment on the node",
  proposeWith:
    "Without the editor's MCP server, read the code yourself, ask in the thread and write the files by hand.",
  readComponent: "read its code",
  readDesignSystem: (designsDir) =>
    `it is ${designsDir}/${DESIGN_SYSTEM_FILE}, every token's value in ${designsDir}/${DESIGN_TOKENS_FILE}, and ${DESIGN_MD_FILE} at the root of the repository`,
  readTheme: (stylesheets, before) =>
    `Read the stylesheets the preview imports (${stylesheets}) and
   their @theme blocks.${before}`,
  saveDesignSystem: (
    designsDir
  ) => `Write ${designsDir}/${DESIGN_SYSTEM_FILE}, valid against this JSON Schema:
   ${designSystemSchema()}
   and ${DESIGN_MD_FILE} at the root of the repository, without front matter: the editor fills in
   its tokens. Put every token's value in ${DESIGN_SYSTEM_FILE}, and delete
   ${designsDir}/${DESIGN_TOKENS_FILE} if there is one: the values the editor saved
   last are there, and they win over the ones you write.`,
  settleTokens:
    "have the user pick it in the Design system panel's Sync view, or write the design's value into the stylesheet where the token is declared",
  tools: null,
};

/** The ways of a server started with the editor's MCP server, or without it. */
export const agentWays = (mcp: boolean): AgentWays =>
  mcp ? withTools : withoutTools;
