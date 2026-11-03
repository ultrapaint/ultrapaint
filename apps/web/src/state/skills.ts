/**
 * The design skills agents are told: the shipped set, the project's own files, and what the
 * settings turn off. The settings list them from here.
 */
import type {
  CustomiseMode,
  Skill,
  SkillList,
} from "@ultrapaint/contracts/skills";
import { create } from "zustand";
import { api } from "./connection.ts";
import { reportError } from "./project.ts";
import { follow } from "./server-data.ts";

interface SkillsStore extends SkillList {
  /** Starts a project file for a built-in skill: a copy of it, or a stub that extends it. */
  customise: (name: string, mode: CustomiseMode) => Promise<Skill | null>;
  load: () => Promise<void>;
  loaded: boolean;
}

export const useSkills = create<SkillsStore>(() => ({
  customise: async (name, mode) => {
    try {
      return await api().request("skills.customise", { mode, name });
    } catch (error) {
      reportError(error);
      return null;
    }
  },
  dir: "",
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
