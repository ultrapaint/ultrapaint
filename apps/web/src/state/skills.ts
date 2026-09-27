/**
 * The design skills agents are told: the shipped set, the project's own files, and what the
 * settings turn off. The settings page lists them from here.
 */
import type {
  CustomiseMode,
  Skill,
  SkillList,
} from "@ultrapaint/contracts/skills";
import { create } from "zustand";
import { api } from "./connection.ts";
import { reportError } from "./project.ts";

interface SkillsStore extends SkillList {
  /** Starts a project file for a built-in skill: a copy of it, or a stub that extends it. */
  customise: (name: string, mode: CustomiseMode) => Promise<Skill | null>;
  load: () => Promise<void>;
  loaded: boolean;
}

let bound = false;

export const useSkills = create<SkillsStore>((set) => ({
  customise: async (name, mode) => {
    try {
      return await api().request("skills.customise", { mode, name });
    } catch (error) {
      reportError(error);
      return null;
    }
  },
  dir: "",
  load: async () => {
    if (!bound) {
      bound = true;
      api().on("skills", (state) => set({ ...state, loaded: true }));
    }
    try {
      const state = await api().request("skills.list", undefined);
      set({ ...state, loaded: true });
    } catch (error) {
      reportError(error);
    }
  },
  loaded: false,
  skills: [],
}));
