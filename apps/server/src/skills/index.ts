/**
 * The design skills the tool ships, in the order agents are told them. One file per skill,
 * exporting its markdown: the heading is the title, the paragraph after it the summary.
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

import type { ToolNames } from "../services/threads/agent-ways.ts";
import { accessibility } from "./accessibility.ts";
import { borders } from "./borders.ts";
import { color } from "./color.ts";
import { components } from "./components.ts";
import { content } from "./content.ts";
import { elevation } from "./elevation.ts";
import { hierarchy } from "./hierarchy.ts";
import { iconography } from "./iconography.ts";
import { layout } from "./layout.ts";
import { motion } from "./motion.ts";
import { spacing } from "./spacing.ts";
import { states } from "./states.ts";
import { typography } from "./typography.ts";

interface BuiltInSkill {
  readonly name: string;
  readonly text: string;
}

/** The skills, naming the editor's tools when they are offered. */
export const builtInSkills = (
  tools: ToolNames | null
): readonly BuiltInSkill[] => [
  hierarchy,
  layout(tools),
  spacing,
  typography,
  color(tools),
  elevation,
  borders,
  iconography,
  motion,
  content,
  states,
  components(tools),
  accessibility,
];
