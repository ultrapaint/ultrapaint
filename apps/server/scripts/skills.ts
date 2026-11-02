/**
 * Writes the design skill of `skills/ultrapaint/` into the server's generated module. Run after
 * editing a skill: `pnpm -F @ultrapaint/server skills`.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import {
  readSkillSource,
  renderSkills,
  SKILLS_SOURCE,
} from "../src/skills/render.ts";

const out = path.resolve(
  import.meta.dirname,
  "../src/skills/design.generated.ts"
);
writeFileSync(out, renderSkills(readSkillSource(SKILLS_SOURCE)));
console.log(`skills written to ${path.relative(process.cwd(), out)}`);
