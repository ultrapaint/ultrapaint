import { readFileSync } from "node:fs";
import path from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { AskUser } from "../services/mcp/ask-user.ts";
import { EditorTools } from "../services/mcp/route.ts";
import { GetScreenshot } from "../services/mcp/screenshot.ts";
import { agentWays } from "../services/threads/agent-ways.ts";
import { skillTerms } from "../services/threads/briefing.ts";
import {
  CORE_FILE,
  coreText,
  naming,
  REFERENCES_MENTION,
  skillFiles,
  skillFilesAt,
} from "./index.ts";
import { readSkillSource, renderSkills, SKILLS_SOURCE } from "./render.ts";

/** A file of the references a text names: `` `references/kinds/dialog.md` ``. */
const MENTION_RE = /`(references\/[^`\s]+)`/g;
/** `references/…` written anywhere, named or not. */
const ANY_MENTION_RE = /references\/[\w./-]+\.md/g;
const CORE_HEADING_RE = /^# Ultrapaint\n/;
const REFERENCE_PATH_RE = /^references\/[\w/-]+\.md$/;
const FIGMA_RE = /`([^`]+\/system\/figma\.md)`/;
/** A word written the way the editor's tools are named. */
const TOOL_NAME_RE = /\b[a-z]+(?:_[a-z]+)+\b/g;

const TOOLS = new Set([
  ...Object.keys(EditorTools.tools),
  AskUser.name,
  GetScreenshot.name,
]);

/**
 * The editor's words, which the skill leaves to the briefing (`skillTerms`): the page model's
 * fields, a token as the page format writes it, an operation, and the old markers.
 */
const EDITOR_TERMS = [
  "textStyle",
  "crossAlign",
  '"$',
  "{op:",
  "[with the editor's tools",
  "| without:",
];

describe("the design skill", () => {
  it("the generated module is skills/ultrapaint/ as it is: run `pnpm -F @ultrapaint/server skills` after an edit", () => {
    const generated = readFileSync(
      path.join(import.meta.dirname, "design.generated.ts"),
      "utf8"
    );
    assert.strictEqual(generated, renderSkills(readSkillSource(SKILLS_SOURCE)));
  });

  it("is a core and its references, the core headed as the skill", () => {
    assert.strictEqual(skillFiles[CORE_FILE], coreText);
    assert.match(coreText, CORE_HEADING_RE);
    const others = Object.keys(skillFiles).filter((f) => f !== CORE_FILE);
    assert.isNotEmpty(others);
    for (const file of others) {
      assert.match(file, REFERENCE_PATH_RE);
    }
  });

  it("names none of the editor's tools, fields or markers anywhere", () => {
    const found = Object.entries(skillFiles).flatMap(([file, text]) => [
      ...EDITOR_TERMS.filter((term) => text.includes(term)).map(
        (term) => `${file} says ${term}`
      ),
      ...(text.match(TOOL_NAME_RE) ?? [])
        .filter((word) => TOOLS.has(word))
        .map((tool) => `${file} names ${tool}`),
    ]);
    assert.deepStrictEqual(found, []);
  });

  it("names every file of its references in backticks, and each is there", () => {
    const missing = Object.entries(skillFiles).flatMap(([file, text]) => {
      const named = [...text.matchAll(MENTION_RE)].map((m) => m[1] ?? "");
      const written = text.match(ANY_MENTION_RE) ?? [];
      return [
        ...named
          .filter((ref) => skillFiles[ref] === undefined)
          .map((ref) => `${file} names ${ref}, which is not there`),
        ...written
          .filter((ref) => !named.includes(ref))
          .map((ref) => `${file} writes ${ref} outside backticks`),
      ];
    });
    assert.deepStrictEqual(missing, []);
  });

  it("names its references where they are read", () => {
    assert.strictEqual(
      naming("Open `references/kinds/dialog.md` now.", "skill://ultrapaint"),
      "Open `skill://ultrapaint/references/kinds/dialog.md` now."
    );
    for (const [, text] of skillFilesAt("/cache/abc")) {
      assert.notInclude(text, REFERENCES_MENTION);
    }
  });
});

describe("the design skill's terms in the editor", () => {
  it("map the skill's words onto the page model and the tools", () => {
    const terms = skillTerms(agentWays(true), "designs", "/cache/abc");
    assert.include(terms, "textStyle");
    assert.include(terms, '"$name"');
    for (const tool of ["read_design_system", "get_component", "ask_user"]) {
      assert.include(terms, tool);
    }
    // Typed by hand: the linter otherwise takes the match for non-null.
    const figma: RegExpExecArray | null = FIGMA_RE.exec(terms);
    assert.strictEqual(figma?.[1], "/cache/abc/references/system/figma.md");
    assert.isDefined(skillFiles["references/system/figma.md"]);
  });

  it("without the tools, name none and say where the tokens' values are", () => {
    const terms = skillTerms(agentWays(false), "designs", "/cache/abc");
    assert.include(terms, "textStyle");
    assert.include(terms, "designs/design.tokens.json");
    assert.deepStrictEqual(
      (terms.match(TOOL_NAME_RE) ?? []).filter((word) => TOOLS.has(word)),
      []
    );
  });
});
