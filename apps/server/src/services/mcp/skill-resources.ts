/**
 * The design skills as MCP resources, `skill://ultrapaint/<name>`, read from the same list the
 * briefing tells (`SkillsService.list`): a project's own file under `<designsDir>/skills/`
 * replaces or extends a built-in in both, and a skill of its own is read by its name. A design
 * thread is told them in its briefing; any other agent, in the editor or outside it, reads the
 * one it needs.
 */
import { NotFound } from "@ultrapaint/contracts/errors";
import { describeSkill } from "@ultrapaint/contracts/skills";
import { Effect, Layer, Schema } from "effect";
import { McpServer } from "effect/ai";
import { OpenProject } from "../../project.ts";
import { builtInSkills } from "../../skills/index.ts";
import { SkillsService } from "../skills.ts";

const SKILL_SCHEME = "skill://ultrapaint/";
const MARKDOWN = "text/markdown";

/** Where an agent reads a design skill. */
export const skillUri = (name: string) => `${SKILL_SCHEME}${name}`;

export const SkillResources = Layer.effectDiscard(
  Effect.gen(function* () {
    const project = yield* OpenProject;

    /** A skill's text as the open project has it: its own file, or the built-in. */
    const textOf = (name: string) =>
      project.use(
        Effect.gen(function* () {
          const { skills } = yield* (yield* SkillsService).list;
          const skill = skills.find((s) => s.name === name);
          if (skill === undefined) {
            return yield* new NotFound({
              message: `no skill named ${name}; the skills are ${skills.map((s) => s.name).join(", ")}`,
            });
          }
          if (!skill.enabled) {
            return yield* new NotFound({
              message: `the ${skill.title} skill is turned off in the settings`,
            });
          }
          return skill.text;
        })
      );

    // The built-ins by name, each with what it is about; the words do not depend on the tools.
    for (const { name, text } of builtInSkills(null)) {
      const { summary, title } = describeSkill(name, text);
      yield* McpServer.registerResource({
        content: textOf(name),
        description: summary,
        mimeType: MARKDOWN,
        name: title,
        uri: skillUri(name),
      });
    }
    // Any other, a project's own included.
    yield* McpServer.registerResource`skill://ultrapaint/${Schema.String}`({
      content: (_uri: string, name: string) => textOf(name),
      description: "A design skill by its name, a project's own included.",
      mimeType: MARKDOWN,
      name: "skill",
    });
  })
);
