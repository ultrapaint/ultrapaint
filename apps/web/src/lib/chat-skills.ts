/**
 * The design skills a chat is told (ADR 0095): its own choice from the composer's tray, else the
 * project's defaults. Pure, so the choice is tested without the stores.
 */
import { DESIGN_SKILL, type Skill } from "@ultrapaint/contracts/skills";
import type { Thread } from "@ultrapaint/contracts/threads";

/** What a chat's choice names a skill by: the design skill by its name, a project's by its file. */
export const skillKey = (skill: Skill) =>
  skill.source === "built-in" ? DESIGN_SKILL : (skill.file ?? skill.name);

/** The key a chat's choice names a skill by, for a choice that named it by an alias. */
const keyOf = (choice: string, skills: readonly Skill[]) => {
  const skill = skills.find((s) => s.aliases?.includes(choice));
  return skill ? skillKey(skill) : choice;
};

/**
 * The skills a chat is told: its own choice, each skill once however many of its files it named,
 * else the ones the project has on.
 */
export const chosenSkills = (
  thread: Pick<Thread, "skills">,
  skills: readonly Skill[]
): readonly string[] => {
  if (thread.skills === undefined) {
    return skills.filter((s) => s.enabled).map(skillKey);
  }
  return [...new Set(thread.skills.map((choice) => keyOf(choice, skills)))];
};

/** The chosen skills by their titles, a skill the project no longer has by its key. */
export const chosenTitles = (
  chosen: readonly string[],
  skills: readonly Skill[]
): readonly string[] =>
  chosen.map((key) => skills.find((s) => skillKey(s) === key)?.title ?? key);
