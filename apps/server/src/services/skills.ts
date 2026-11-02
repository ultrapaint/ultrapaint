import { NotFound } from "@ultrapaint/contracts/errors";
import {
  type CustomiseMode,
  describeSkill,
  parseSkillFile,
  SKILL_EXTENSION,
  SKILLS_DIR,
  type Skill,
  type SkillList,
  skillUri,
} from "@ultrapaint/contracts/skills";
import { Context, Effect, FileSystem, Layer, Path, Stream } from "effect";
import { ServerConfig } from "../config.ts";
import { EventBus } from "../events.ts";
import { toPosix } from "../hash.ts";
import {
  builtInSkills,
  REFERENCES_MENTION,
  referencesDirOf,
  routerText,
  skillReferences,
  TOLD_WITH_ROUTER,
} from "../skills/index.ts";
import { DesignFiles } from "./design-files.ts";
import { type EditFailure, EditService } from "./edit.ts";
import { RepoPaths } from "./repo-paths.ts";
import { agentWays } from "./threads/agent-ways.ts";

/** What a file that extends a built-in starts as: the user writes the rest. */
const extendStub = (title: string) => `---
extends: true
---

In this product, also (told after the built-in "${title}" skill):

- 
`;

/**
 * The skills that are on, as a design thread's briefing tells them. With the settings'
 * `skills.briefing` at `summaries`, a skill read whole somewhere is a line: its MCP resource
 * with the editor's tools, else its file, which a built-in, or a file that extends one, has not.
 * At `router`, the design skill's router is told, with the parts every screen needs and the
 * project's own files; the router names where the agent reads every other part.
 */
export interface SkillsTold {
  /** A line per skill told by its title and summary: `- Hierarchy (<where>): <summary>`. */
  readonly listed: readonly string[];
  /** The skills told whole, as one markdown text; empty when none. */
  readonly whole: string;
}

/**
 * The design skills an agent is told: the built-in set, each replaced or extended by a project
 * file of the same name under `<designsDir>/skills/`, plus every other file there, minus what
 * the settings turn off. Read on every call, so a file saved by hand is the next briefing's.
 */
export class SkillsService extends Context.Service<
  SkillsService,
  {
    /**
     * The skills that are on, as the briefing tells them, worded for an agent with the editor's
     * tools or without them.
     */
    readonly briefing: (tools: boolean) => Effect.Effect<SkillsTold>;
    /**
     * Starts a project file for a built-in skill: a copy of its text to replace it, or a stub
     * that extends it. A skill the project already has is returned as it is.
     */
    readonly customise: (
      name: string,
      mode: CustomiseMode
    ) => Effect.Effect<Skill, EditFailure>;
    readonly list: Effect.Effect<SkillList>;
  }
>()("ultrapaint/server/SkillsService") {
  static readonly layer = Layer.effect(
    SkillsService,
    Effect.gen(function* () {
      const paths = yield* RepoPaths;
      const edit = yield* EditService;
      const events = yield* EventBus;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = path.join(paths.designsDir, SKILLS_DIR);
      const relDir = paths.relative(dir);
      const disabled = new Set(paths.settings.skills?.disabled ?? []);
      const summaries = paths.settings.skills?.briefing === "summaries";
      const router = (paths.settings.skills?.briefing ?? "router") === "router";
      // As the settings show them: worded for the tools the server offers.
      const { machine, mcp } = yield* ServerConfig;
      const referencesDir = referencesDirOf(machine.home, path.join);

      /*
       * The references written where agents read them, once per server. One that cannot be
       * written leaves its skill pointing at nothing, which costs the agent the reference and
       * nothing else: the thread goes on.
       */
      const references = yield* Effect.cached(
        Effect.forEach(Object.entries(skillReferences), ([file, text]) =>
          Effect.gen(function* () {
            const into = path.join(referencesDir, file);
            yield* fs.makeDirectory(path.dirname(into), { recursive: true });
            yield* fs.writeFileString(into, text);
          })
        ).pipe(Effect.ignore)
      );

      /** A built-in text, each file of the references named where it is written. */
      const withReferences = (text: string) =>
        text.replaceAll(REFERENCES_MENTION, `\`${referencesDir}/`);

      const fileOf = (name: string) =>
        toPosix(path.join(relDir, `${name}${SKILL_EXTENSION}`));

      const builtIn = (name: string, text: string): Skill => ({
        enabled: !disabled.has(name),
        extends: false,
        name,
        source: "built-in",
        text: withReferences(text),
        ...describeSkill(name, text),
      });

      /** A project file on its own, or following the built-in it extends. */
      const fromFile = (name: string, file: string, base?: string): Skill => {
        const parsed = parseSkillFile(file);
        const extended = base !== undefined && parsed.extends;
        const text = extended
          ? `${base.trim()}\n\n${parsed.body.trim()}\n`
          : parsed.body;
        return {
          enabled: !disabled.has(name),
          extends: extended,
          file: fileOf(name),
          name,
          source: "project",
          text,
          ...describeSkill(name, extended ? base : parsed.body),
        };
      };

      /** The project's own files, by name; a file that cannot be read is left out. */
      const projectFiles = Effect.gen(function* () {
        const names = yield* Effect.orElseSucceed(
          fs.readDirectory(dir),
          (): string[] => []
        );
        const entries = yield* Effect.forEach(
          names.filter((n) => n.endsWith(SKILL_EXTENSION)).sort(),
          (file) =>
            Effect.option(
              Effect.map(
                fs.readFileString(path.join(dir, file)),
                (text) =>
                  [file.slice(0, -SKILL_EXTENSION.length), text] as const
              )
            )
        );
        return new Map(
          entries.flatMap((e) => (e._tag === "Some" ? [e.value] : []))
        );
      });

      /** Every skill, the built-ins worded for an agent with the tools or without them. */
      const listFor = Effect.fnUntraced(function* (tools: boolean) {
        const builtIns = builtInSkills(agentWays(tools).tools);
        const own = yield* projectFiles;
        const skills = builtIns.map((skill) => {
          const file = own.get(skill.name);
          return file === undefined
            ? builtIn(skill.name, skill.text)
            : fromFile(skill.name, file, skill.text);
        });
        const known = new Set(builtIns.map((s) => s.name));
        for (const [name, file] of own) {
          if (!known.has(name)) {
            skills.push(fromFile(name, file));
          }
        }
        return { dir: relDir, skills } satisfies SkillList;
      });
      // Written before any skill is read, whole or in the briefing, so its folder is there.
      const list = Effect.andThen(references, listFor(mcp)).pipe(
        Effect.withSpan("SkillsService.list")
      );

      /** Where the agent reads a skill whole, when it is told only its summary. */
      const whereRead = (skill: Skill, tools: boolean) => {
        if (!summaries) {
          return;
        }
        if (tools) {
          return skillUri(skill.name);
        }
        return skill.extends ? undefined : skill.file;
      };

      const briefing = Effect.fn("SkillsService.briefing")(function* (
        tools: boolean
      ): Effect.fn.Return<SkillsTold> {
        yield* references;
        const { skills } = yield* listFor(tools);
        const listed: string[] = [];
        const whole: string[] = router
          ? [withReferences(routerText(agentWays(tools).tools)).trim()]
          : [];
        for (const skill of skills.filter((s) => s.enabled)) {
          // Read from the references when the router names it: what the project wrote is told.
          if (
            router &&
            skill.source === "built-in" &&
            !TOLD_WITH_ROUTER.has(skill.name)
          ) {
            continue;
          }
          const where = whereRead(skill, tools);
          if (where === undefined) {
            whole.push(skill.text.trim());
          } else {
            listed.push(`- ${skill.title} (${where}): ${skill.summary}`);
          }
        }
        return { listed, whole: whole.join("\n\n") };
      });

      const customise = Effect.fn("SkillsService.customise")(function* (
        name: string,
        mode: CustomiseMode
      ) {
        const { skills } = yield* list;
        const skill = skills.find((s) => s.name === name);
        if (!skill) {
          return yield* new NotFound({ message: `no skill named ${name}` });
        }
        if (skill.source === "project") {
          return skill;
        }
        const content =
          mode === "extend" ? extendStub(skill.title) : skill.text;
        yield* edit.transaction(
          `${mode === "extend" ? "Extend" : "Replace"} the ${skill.title} skill`,
          (tx) => tx.create(fileOf(name), content)
        );
        const after = yield* list;
        yield* events.publish("skills", after);
        return after.skills.find((s) => s.name === name) ?? skill;
      });

      // Whoever changes the files: an undo, an agent, an editor, a checkout.
      yield* (yield* DesignFiles).changes(["skill"]).pipe(
        Stream.debounce("50 millis"),
        Stream.runForEach(() =>
          Effect.flatMap(list, (state) => events.publish("skills", state))
        ),
        Effect.forkScoped
      );

      return SkillsService.of({ briefing, customise, list });
    })
  );
}
