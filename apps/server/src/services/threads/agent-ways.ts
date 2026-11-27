/**
 * How an agent does what a task or the briefing asks of it, with the editor's MCP server or
 * without it: each capability written once, both ways, so the texts say "mark it implemented"
 * or "bring the tokens over" in the same words wherever they ask for it. A text names one of the
 * editor's tools only through here: in a capability's words, or by `tools`, the tools' own names,
 * which is null without the server. The `handoff` tool's actions are named here too, for its
 * schema (`mcp/handoff-tools.ts`) and every text that tells an agent to call it.
 */
import { COMPONENTS_DIR } from "@ultrapaint/contracts/components";
import {
  DESIGN_MD_FILE,
  DESIGN_SYSTEM_FILE,
} from "@ultrapaint/contracts/design-system";
import type { Toolkit } from "effect/ai";
import { DESIGN_TOKENS_FILE } from "../dtcg.ts";
import type { AskUser } from "../mcp/ask-user.ts";
import type { EditorTools } from "../mcp/route.ts";
import type { GetScreenshot } from "../mcp/screenshot.ts";
import { systemParts } from "./agent-docs.ts";
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
  "change",
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

/** How a step looks at the running screen, worded alike with the editor's tools and without. */
const SEE_RUNNING_SCREEN = `Where you can see the running application, in a browser or a view at a width of it, look at
   the screen that serves each page at the widths the page is drawn for, and draw what the code
   leaves to runtime (its data, sizes and states) as the screen shows it`;

/**
 * The rule for an agent with the tools (UP-232): designs change only through them, a design file
 * is read but never written, and what no tool can do is said, never scripted. The briefing and
 * the MCP server's instructions both say it, in these words.
 */
export const ONLY_THROUGH_TOOLS = `never write a *.page.json, *.component.json or canvas.json yourself,
by hand or with a script, not even to fix one; read one when a tool's answer is not enough. When no
tool can do what was asked, say so in your reply, naming what, and leave the files as they are.`;

/** One part's style at a place of a system component's look, as `ComponentChange` writes it. */
export const SET_STYLE = `{op:"setStyle", place:{variant:{axis, member}|null, state|null}, slot, style}`;

/**
 * The changes `handoff`'s "change" takes of a system component's look, as `ComponentChange`
 * writes them: what the briefing and a task list, so the tool's own description stays short
 * (ADR 0122).
 */
const LOOK_CHANGES = `${SET_STYLE}, {op:"setHidden", part, hidden},
   {op:"setContent", slot, nodes}, {op:"setItem", item}`;

/** The changes it takes of an app component's properties and slots, and of either's look. */
const COMPONENT_CHANGES = `an app component's {op:"addProperty", property}, {op:"setProperty", name, default?, members?, targets?},
   {op:"renameProperty", name, to}, {op:"removeProperty", name}, {op:"renameMember", property, member, to},
   {op:"addSlot", slot}, {op:"removeSlot", name}, {op:"defaultSlot", name}; a system component's look
   ${LOOK_CHANGES}`;

export interface AgentWays {
  /**
   * Asking the user what is theirs to decide, and waiting for the answers: a phrase after "ask
   * the user" or "put them to the user".
   */
  readonly askUser: string;
  /**
   * Reading and changing an app component's tree, and making one of a page's nodes (UP-230): the
   * briefing's paragraph; nothing without the tools, where the tree is written in its file.
   */
  readonly changeAppComponent: string;
  /**
   * Changing a component's properties, members and slots, or a system component's look, so that a
   * rename follows into every instance (ADR 0122): a step's text.
   */
  readonly changeComponent: string;
  /**
   * Changing a system component's look once rather than on each instance (UP-227): the
   * briefing's paragraph.
   */
  readonly changeLook: string;
  /**
   * The briefing's paragraph on changing designs: with the tools, only through them, never by
   * writing a design file (UP-232).
   */
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
  /** How a component brought up to date is linked to the files that draw it: a clause after a comma. */
  readonly linkComponent: string;
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
  /**
   * Looking at the running application's screen to draw a page as it shows (ADR 0115), in the
   * design skill's words for what an agent may have (a browser, a view at a width): a step's text.
   */
  readonly seeRunningScreen: string;
  /**
   * Setting the looks of the system components a step names to the product's (UP-226): a clause
   * after a comma, "each" the component.
   */
  readonly setLooks: (designsDir: string) => string;
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
  changeAppComponent: `Read an app component's tree with ${TOOLS.read_page} and change it with ${TOOLS.apply_operations} as a page's,
route component:<Name> (a node of it: component:<Name>#id). It is the main component, which every
instance draws: change it only when the user asked for the change everywhere, else the layers of the
instance they mean. A part shared by pages that is no component yet: build it on a page that uses it,
then make it one there with {op:"makeComponent", ids, name}.
`,
  changeComponent: `Change an app component's properties, members and slots, and a system component's look, one
   change at a time with ${handoffCall("change")}, target the component as listed and change one of
   ${COMPONENT_CHANGES}.
   A property or a member renamed there follows into every instance's props, on the pages and in
   the trees of app components that place it, in the same undo step. An app component's tree
   changes with ${TOOLS.read_page} and ${TOOLS.apply_operations}, route component:<Name>.`,
  changeLook: `Change a system component's look once, never on each instance: one change at a time with
${handoffCall("change")}, target component:<Name> and change one of ${LOOK_CHANGES}.
${TOOLS.get_component} answers its parts (? those it may leave out), its states and its look: a style is
the part's whole style at its place (the base, a variant member, a state, or a state in a member),
so start from what the look has there. A part, a member or a state it lacks is refused with the
ones it has. A first change starts its file from the default look; each change is one undo step,
drawn on every instance at once.`,
  changingDesigns: `The "ultrapaint" MCP server is the editor itself: change designs only through its tools, validated,
shown on the canvas at once and undoable by the user, and ${ONLY_THROUGH_TOOLS}
${TOOLS.set_frame} sizes and moves frames, ${TOOLS.apply_operations} changes a page's tree or an app component's, and
${handoffCall("change")} a component's properties and a system component's look. Tools name a page by
its URL, or its file when it has none; a node reference the user pastes (/orders#c_8x2k1q,
drafts.page.json#c_8x2k1q) is a page and a node id. Before changing
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
  linkComponent: `mark it implemented: ${handoffCall("mark")}, target the component as listed and
   files, the repository files that draw it (its module, and the parts only it uses).`,
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
  seeRunningScreen: `${SEE_RUNNING_SCREEN}; ${TOOLS.get_screenshot} shows the page as you
   redraw it, at the same widths, to compare. Where you can see neither, update the page from
   the code alone.`,
  setLooks:
    () => `each through ${handoffCall("change")}, target component:<Name>, one change
   at a time: ${SET_STYLE}.
   A style is the part's whole style at its place, so start from the look ${TOOLS.get_component} answers
   there; a change it refuses names the parts, members and states the component has`,
  settleTokens: `bring it over with ${handoffCall("export")} for the design's value or "import" for the code's, and tokens, their names`,
  tools: TOOLS,
};

const withoutTools: AgentWays = {
  askUser: "in your reply, ending your turn for the answers",
  changeAppComponent: "",
  changeComponent: `Write each component's file directly, and keep it valid. A property or a member the code
   renamed: rename it in the props of its instances too, on the pages that place it and in the
   trees of app components that place it, and take it out of them where the code took it out, or
   they break.`,
  changeLook: `Change a system component's look once, in its file, never on each instance; a field the file
leaves out keeps the default look's. A look styles only its component's parts (? those it may
leave out) and states; a file that styles another does not read, and the component is drawn in
its default look:
${systemParts()}`,
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
  linkComponent:
    "note its files and tell the user them: a component is marked implemented through the editor's MCP server.",
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
  seeRunningScreen: `${SEE_RUNNING_SCREEN}. Where you can see neither, update the page from the
   code alone.`,
  setLooks: (
    designsDir
  ) => `each in its file, ${designsDir}/${COMPONENTS_DIR}/<Name>.component.json (origin "system"; a
   field it leaves out keeps the default look's). A look styles only its component's parts (? those
   it may leave out) and states; a file that styles another does not read:
${systemParts().replaceAll(/^/gm, "   ")}`,
  settleTokens:
    "have the user pick it in the Design system panel's Sync view, or write the design's value into the stylesheet where the token is declared",
  tools: null,
};

/** The ways of a server started with the editor's MCP server, or without it. */
export const agentWays = (mcp: boolean): AgentWays =>
  mcp ? withTools : withoutTools;
