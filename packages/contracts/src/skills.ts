/**
 * Design skills: the craft guidance every agent is told before it designs. Hierarchy, layout,
 * spacing, type, colour, elevation, borders, icons, motion, content, states, components,
 * accessibility: what applies to any product, as opposed to `DESIGN.md`, which is this
 * product's own conventions and comes after them.
 *
 * The tool ships a set. A project puts a markdown file with the same name in
 * `<designsDir>/skills/` to replace one, or to extend it when the file opens with the front
 * matter `extends: true`; a file with any other name is a skill of its own; and the settings turn
 * any of them off. The file is the skill: its first heading is the title, the paragraph after it
 * the summary the settings show.
 */
import { Schema } from "effect";

/** Directory of a project's own skills, inside the designs directory. */
export const SKILLS_DIR = "skills";
export const SKILL_EXTENSION = ".md";

export const SkillSource = Schema.Literals(["built-in", "project"]);
export type SkillSource = typeof SkillSource.Type;

export const Skill = Schema.Struct({
  /** Off in the settings: agents are not told it. */
  enabled: Schema.Boolean,
  /** A project file that follows the built-in of the same name rather than replacing it. */
  extends: Schema.Boolean,
  /** Repo-relative path of the file, for a project skill. */
  file: Schema.optional(Schema.String),
  /** The file's stem: `spacing`. What the settings' `skills.disabled` names. */
  name: Schema.String,
  source: SkillSource,
  /** The first paragraph after the title, or the first line when there is no title. */
  summary: Schema.String,
  /** The whole markdown, title included, as agents are told it. */
  text: Schema.String,
  title: Schema.String,
});
export type Skill = typeof Skill.Type;

export const SkillList = Schema.Struct({
  /** Where a project's own skills go, relative to the repository. */
  dir: Schema.String,
  skills: Schema.Array(Skill),
});
export type SkillList = typeof SkillList.Type;

/** The skills part of the settings: which ones are not sent to agents. */
export const SkillsConfig = Schema.Struct({
  disabled: Schema.optional(Schema.Array(Schema.String)),
});
export type SkillsConfig = typeof SkillsConfig.Type;

/** What a project file may do to the built-in of the same name. */
export const CustomiseMode = Schema.Literals(["replace", "extend"]);
export type CustomiseMode = typeof CustomiseMode.Type;

const FRONT_MATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const EXTENDS_RE = /^extends:\s*true\s*$/m;

/** The front matter a skill file may open with, and the markdown after it. */
export const parseSkillFile = (
  text: string
): { readonly body: string; readonly extends: boolean } => {
  // Typed by hand: the linter otherwise takes the result for non-null.
  const match: RegExpExecArray | null = FRONT_MATTER_RE.exec(text);
  if (match === null) {
    return { body: text, extends: false };
  }
  const [whole, front = ""] = match;
  return { body: text.slice(whole.length), extends: EXTENDS_RE.test(front) };
};

const TITLE_RE = /^#\s+(.+?)\s*$/;

/** What a skill's markdown says about itself, the same way for a shipped one and a file. */
export const describeSkill = (
  name: string,
  text: string
): { readonly summary: string; readonly title: string } => {
  const lines = text.split("\n");
  const titleAt = lines.findIndex((line) => TITLE_RE.test(line));
  const heading: RegExpExecArray | null =
    titleAt >= 0 ? TITLE_RE.exec(lines[titleAt] ?? "") : null;
  const title = heading?.[1] ?? name;
  const rest = lines.slice(titleAt + 1);
  const start = rest.findIndex((line) => line.trim() !== "");
  if (start < 0) {
    return { summary: "", title };
  }
  const paragraph: string[] = [];
  for (const line of rest.slice(start)) {
    if (line.trim() === "") {
      break;
    }
    paragraph.push(line.trim());
  }
  return { summary: paragraph.join(" "), title };
};
