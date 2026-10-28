/**
 * The design skills' source is `skills/design/` at the repository's root: one folder per skill,
 * its `SKILL.md` (the Agent Skills layout, so the same folder serves other agents too) and, for a
 * skill with knowledge read on demand, its `references/`. The server does not read them at run
 * time: `pnpm -F @ultrapaint/server skills` writes them into `design.generated.ts`, which the
 * bundle carries like any module, and a test fails when the two differ.
 *
 * Pure, synchronous and free of Effect: the build script and the test both run it.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { parseSkillFile } from "@ultrapaint/contracts/skills";

/** `skills/design/` from this module, in the checkout's sources. */
export const SKILLS_SOURCE = path.resolve(
  import.meta.dirname,
  "../../../../skills/design"
);

export interface SkillSource {
  /** Files read on demand, by their name under `references/`. */
  readonly references: Readonly<Record<string, string>>;
  /** The skill's markdown, its front matter left out: what agents are told. */
  readonly text: string;
}

const MARKDOWN_RE = /\.md$/;

/** Every skill under `dir`, by its folder's name, in name order. */
export const readSkillSources = (
  dir: string
): Readonly<Record<string, SkillSource>> => {
  const skills: Record<string, SkillSource> = {};
  for (const name of readdirSync(dir).sort()) {
    const file = path.join(dir, name, "SKILL.md");
    if (!statSync(path.join(dir, name)).isDirectory()) {
      continue;
    }
    const references: Record<string, string> = {};
    const refDir = path.join(dir, name, "references");
    const refs = statSync(refDir, { throwIfNoEntry: false })?.isDirectory()
      ? readdirSync(refDir)
          .filter((f) => MARKDOWN_RE.test(f))
          .sort()
      : [];
    for (const ref of refs) {
      references[ref] = readFileSync(path.join(refDir, ref), "utf8");
    }
    skills[name] = {
      references,
      text: `${parseSkillFile(readFileSync(file, "utf8")).body.trim()}\n`,
    };
  }
  return skills;
};

/** The generated module's source for the skills found. */
export const renderSkills = (skills: Readonly<Record<string, SkillSource>>) =>
  [
    "// Generated from skills/design/ by `pnpm -F @ultrapaint/server skills`. Do not edit.",
    'import type { SkillSource } from "./render.ts";',
    "",
    `export const designSkills: Readonly<Record<string, SkillSource>> = ${JSON.stringify(skills, null, 2)};`,
    "",
  ].join("\n");
