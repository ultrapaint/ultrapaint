/**
 * What every task is written with (`tasks.ts`): what the user adds, why a request cannot be a
 * task, and the formats an agent writes without the editor's tools.
 */
import { DesignSystem } from "@ultrapaint/contracts/design-system";
import { type DesignNode, PageDocument } from "@ultrapaint/contracts/document";
import { outlineOf } from "@ultrapaint/design-document/tree";
import { Schema } from "effect";
import { compactSchema } from "./compact-schema.ts";

/**
 * Why a request cannot be a task: what it names is not there, or it needs what this server or
 * project does not have. `message` reads after "but" in a sentence and on its own as a tool's
 * answer (`there is no canvas "nowhere"; the canvases are …`). `next` is what an agent the user
 * asked tells them; a failure without one (no project open) is not the user's to mend.
 */
export class TaskFailure extends Schema.TaggedError<TaskFailure>()(
  "TaskFailure",
  {
    /** The slash command the request is, without its slash: `implement`. */
    command: Schema.String,
    message: Schema.String,
    next: Schema.optional(Schema.String),
  }
) {}

/** A failure of a task's own: what the user ran cannot be done as asked, and what to tell them. */
export const taskFailure = (command: string, message: string, next: string) =>
  new TaskFailure({ command, message, next });

/** A task that works only through the editor's MCP server, on a server started without it. */
export const needsTools = (
  command: string,
  what: string,
  next = "Tell the user to start it with MCP on, and stop."
) =>
  taskFailure(
    command,
    `${what} works through the editor's MCP server, and the server was started without it`,
    next
  );

/** The design system's schema, for an agent that has to write the file without the tools. */
export const designSystemSchema = () =>
  JSON.stringify(compactSchema(Schema.toJsonSchemaDocument(DesignSystem)));

/** The page format's schema, for agents. */
export const pageSchema = () =>
  JSON.stringify(compactSchema(Schema.toJsonSchemaDocument(PageDocument)));

/** Past this many characters of compact JSON, a tree is given as its outline. */
const WHOLE_LIMIT = 40_000;
/** How deep the outline of a tree too big to give whole goes. */
export const OUTLINE_DEPTH = 3;

/**
 * A tree of a design as an agent reads it, a task or `read_page` alike: whole while its compact
 * JSON fits, else its outline `OUTLINE_DEPTH` levels down (a node there counts its children), to
 * be read a part at a time; `depth` asks for an outline that deep. `outlined` says which it is.
 */
export const treeForAgent = (
  tree: DesignNode,
  depth?: number
): { readonly outlined: boolean; readonly tree: DesignNode } => {
  if (depth !== undefined) {
    return { outlined: true, tree: outlineOf(tree, Math.floor(depth)) };
  }
  return JSON.stringify(tree).length > WHOLE_LIMIT
    ? { outlined: true, tree: outlineOf(tree, OUTLINE_DEPTH) }
    : { outlined: false, tree };
};

/** What the user typed after the command's argument, passed on as it is. */
export const userAdds = (extra: string | undefined) =>
  extra ? `\nThe user adds:\n${extra}\n` : "";

/**
 * How an agent writes DESIGN.md (ADR 0027): the open format's sections in its order, and what goes
 * in each. Every task that has an agent write the document says this, in these words.
 */
export const DESIGN_MD_GUIDE = `DESIGN.md is the design system in the open format (github.com/google-labs-code/design.md), at the
root of the repository, where every agent and person reads it, in the editor or not. Its front
matter's token groups (colors, typography, rounded, spacing) are filled in from the design system:
what you write is the prose. The body is these \`##\` sections, in this order; leave one out only when there
is nothing to say:
   - Overview: what the product is and for whom, its voice and tone, and its look as a specific
     reference rather than adjectives ("a printed lecture handout", not "clean and modern"): its
     character, in the user's words where they gave them, and its dials in one line (temperature,
     density, shape, accent).
   - Colors: what each colour is for, named as its token ({colors.primary}), and how dark mode
     differs.
   - Typography: the families, and which text style ({typography.heading-xl}) is for what.
   - Layout: the grid, the spacing scale, how much room things get, the breakpoints.
   - Elevation & Depth: how layers are told apart: surfaces, shadows, borders.
   - Shapes: the radii ({rounded.md}) and where each goes.
   - Components: which component to use for what, and what each variant is for.
   - Do's and Don'ts: the rules, short and specific, what to avoid among them.
   Short and specific: a named reference carries more than a list of adjectives.`;
