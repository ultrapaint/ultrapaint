/**
 * The design skills the tool ships, in the order agents are told them. One file per skill,
 * exporting its markdown: the heading is the title, the paragraph after it the summary.
 *
 * A project replaces one with `<designsDir>/skills/<name>.md`, and the settings turn any off
 * (`SkillsService`).
 */
import { color } from "./color.ts";
import { components } from "./components.ts";
import { content } from "./content.ts";
import { hierarchy } from "./hierarchy.ts";
import { spacing } from "./spacing.ts";
import { typography } from "./typography.ts";

export interface BuiltInSkill {
  readonly name: string;
  readonly text: string;
}

export const builtInSkills: readonly BuiltInSkill[] = [
  hierarchy,
  spacing,
  typography,
  color,
  content,
  components,
];
