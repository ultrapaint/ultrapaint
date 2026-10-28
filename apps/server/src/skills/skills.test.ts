import { readFileSync } from "node:fs";
import path from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { AskUser } from "../services/mcp/ask-user.ts";
import { EditorTools } from "../services/mcp/route.ts";
import { GetScreenshot } from "../services/mcp/screenshot.ts";
import { TOOLS } from "../services/threads/agent-ways.ts";
import { designSkills } from "./design.generated.ts";
import { builtInSkills, SKILL_ORDER } from "./index.ts";
import { readSkillSources, renderSkills, SKILLS_SOURCE } from "./render.ts";

describe("design skills", () => {
  it("the generated module is skills/design/ as it is: run `pnpm -F @ultrapaint/server skills` after an edit", () => {
    const generated = readFileSync(
      path.join(import.meta.dirname, "design.generated.ts"),
      "utf8"
    );
    assert.strictEqual(
      generated,
      renderSkills(readSkillSources(SKILLS_SOURCE))
    );
  });

  it("every skill told in order has its folder, and every folder is told", () => {
    assert.deepStrictEqual(
      builtInSkills(null).map((s) => s.name),
      [...SKILL_ORDER]
    );
    assert.deepStrictEqual(
      Object.keys(designSkills).sort(),
      [...SKILL_ORDER].sort()
    );
  });

  it("a skill names the editor's tools only to an agent that has them, and only tools there are", () => {
    const tools = new Set([
      ...Object.keys(EditorTools.tools),
      AskUser.name,
      GetScreenshot.name,
    ]);
    const without = builtInSkills(null).map((s) => s.text).join("\n");
    const withTools = builtInSkills(TOOLS).map((s) => s.text).join("\n");
    assert.notInclude(without, "editor's tools:");
    assert.notInclude(withTools, "editor's tools:");
    for (const name of tools) {
      assert.notInclude(without, `\`${name}\``);
    }
    const named = [...withTools.matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)].map(
      (m) => m[1]
    );
    assert.isAbove(named.length, 0);
    for (const name of named) {
      assert.isTrue(tools.has(name ?? ""), `${name} is not a tool`);
    }
  });
});
