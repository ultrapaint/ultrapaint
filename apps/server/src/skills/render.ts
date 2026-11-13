/**
 * The design skill's source is `skills/ultrapaint/` at the repository's root, one skill in the
 * Agent Skills layout: its `SKILL.md`, the core an agent is always told (every rule, the steps,
 * the kinds of screen and page), and `references/`, what the core sends the agent to read when a
 * screen reaches it (`layout.md`, `kinds/dialog.md`, `system/foundations.md`…). The server does
 * not read them at run time: `pnpm -F @ultrapaint/server skills` writes them into
 * `design.generated.ts`, which the bundle carries like any module, and a test fails when the two
 * differ.
 *
 * Pure, synchronous and free of Effect: the build script and the test both run it.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { parseSkillFile, skillFrontMatter } from "@ultrapaint/contracts/skills";

/** `skills/ultrapaint/` from this module, in the checkout's sources. */
export const SKILLS_SOURCE = path.resolve(
  import.meta.dirname,
  "../../../../skills/ultrapaint"
);

export interface SkillSource {
  /** `SKILL.md`'s front matter's description: when to use it, as agents choose skills by it. */
  readonly description: string;
  /** Every file under `references/`, by its path there (`kinds/dialog.md`). */
  readonly references: Readonly<Record<string, string>>;
  /** The core: `SKILL.md`'s markdown, its front matter left out. */
  readonly router: string;
}

const MARKDOWN_RE = /\.md$/;

/** Every markdown file under `dir`, by its path from `dir`, in path order. */
const markdownUnder = (dir: string, prefix = ""): [string, string][] =>
  readdirSync(dir)
    .sort()
    .flatMap((name): [string, string][] => {
      const file = path.join(dir, name);
      if (statSync(file).isDirectory()) {
        return markdownUnder(file, `${prefix}${name}/`);
      }
      return MARKDOWN_RE.test(name)
        ? [[`${prefix}${name}`, readFileSync(file, "utf8")]]
        : [];
    });

/** The skill under `dir`: its core and every file of its references. */
export const readSkillSource = (dir: string): SkillSource => {
  const core = readFileSync(path.join(dir, "SKILL.md"), "utf8");
  return {
    description: skillFrontMatter(core).description ?? "",
    references: Object.fromEntries(markdownUnder(path.join(dir, "references"))),
    router: `${parseSkillFile(core).body.trim()}\n`,
  };
};

/** The generated module's source for the skill found. */
export const renderSkills = (skill: SkillSource) =>
  [
    "// Generated from skills/ultrapaint/ by `pnpm -F @ultrapaint/server skills`. Do not edit.",
    'import type { SkillSource } from "./render.ts";',
    "",
    `export const designSkill: SkillSource = ${JSON.stringify(skill, null, 2)};`,
    "",
  ].join("\n");
