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
import type { EditorTools } from "../mcp/route.ts";
import type { GetScreenshot } from "../mcp/screenshot.ts";
import { designSystemSchema, pageSchema } from "./task-text.ts";

/** A tool the editor's MCP server offers, by the name its definition (`Tool.make`) gives it. */
type ToolName =
  | keyof Toolkit.Tools<typeof EditorTools>
  | (typeof AskUser)["name"]
  | (typeof GetScreenshot)["name"];

/** The editor's tools, each by its own name: a text writes `${tools.ask_user}`. */
export type ToolNames = { readonly [N in ToolName]: N };

/**
 * Every tool the server offers, each by its name: a text writes `${TOOLS.read_page}`, and one
 * renamed or taken out fails to compile where a text names it. The names are the toolkits' own
 * (`ToolName`), so nothing lists them again: each reads as the name it is asked for. A text an
 * agent may read without the server takes them from `AgentWays.tools`; what a tool answers, and
 * what the MCP server tells its clients, only an agent with the tools reads, and names them here.
 */
export const TOOLS: ToolNames = new Proxy({} as ToolNames, {
  get: (_, name) => (typeof name === "string" ? name : undefined),
});

/** The actions of the `handoff` tool. */
export const HANDOFF_ACTIONS = [
  "list",
  "read",
  "mark",
  "note",
  "export",
  "import",
] as const;
type HandoffAction = (typeof HANDOFF_ACTIONS)[number];

/**
 * A call of `handoff` as a text asks for it: `handoff with action "export" and tokens […]`. Also
 * for what the tool answers, which only an agent with the tools reads.
 */
export const handoffCall = (action: HandoffAction, args?: string) =>
  `${TOOLS.handoff} with action "${action}"${args ? ` and ${args}` : ""}`;

/** Which tokens a step brings over: these, the ones the text just listed, or all that wait. */
type TokensNamed = readonly string[] | "named" | "all";

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
  changingDesigns: `The "ultrapaint" MCP server is the editor itself: change designs with its tools, validated, shown on
the canvas at once and undoable by the user, rather than by editing the JSON (a file you write
must stay valid). Tools name a page by its URL, or its file when it has none; a node reference the
user pastes (/orders#c_8x2k1q, drafts.page.json#c_8x2k1q) is a page and a node id. Before changing
nodes, pass their ids to ${TOOLS.focus} with a few words as action, so the user watches you work;
after, look with ${TOOLS.get_screenshot} and fix what is off. ${TOOLS.read_page} reads a big page an outline
first (depth) and a part at a time (node). A decision that is the user's goes to ${TOOLS.ask_user}: its
result is their answers, unless it says they were shown, when you end your turn.`,
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
  noteBehaviour: `write it down with ${handoffCall("note")}: on the node it belongs to, or on a component (target component:<Name>, node a part)`,
  proposeWith: `${TOOLS.scan_design_system} has what the theme declares; ${TOOLS.ask_user} puts a card of questions to the user; ${TOOLS.write_design_system} saves the result.`,
  readDesignSystem: () =>
    `${TOOLS.read_design_system} returns it with DESIGN.md`,
  readTheme: (
    stylesheets,
    before
  ) => `Call ${TOOLS.scan_design_system}. It reads the Tailwind v4 @theme blocks of the stylesheets the
   code's tokens are in (${stylesheets}) and answers with a first design system, the files it
   read, and notes on what it could not interpret.${before}`,
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
  readDesignSystem: (designsDir) =>
    `it is ${designsDir}/${DESIGN_SYSTEM_FILE}, every token's value in ${designsDir}/${DESIGN_TOKENS_FILE}, and ${DESIGN_MD_FILE} at the root of the repository`,
  readTheme: (stylesheets, before) =>
    `Read the stylesheets the code's tokens are in (${stylesheets})
   and their @theme blocks.${before}`,
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
