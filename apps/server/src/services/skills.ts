import {
  DESIGN_SKILL,
  describeSkill,
  parseSkillFile,
  SKILL_EXTENSION,
  SKILL_FILE,
  SKILL_FOLDERS,
  SKILLS_DIR,
  type Skill,
  type SkillList,
  skillFrontMatter,
  skillUri,
} from "@ultrapaint/contracts/skills";
import { Context, Effect, FileSystem, Layer, Path, Stream } from "effect";
import { ServerConfig } from "../config.ts";
import { EventBus } from "../events.ts";
import { toPosix } from "../hash.ts";
import {
  CORE_FILE,
  coreText,
  naming,
  referenceFiles,
  skillDirOf,
  skillFiles,
  skillFilesAt,
} from "../skills/index.ts";
import { DesignFiles } from "./design-files.ts";
import { RepoPaths } from "./repo-paths.ts";

/**
 * The skills that are on, as a design thread's briefing tells them (the settings'
 * `skills.briefing`). At `router`, the design skill's core and the project's own files whole; the
 * core names where the agent reads each reference. At `full`, every reference whole too. At
 * `summaries`, a line each: its MCP resource with the editor's tools, else its file.
 */
export interface SkillsTold {
  /**
   * Where the design skill's files are written for agents to read, when it is on: the folder its
   * `references/…` are named in.
   */
  readonly dir: string | undefined;
  /** A line per skill told by its title and summary: `- Ultrapaint (<where>): <summary>`. */
  readonly listed: readonly string[];
  /** The skills told, by the names a chat's choice gives them: `ultrapaint`, a project skill's file. */
  readonly names: readonly string[];
  /** The skills told whole, as one markdown text; empty when none. */
  readonly whole: string;
}

/** A skill by the name a chat's choice gives it (`Thread.skills`): `ultrapaint`, else its file. */
export const choiceName = (skill: Skill) =>
  skill.source === "built-in" ? skill.name : (skill.file ?? skill.name);

/**
 * The design skills an agent is told: the design skill the tool ships (`ultrapaint`), on unless the
 * settings turn it off, then the project's own the settings turn on (ADR 0094): the files under
 * `<designsDir>/skills/` and the skill folders under `.claude/skills/`, `.agents/skills/` and
 * `skills/`. Read on every call, so a file saved by hand is the next briefing's.
 */
export class SkillsService extends Context.Service<
  SkillsService,
  {
    /**
     * The skills that are on, as the briefing tells them, to an agent with the editor's tools or
     * without. `chosen`, a chat's own choice (`Thread.skills`): exactly the skills it names,
     * whatever the settings turn on or off; a name that matches no skill is passed over.
     */
    readonly briefing: (
      tools: boolean,
      chosen?: readonly string[]
    ) => Effect.Effect<SkillsTold>;
    readonly list: Effect.Effect<SkillList>;
  }
>()("ultrapaint/server/SkillsService") {
  static readonly layer = Layer.effect(
    SkillsService,
    Effect.gen(function* () {
      const paths = yield* RepoPaths;
      const events = yield* EventBus;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = path.join(paths.designsDir, SKILLS_DIR);
      const relDir = paths.relative(dir);
      const disabled = new Set(paths.settings.skills?.disabled ?? []);
      const enabled = new Set(paths.settings.skills?.enabled ?? []);
      const told = paths.settings.skills?.briefing ?? "router";
      const { machine } = yield* ServerConfig;
      const skillDir = skillDirOf(machine.home, path.join);

      /*
       * The design skill written where agents read it, once per server: `SKILL.md` and its
       * `references/`, each file naming the others where they are. One that cannot be written
       * leaves the core pointing at nothing, which costs the agent the reference and nothing
       * else: the thread goes on.
       */
      const written = yield* Effect.cached(
        Effect.forEach(skillFilesAt(skillDir), ([file, text]) =>
          Effect.gen(function* () {
            const into = path.join(skillDir, file);
            yield* fs.makeDirectory(path.dirname(into), { recursive: true });
            yield* fs.writeFileString(into, text);
          })
        ).pipe(Effect.ignore)
      );

      /** The design skill as the settings list it: its core, named where its files are. */
      const designSkill: Skill = {
        enabled: !disabled.has(DESIGN_SKILL),
        name: DESIGN_SKILL,
        source: "built-in",
        text: naming(coreText, skillDir),
        ...describeSkill(DESIGN_SKILL, coreText),
        summary:
          "Interface design rules: designing and reviewing screens and pages, writing their words, and making their design system.",
      };

      /**
       * A project's skill, told whole: its title and summary from its front matter, else its
       * first heading and paragraph. A folder's says where its other files are, which it names
       * from there.
       */
      const projectSkill = (
        stem: string,
        file: string,
        text: string,
        folder?: string
      ): Skill => {
        const { body } = parseSkillFile(text);
        const front = skillFrontMatter(text);
        const described = describeSkill(stem, body);
        const whole = folder
          ? `The skill’s files are in \`${folder}/\`: read the files it names from there.\n\n${body}`
          : body;
        return {
          enabled: enabled.has(file),
          file,
          name: stem,
          source: "project",
          summary: front.description ?? described.summary,
          text: whole,
          title: front.name ?? described.title,
        };
      };

      /** A file's text, or nothing when it cannot be read. */
      const readText = (file: string) =>
        Effect.option(fs.readFileString(path.join(paths.root, file)));

      /** The files under `<designsDir>/skills/`, each a skill. */
      const designFiles = Effect.gen(function* () {
        const names = yield* Effect.orElseSucceed(
          fs.readDirectory(dir),
          (): string[] => []
        );
        return yield* Effect.forEach(
          names.filter((n) => n.endsWith(SKILL_EXTENSION)).sort(),
          (name) => {
            const file = toPosix(path.join(relDir, name));
            return Effect.map(readText(file), (text) =>
              text._tag === "Some"
                ? [
                    projectSkill(
                      name.slice(0, -SKILL_EXTENSION.length),
                      file,
                      text.value
                    ),
                  ]
                : []
            );
          }
        ).pipe(Effect.map((read) => read.flat()));
      });

      /**
       * The skill folders agents keep in the repository, each with its `SKILL.md`. A folder of
       * the design skill's own name is a copy of the one the tool ships, and left out.
       */
      const agentFolders = Effect.forEach(SKILL_FOLDERS, (parent) =>
        Effect.gen(function* () {
          const names = yield* Effect.orElseSucceed(
            fs.readDirectory(path.join(paths.root, parent)),
            (): string[] => []
          );
          const found = yield* Effect.forEach(
            names
              .filter((n) => n !== DESIGN_SKILL && !n.startsWith("."))
              .sort(),
            (name) => {
              const folder = `${parent}/${name}`;
              const file = `${folder}/${SKILL_FILE}`;
              return Effect.map(readText(file), (text) =>
                text._tag === "Some"
                  ? [projectSkill(name, file, text.value, folder)]
                  : []
              );
            }
          );
          return found.flat();
        })
      ).pipe(Effect.map((read) => read.flat()));

      /** Two skills of one name are told apart by a number, for their resources' names. */
      const named = (skills: readonly Skill[]): Skill[] => {
        const taken = new Set<string>([DESIGN_SKILL]);
        return skills.map((skill) => {
          const { name: stem } = skill;
          let name = stem;
          for (let n = 2; taken.has(name); n += 1) {
            name = `${stem}-${n}`;
          }
          taken.add(name);
          return { ...skill, name };
        });
      };

      /** The project's own skills: the designs' files first, then the agents' folders. */
      const projectFiles = Effect.map(
        Effect.all([designFiles, agentFolders]),
        ([own, folders]) => named([...own, ...folders])
      );

      // Written before any skill is read, whole or in the briefing, so its folder is there.
      const list = Effect.andThen(written, projectFiles).pipe(
        Effect.map(
          (own): SkillList => ({ dir: relDir, skills: [designSkill, ...own] })
        ),
        Effect.withSpan("SkillsService.list")
      );

      /** Where the agent reads a skill whole, when it is told only its summary. */
      const whereRead = (skill: Skill, tools: boolean) => {
        if (skill.source === "built-in") {
          return tools ? skillUri(CORE_FILE) : `${skillDir}/${CORE_FILE}`;
        }
        return tools ? skillUri(skill.name) : (skill.file ?? skill.name);
      };

      /** A reference told whole, after the path the core names it by. */
      const referenceTold = (file: string) =>
        `The reference \`${skillDir}/${file}\`:\n\n${naming(skillFiles[file] ?? "", skillDir).trim()}`;

      const briefing = Effect.fn("SkillsService.briefing")(function* (
        tools: boolean,
        chosen?: readonly string[]
      ): Effect.fn.Return<SkillsTold> {
        const { skills } = yield* list;
        const picked = chosen === undefined ? undefined : new Set(chosen);
        const on = skills.filter((s) =>
          picked === undefined ? s.enabled : picked.has(choiceName(s))
        );
        const at = on.some((s) => s.source === "built-in")
          ? skillDir
          : undefined;
        const names = on.map(choiceName);
        if (told === "summaries") {
          return {
            dir: at,
            listed: on.map(
              (s) => `- ${s.title} (${whereRead(s, tools)}): ${s.summary}`
            ),
            names,
            whole: "",
          };
        }
        const whole = on.flatMap((skill) =>
          skill.source === "built-in" && told === "full"
            ? [skill.text.trim(), ...referenceFiles.map(referenceTold)]
            : [skill.text.trim()]
        );
        return { dir: at, listed: [], names, whole: whole.join("\n\n") };
      });

      // Whoever changes the files: an undo, an agent, an editor, a checkout.
      yield* (yield* DesignFiles).changes(["skill"]).pipe(
        Stream.debounce("50 millis"),
        Stream.runForEach(() =>
          Effect.flatMap(list, (state) => events.publish("skills", state))
        ),
        Effect.forkScoped
      );

      return SkillsService.of({ briefing, list });
    })
  );
}
