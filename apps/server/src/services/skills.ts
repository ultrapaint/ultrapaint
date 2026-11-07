import {
  DESIGN_SKILL,
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
  /** The skills told whole, as one markdown text; empty when none. */
  readonly whole: string;
}

/**
 * The design skills an agent is told: the design skill the tool ships (`ultrapaint`), then every
 * file of the project's under `<designsDir>/skills/`, minus what the settings turn off. Read on
 * every call, so a file saved by hand is the next briefing's.
 */
export class SkillsService extends Context.Service<
  SkillsService,
  {
    /** The skills that are on, as the briefing tells them, to an agent with the editor's tools or without. */
    readonly briefing: (tools: boolean) => Effect.Effect<SkillsTold>;
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
      };

      const fileOf = (name: string) =>
        toPosix(path.join(relDir, `${name}${SKILL_EXTENSION}`));

      /** A project's own file, told whole. */
      const fromFile = (name: string, file: string): Skill => {
        const { body } = parseSkillFile(file);
        return {
          enabled: !disabled.has(name),
          file: fileOf(name),
          name,
          source: "project",
          text: body,
          ...describeSkill(name, body),
        };
      };

      /** The project's own files, by name; a file that cannot be read is left out. */
      const projectFiles = Effect.gen(function* () {
        const names = yield* Effect.orElseSucceed(
          fs.readDirectory(dir),
          (): string[] => []
        );
        return yield* Effect.forEach(
          names.filter((n) => n.endsWith(SKILL_EXTENSION)).sort(),
          (file) =>
            Effect.option(
              Effect.map(fs.readFileString(path.join(dir, file)), (text) =>
                fromFile(file.slice(0, -SKILL_EXTENSION.length), text)
              )
            )
        ).pipe(
          Effect.map((read) =>
            read.flatMap((e) => (e._tag === "Some" ? [e.value] : []))
          )
        );
      });

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
        tools: boolean
      ): Effect.fn.Return<SkillsTold> {
        const { skills } = yield* list;
        const on = skills.filter((s) => s.enabled);
        const at = designSkill.enabled ? skillDir : undefined;
        if (told === "summaries") {
          return {
            dir: at,
            listed: on.map(
              (s) => `- ${s.title} (${whereRead(s, tools)}): ${s.summary}`
            ),
            whole: "",
          };
        }
        const whole = on.flatMap((skill) =>
          skill.source === "built-in" && told === "full"
            ? [skill.text.trim(), ...referenceFiles.map(referenceTold)]
            : [skill.text.trim()]
        );
        return { dir: at, listed: [], whole: whole.join("\n\n") };
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
