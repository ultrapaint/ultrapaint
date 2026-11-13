/**
 * The design skills as MCP resources, read from the same list the briefing tells
 * (`SkillsService.list`). A design thread is told them in its briefing; any other agent, in the
 * editor or outside it, reads what it needs here.
 *
 * The URIs, under `skill://ultrapaint/`:
 *
 * - `skill://ultrapaint/SKILL.md`: the design skill's core;
 * - `skill://ultrapaint/references/<path>`: each of its references by its path in the skill
 *   (`skill://ultrapaint/references/kinds/dialog.md`);
 * - `skill://ultrapaint/<name>`: a project's own skill turned on, its folder's `SKILL.md` (ADR 0094).
 *
 * The design skill's files are each a resource of its own, listed: a template's parameter is one
 * segment of the URI (the router stops it at a `/`), so it could not carry a reference's path. A
 * project's skills are read through one template by their names, which have no `/`. The files are
 * worded with these URIs, never the cache's paths: an MCP client may be on another machine.
 */
import { NotFound } from "@ultrapaint/contracts/errors";
import {
  DESIGN_SKILL,
  describeSkill,
  SKILL_ROOT_URI,
  skillUri,
} from "@ultrapaint/contracts/skills";
import { Effect, Layer, Schema } from "effect";
import { McpServer } from "effect/ai";
import { OpenProject } from "../../project.ts";
import { coreText, naming, skillFilesAt } from "../../skills/index.ts";
import { SkillsService } from "../skills.ts";

const MARKDOWN = "text/markdown";

export const SkillResources = Layer.effectDiscard(
  Effect.gen(function* () {
    const project = yield* OpenProject;

    /** A skill as the open project has it, refused when there is none or it is off. */
    const skillOf = (name: string) =>
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
          return skill;
        })
      );

    // The design skill's files, each by its path, while it is on.
    for (const [file, text] of skillFilesAt(SKILL_ROOT_URI)) {
      const { summary, title } = describeSkill(file, text);
      yield* McpServer.registerResource({
        content: Effect.as(skillOf(DESIGN_SKILL), text),
        description: summary,
        mimeType: MARKDOWN,
        name: title,
        uri: skillUri(file),
      });
    }
    // A project's own skill by its name; the design skill's name reads its core.
    yield* McpServer.registerResource`skill://ultrapaint/${Schema.String}`({
      content: (_uri: string, name: string) =>
        Effect.map(skillOf(name), (skill) =>
          skill.source === "built-in"
            ? naming(coreText, SKILL_ROOT_URI)
            : skill.text
        ),
      description: "A project's own skill by its folder's name.",
      mimeType: MARKDOWN,
      name: "skill",
    });
  })
);
