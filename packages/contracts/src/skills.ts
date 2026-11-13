/**
 * Design skills: the craft guidance every agent is told before it designs, what applies to any
 * product, as opposed to `DESIGN.md`, which is this product's own conventions and comes after
 * them.
 *
 * The tool ships one, the design skill `ultrapaint`: its core (`SKILL.md`, every rule and the
 * steps) and its references (`references/…`, read when the core sends the agent there), on unless
 * the settings turn it off. A project may hold skills of its own (ADR 0094): a markdown file in
 * `<designsDir>/skills/`, or a folder with a `SKILL.md` in `.claude/skills/`, `.agents/skills/` or
 * `skills/`, each found and listed, and told only once the settings turn it on. A skill's title and
 * summary are its front matter's `name` and `description`, else its first heading and the
 * paragraph after it.
 */
import { Schema } from "effect";

/** Directory of a project's own skill files, inside the designs directory. */
export const SKILLS_DIR = "skills";
export const SKILL_EXTENSION = ".md";

/**
 * Where agents' skill folders are kept in a repository, each skill a folder with its `SKILL.md`:
 * Claude Code's, the open Agent Skills' and a plain `skills/`.
 */
export const SKILL_FOLDERS = [
  ".claude/skills",
  ".agents/skills",
  "skills",
] as const;

/** The file a skill folder is told by. */
export const SKILL_FILE = "SKILL.md";

const SkillSource = Schema.Literals(["built-in", "project"]);

export const Skill = Schema.Struct({
  /** On in the settings: agents are told it. */
  enabled: Schema.Boolean,
  /**
   * Repo-relative path of the file a project skill is told by (its `.md`, or a folder's
   * `SKILL.md`): what `skills.enabled` names.
   */
  file: Schema.optional(Schema.String),
  /**
   * `ultrapaint` for the design skill; a project skill's file stem or folder name, numbered when
   * two share one: its MCP resource's name.
   */
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

/**
 * The skills part of the settings, the project's defaults for its chats: the project's own skills
 * that are told (none when absent), whether the design skill is not, and how they are told.
 */
export const SkillsConfig = Schema.Struct({
  /** `router` when absent. */
  briefing: Schema.optional(SkillsBriefing),
  /** `ultrapaint` here turns the design skill off. */
  disabled: Schema.optional(Schema.Array(Schema.String)),
  /** The project's own skills told to its chats, by their files' repo-relative paths. */
  enabled: Schema.optional(Schema.Array(Schema.String)),
});
export type SkillsConfig = typeof SkillsConfig.Type;

const FRONT_MATTER_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;

/** A skill file's markdown after the front matter it may open with. */
export const parseSkillFile = (text: string): { readonly body: string } => ({
  body: text.replace(FRONT_MATTER_RE, ""),
});

const TITLE_RE = /^#\s+(.+?)\s*$/;
const FIELD_RE = /^([A-Za-z_-]+):\s*(.*)$/;
const LINE_BREAK_RE = /\r?\n/;
const INDENTED_RE = /^\s+\S/;
/** A front matter value folded or kept over the lines after it, or none on its line. */
const BLOCK_VALUES = new Set([">", "|", ">-", "|-", ""]);
const QUOTED_RE = /^(["'])(.*)\1$/;

/**
 * A skill file's front matter's `name` and `description`, the two the open skill format gives:
 * a value on its line, quoted or not, or folded over the indented lines after it (`>`, `|`).
 */
export const skillFrontMatter = (
  text: string
): { readonly description?: string; readonly name?: string } => {
  const block: RegExpExecArray | null = FRONT_MATTER_RE.exec(text);
  if (block === null) {
    return {};
  }
  const lines = block[0].split(LINE_BREAK_RE).slice(1, -1);
  const out: Record<string, string> = {};
  lines.forEach((line, i) => {
    const field: RegExpExecArray | null = FIELD_RE.exec(line);
    if (field === null) {
      return;
    }
    const [, key = "", raw = ""] = field;
    if (key !== "name" && key !== "description") {
      return;
    }
    let value = raw.trim();
    if (BLOCK_VALUES.has(value)) {
      const folded: string[] = [];
      for (const next of lines.slice(i + 1)) {
        if (!INDENTED_RE.test(next)) {
          break;
        }
        folded.push(next.trim());
      }
      value = folded.join(" ");
    }
    const quoted: RegExpExecArray | null = QUOTED_RE.exec(value);
    out[key] = (quoted === null ? value : (quoted[2] ?? "")).trim();
  });
  return {
    ...(out.description ? { description: out.description } : {}),
    ...(out.name ? { name: out.name } : {}),
  };
};

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
