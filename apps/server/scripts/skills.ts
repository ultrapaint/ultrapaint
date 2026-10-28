/**
 * Writes the design skills of `skills/design/` into the server's generated module. Run after
 * editing a skill: `pnpm -F @ultrapaint/server skills`.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import {
  readSkillSources,
  renderSkills,
  SKILLS_SOURCE,
} from "../src/skills/render.ts";

const out = path.resolve(
  import.meta.dirname,
  "../src/skills/design.generated.ts"
);
writeFileSync(out, renderSkills(readSkillSources(SKILLS_SOURCE)));
console.log(`skills written to ${path.relative(process.cwd(), out)}`);
