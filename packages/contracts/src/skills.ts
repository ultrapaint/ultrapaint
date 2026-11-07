/**
 * Design skills: the craft guidance every agent is told before it designs, what applies to any
 * product, as opposed to `DESIGN.md`, which is this product's own conventions and comes after
 * them.
 *
 * The tool ships one, the design skill `ultrapaint`: its core (`SKILL.md`, every rule and the
 * steps) and its references (`references/…`, read when the core sends the agent there). A project
 * adds skills of its own as markdown files in `<designsDir>/skills/`, each told whole, and the
 * settings turn any of them off, the design skill included. The file is the skill: its first
 * heading is the title, the paragraph after it the summary the settings show.
 */
import { Schema } from "effect";

/** Directory of a project's own skills, inside the designs directory. */
export const SKILLS_DIR = "skills";
export const SKILL_EXTENSION = ".md";

const SkillSource = Schema.Literals(["built-in", "project"]);

export const Skill = Schema.Struct({
  /** Off in the settings: agents are not told it. */
  enabled: Schema.Boolean,
  /** Repo-relative path of the file, for a project skill. */
  file: Schema.optional(Schema.String),
  /** `ultrapaint` for the design skill, a file's stem for a project's: what `skills.disabled` names. */
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

/** The design skill the tool ships, by the name the settings turn it off with. */
export const DESIGN_SKILL = "ultrapaint";

/** The MCP resources' root: the design skill's files are under it as they are in its folder. */
export const SKILL_ROOT_URI = `skill://${DESIGN_SKILL}`;

/**
 * Where an agent with the editor's tools reads a skill as an MCP resource: a project's skill by
 * its name (`skill://ultrapaint/voice`), a file of the design skill by its path in it
 * (`skill://ultrapaint/SKILL.md`, `skill://ultrapaint/references/kinds/dialog.md`).
 */
export const skillUri = (nameOrPath: string) =>
  `${SKILL_ROOT_URI}/${nameOrPath}`;

/**
 * How a design thread's briefing tells the skills: the design skill's core whole, its references
 * read as the core sends the agent to them (`router`, the default, ADR 0048); the core and every
 * reference whole (`full`); or each skill by its title and summary with where to read it whole
 * (`summaries`), which an agent does before the work a skill is about. A project's own skills
 * are told whole but at `summaries`.
 */
export const SkillsBriefing = Schema.Literals(["full", "summaries", "router"]);
export type SkillsBriefing = typeof SkillsBriefing.Type;

/** The skills part of the settings: which ones are not sent to agents, and how the rest are. */
export const SkillsConfig = Schema.Struct({
  /** `router` when absent. */
  briefing: Schema.optional(SkillsBriefing),
  disabled: Schema.optional(Schema.Array(Schema.String)),
});
export type SkillsConfig = typeof SkillsConfig.Type;

const FRONT_MATTER_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;

/** A skill file's markdown after the front matter it may open with. */
export const parseSkillFile = (text: string): { readonly body: string } => ({
  body: text.replace(FRONT_MATTER_RE, ""),
});

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
