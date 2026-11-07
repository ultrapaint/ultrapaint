/**
 * The design skill the tool ships, `ultrapaint`: a router and one reference per part of a design
 * (`skills/ultrapaint/`, see `render.ts`). Each part is a built-in skill of its own here, told in
 * the order below: its heading is the title, the paragraph after it the summary.
 *
 * A project replaces one with `<designsDir>/skills/<name>.md`, and the settings turn any off
 * (`SkillsService`). A skill names the editor's tools only through `tools` (`AgentWays.tools`),
 * null without the MCP server, and says otherwise what to do without them; a project's own
 * file is left as it was written.
 *
 * Each rule lives in one part and the others leave it there: grouping by space is spacing's,
 * contrast thresholds accessibility's, the measure typography's, reduced motion motion's. Each part
 * names principles under headings, with exact values, and ends on a "Before you finish" table of
 * what to look for and what fixes it.
 */

import { hashContent } from "../hash.ts";
import type { ToolNames } from "../services/threads/agent-ways.ts";
import { designSkill } from "./design.generated.ts";

interface BuiltInSkill {
  readonly name: string;
  readonly text: string;
}

/** The order agents are told them in: what the screen is for first, the details after. */
const ORDER = [
  "character",
  "hierarchy",
  "restraint",
  "layout",
  "patterns",
  "spacing",
  "typography",
  "color",
  "elevation",
  "borders",
  "iconography",
  "motion",
  "content",
  "states",
  "usability",
  "components",
  "design-system",
  "picture",
  "accessibility",
] as const;

export const SKILL_ORDER: readonly string[] = ORDER;

/**
 * What a skill's markdown says the editor's tools change: "[with the editor's tools: … | without:
 * …]", so the same file reads whole to an agent elsewhere, which has not got them.
 */
const WAYS_RE =
  /\[with the editor's tools: ([\s\S]*?) \| without: ([\s\S]*?)\]/g;

/** A skill's text for an agent with the editor's tools or without them. */
export const withWays = (text: string, tools: ToolNames | null) =>
  text.replace(WAYS_RE, (_, withTools: string, without: string) =>
    tools ? withTools : without
  );

/**
 * The parts told whole with the router, in a briefing that tells the router: what every screen
 * needs. The others are read from `references/` when the agent reaches them.
 */
export const TOLD_WITH_ROUTER: ReadonlySet<string> = new Set([
  "character",
  "hierarchy",
  "restraint",
]);

/** Told with the router too when the thread's task makes the design system. */
export const TOLD_WHEN_MAKING_THE_SYSTEM = "design-system";

/** The router, naming the editor's tools when they are offered. */
export const routerText = (tools: ToolNames | null) =>
  withWays(designSkill.router, tools);

// Each has its reference: `skills.test.ts` holds the two in step.
/** The parts, naming the editor's tools when they are offered. */
export const builtInSkills = (
  tools: ToolNames | null
): readonly BuiltInSkill[] =>
  ORDER.flatMap((name) => {
    const text = designSkill.sections[name];
    return text === undefined ? [] : [{ name, text: withWays(text, tools) }];
  });

/** Every file of the skill's `references/`, by its path there, for agents to read when they need it. */
export const skillReferences: Readonly<Record<string, string>> =
  designSkill.references;

/**
 * Where this machine keeps the skills' references written out for agents to read: the user's
 * cache, one directory per version of them, so two versions of the tool do not mix theirs. The
 * agent sandbox lets agents read it.
 */
export const referencesDirOf = (
  home: string,
  join: (...parts: string[]) => string
) =>
  join(
    home,
    ".cache",
    "ultrapaint",
    "skills",
    hashContent(JSON.stringify(skillReferences))
  );

/**
 * The folder of `referencesDirOf` that holds the references worded for an agent with the
 * editor's tools or without them: what an agent opens there reads as what it is told.
 */
export const referencesFor = (
  dir: string,
  join: (...parts: string[]) => string,
  tools: ToolNames | null
) => join(dir, tools ? "with-tools" : "without-tools");

/**
 * How the skill names a file of its references (`` `references/layout.md` ``); the briefing names the
 * folder they are written to instead.
 */
export const REFERENCES_MENTION = "`references/";

/** A text of the skill, each file of its references named where `dir` holds them. */
export const naming = (text: string, dir: string) =>
  text.replaceAll(REFERENCES_MENTION, `\`${dir}/`);

/**
 * Every file of the references as an agent reads it from `dir`: worded for the tools it has, and
 * each file it names named where `dir` holds it.
 */
export const referencesAt = (dir: string, tools: ToolNames | null) =>
  Object.entries(skillReferences).map(
    ([file, text]) => [file, naming(withWays(text, tools), dir)] as const
  );
