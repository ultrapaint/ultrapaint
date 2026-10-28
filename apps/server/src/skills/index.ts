/**
 * The design skills the tool ships, in the order agents are told them. Their source is
 * `skills/design/<name>/SKILL.md` at the repository's root (see `render.ts`): the heading is the
 * title, the paragraph after it the summary.
 *
 * A project replaces one with `<designsDir>/skills/<name>.md`, and the settings turn any off
 * (`SkillsService`). A skill names the editor's tools only through `tools` (`AgentWays.tools`),
 * null without the MCP server, and says otherwise what to do without them; a project's own
 * file is left as it was written.
 *
 * Agents are told them all at once, so each rule lives in one skill and the others leave it
 * there: grouping by space is spacing's, contrast thresholds accessibility's, the measure
 * typography's, reduced motion motion's. Each skill names principles under headings, with exact
 * values, and ends on a "Before you finish" table of what to look for and what fixes it.
 */

import { hashContent } from "../hash.ts";
import type { ToolNames } from "../services/threads/agent-ways.ts";
import { designSkills } from "./design.generated.ts";

interface BuiltInSkill {
  readonly name: string;
  readonly text: string;
}

/** The order agents are told them in: what the screen is for first, the details after. */
const ORDER = [
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
const WAYS_RE = /\[with the editor's tools: ([\s\S]*?) \| without: ([\s\S]*?)\]/g;

/** A skill's text for an agent with the editor's tools or without them. */
export const withWays = (text: string, tools: ToolNames | null) =>
  text.replace(WAYS_RE, (_, withTools: string, without: string) =>
    tools ? withTools : without
  );

// Each has its folder: `skills.test.ts` holds the two in step.
/** The skills, naming the editor's tools when they are offered. */
export const builtInSkills = (
  tools: ToolNames | null
): readonly BuiltInSkill[] =>
  ORDER.flatMap((name) => {
    const skill = designSkills[name];
    return skill === undefined
      ? []
      : [{ name, text: withWays(skill.text, tools) }];
  });

/** The files a built-in skill has agents read when they need them, by skill and file name. */
export const skillReferences: Readonly<
  Record<string, Readonly<Record<string, string>>>
> = Object.fromEntries(
  Object.entries(designSkills).flatMap(([name, skill]) =>
    Object.keys(skill.references).length > 0 ? [[name, skill.references]] : []
  )
);

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

/** How a skill names its references folder; the briefing gives the folder written out instead. */
export const REFERENCES_MENTION = "`references/`";
