/**
 * The design skill the tool ships, `ultrapaint` (`skills/ultrapaint/`, see `render.ts`): one
 * built-in skill. Its core, `SKILL.md`, holds every rule, the steps and the table of kinds, and is
 * what a design thread is told; its references (`references/…`) hold what a rule line cannot, read
 * when the core names them. Its heading is the skill's title, the paragraph after it the summary.
 *
 * The skill is written for any web interface, in the web's terms: it names none of the editor's
 * tools or fields, and what they are in the editor is the briefing's to say (`skillTerms`). So
 * every agent reads the same words, with the editor's tools or without them.
 *
 * Its files are written whole to the user's cache (`skillDirOf`), which the agent sandbox lets
 * agents read, and every `` `references/…` `` the skill says is named where that folder, or an MCP
 * client's `skill://ultrapaint`, has the file (`naming`): every path an agent sees is there.
 */

import { hashContent } from "../hash.ts";
import { designSkill } from "./design.generated.ts";

/** The core's path in the skill. */
export const CORE_FILE = "SKILL.md";

/** The core: every rule, the steps, the table of kinds. */
export const coreText = designSkill.router;

/** Every file of the skill by its path in it: `SKILL.md` and each `references/…`. */
export const skillFiles: Readonly<Record<string, string>> = {
  [CORE_FILE]: designSkill.router,
  ...Object.fromEntries(
    Object.entries(designSkill.references).map(([file, text]) => [
      `references/${file}`,
      text,
    ])
  ),
};

/** The references' paths in the skill (`references/kinds/dialog.md`), in path order. */
export const referenceFiles: readonly string[] = Object.keys(skillFiles).filter(
  (file) => file !== CORE_FILE
);

/**
 * Where this machine keeps the skill written out for agents to read: the user's cache, one
 * directory per version of it, so two versions of the tool do not mix theirs. The agent sandbox
 * lets agents read it.
 */
export const skillDirOf = (
  home: string,
  join: (...parts: string[]) => string
) =>
  join(
    home,
    ".cache",
    "ultrapaint",
    "skills",
    hashContent(JSON.stringify(skillFiles))
  );

/** How the skill names a file of its references (`` `references/layout.md` ``). */
export const REFERENCES_MENTION = "`references/";

/**
 * A text of the skill, each file of its references named under `root`, where the skill's files
 * are: a folder (`skillDirOf`), or `skill://ultrapaint` for an MCP client.
 */
export const naming = (text: string, root: string) =>
  text.replaceAll(REFERENCES_MENTION, `\`${root}/references/`);

/** Every file of the skill as an agent reads it under `root`, each file it names named there. */
export const skillFilesAt = (root: string) =>
  Object.entries(skillFiles).map(
    ([file, text]) => [file, naming(text, root)] as const
  );
