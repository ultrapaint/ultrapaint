/**
 * How an agent does what a task or the briefing asks of it, with the editor's MCP server or
 * without it: each capability written once, both ways, so the texts say "mark it implemented"
 * or "bring the tokens over" in the same words wherever they ask for it. The `handoff` tool's
 * actions are named here too, for its schema (`mcp/handoff-tools.ts`) and every text that tells
 * an agent to call it.
 */
import {
  DESIGN_MD_FILE,
  DESIGN_SYSTEM_FILE,
} from "@ultrapaint/contracts/design-system";
import { DESIGN_TOKENS_FILE } from "../dtcg.ts";
import { designSystemSchema, pageSchema } from "./task-text.ts";

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

/** A call of `handoff` as a text asks for it: `handoff with action "export" and tokens […]`. */
export const handoffCall = (action: HandoffAction, args?: string) =>
  `handoff with action "${action}"${args ? ` and ${args}` : ""}`;

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
  /** `/init`'s first step: what the theme declares. `before` is what the tools say of earlier work. */
  readonly readTheme: (stylesheets: string, before: string) => string;
  /** Saving the design system with DESIGN.md, and the formats it is written in. */
  readonly saveDesignSystem: (designsDir: string) => string;
  /** Settling a token changed on both sides, once the user said which value to keep. */
  readonly settleTokens: string;
  /** Whether the editor's tools are there: what only they can do is refused without them. */
  readonly tools: boolean;
}

const withTools: AgentWays = {
  changingDesigns: `The "ultrapaint" MCP server is the editor itself. Change designs through it: read_page
and read_canvas return a document with its ids, apply_operations changes it (insert, remove,
move, update, setProps, wrap, unwrap, duplicate) — validated, shown on the canvas at once and
undoable by the user. create_page adds a page (from a template of list_templates), rename_page
renames it, duplicate_page copies it, delete_page deletes it with its variants, set_page_url sets
or takes off its URL, and set_frame sizes its frame on the canvas (a long page needs a tall one to
be seen whole). create_canvas makes a canvas, copy_pages copies or moves pages into another,
set_home says which URL its prototype opens on, and list_links finds the links that lead
nowhere — run it after changing URLs or deleting pages. Ask
get_component for a component's props and an instance to start from, get_document_format for
the whole format. list_comments, reply_to_comment and resolve_comment answer the user where
they asked, and focus tells the canvas which page you are on so the user can watch you work;
before changing nodes, pass their ids to focus as nodes with a few words as action, and the
canvas shows your work on them. Tools name a page by its URL, or by its file when it has none.
A node reference such as /orders#c_8x2k1q (or drafts.page.json#c_8x2k1q), which the user may
paste, is a page and a node id.
After a change, get_screenshot shows you the page or a node as it draws: look, and fix what is off.
When a decision is the user's, ask_user puts your questions to them as a card with answers to
pick, and its result is their answers. Only if it says the questions were shown instead, end your
turn: the answers come as the next message.
Prefer these to editing the JSON files yourself; if you do write a file, keep it valid.`,
  editPages: (
    canvas
  ) => `Through the ultrapaint MCP server, always passing canvas: ${canvas}: read_page and
get_screenshot to see a page, apply_operations to change it, focus to show the user where you are,
read_design_system, list_components and get_component for what the design system offers.`,
  exportTokens: (which) =>
    `call ${handoffCall("export", tokensArgument(which))}: it writes the design's values into the stylesheets through the style system and moves the agreement`,
  finishStep: (
    step
  ) => `End by calling finish_setup_step with a summary of a few lines: what you wrote, and what you
   were unsure of. The user reviews the step and goes on to the next one; ${step} is all this thread does.`,
  importTokens: (which) =>
    `call ${handoffCall("import", tokensArgument(which))}: it takes the code's values into the design`,
  linkBuilt: `mark it implemented: ${handoffCall("mark")}, target the page's id as listed and files,
   the repository files that draw it (the route's module, the screen's component, the components
   only it uses). A state's page is implemented by the same files as its page.`,
  markImplemented: (target) =>
    `mark it implemented: call ${handoffCall("mark")}, target ${target} and files, every repository file you wrote or changed for it. The editor then knows which code implements it, and tells the next implementation what changed.`,
  noteBehaviour: `write it down with ${handoffCall("note")}: on the node it belongs to, or on a component's spec (target spec:<Component>, node a slot)`,
  proposeWith:
    "scan_design_system has what the theme declares; ask_user puts a card of questions to the user; write_design_system saves the result.",
  readTheme: (
    stylesheets,
    before
  ) => `1. Call scan_design_system. It reads the Tailwind v4 @theme blocks of the stylesheets the
   preview imports (${stylesheets}) and answers with a
   first design system, the files it read, and notes on what it could not interpret.${before}`,
  saveDesignSystem:
    () => `4. Save it with write_design_system: \`designSystem\` is the design-system.json object and
   \`designMd\` the whole of DESIGN.md. get_document_format with kind "design-system" has its JSON
   Schema. The tool validates both, puts the design system's values in DESIGN.md's front matter
   and tells you what is wrong; fix it and call it again. Do not write the two files by hand.`,
  settleTokens: `bring it over with ${handoffCall("export")} for the design's value or "import" for the code's, and tokens, their names`,
  tools: true,
};

const withoutTools: AgentWays = {
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
  readTheme: (stylesheets) =>
    `1. Read the stylesheets the preview imports (${stylesheets}) and
   their @theme blocks.`,
  saveDesignSystem: (
    designsDir
  ) => `4. Write ${designsDir}/${DESIGN_SYSTEM_FILE}, valid against this JSON Schema:
   ${designSystemSchema()}
   and ${DESIGN_MD_FILE} at the root of the repository, without front matter: the editor fills in
   its tokens. Put every token's value in ${DESIGN_SYSTEM_FILE}, and delete
   ${designsDir}/${DESIGN_TOKENS_FILE} if there is one: the values the editor saved
   last are there, and they win over the ones you write.`,
  settleTokens:
    "have the user pick it in the Design system panel's Sync view, or write the design's value into the stylesheet where the token is declared",
  tools: false,
};

/** The ways of a server started with the editor's MCP server, or without it. */
export const agentWays = (mcp: boolean): AgentWays =>
  mcp ? withTools : withoutTools;
