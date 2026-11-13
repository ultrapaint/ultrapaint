/**
 * The design skills agents are told: the design skill the tool ships, the project's own skill
 * folders, what the settings turn on and off, and where the repository keeps a copy of the
 * design skill. The settings list them from here.
 */
import type { SkillList } from "@ultrapaint/contracts/skills";
import { create } from "zustand";
import { api } from "./connection.ts";
import { reportError } from "./project.ts";
import { follow } from "./server-data.ts";

interface SkillsStore extends SkillList {
  load: () => Promise<void>;
  loaded: boolean;
}

export const useSkills = create<SkillsStore>(() => ({
  installed: [],
  load: () => skillsData.read().catch(reportError),
  loaded: false,
  skills: [],
}));

const take = (list: SkillList) => useSkills.setState({ ...list, loaded: true });

const skillsData = follow({
  apply: take,
  on: { skills: take },
  read: () => api().request("skills.list", undefined),
  whole: ["skills"],
});
