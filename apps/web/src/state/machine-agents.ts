import { create } from "zustand";
import { type PlatformAgent, platform } from "../platform.ts";

/**
 * The agents as the shell finds them on this machine (Platform): installed, signed in. Nothing in
 * a browser, where the editor knows only the server's launch configurations. Asked when the
 * settings or an agent picker opens, since an agent installed or signed in meanwhile changes it.
 */
interface MachineAgentsStore {
  /** By the agent's id; empty until asked, and in a browser. */
  agents: Readonly<Record<string, PlatformAgent>>;
  load: () => Promise<void>;
}

export const useMachineAgents = create<MachineAgentsStore>((set) => ({
  agents: {},
  load: async () => {
    const list = (await platform().agents?.list()) ?? [];
    set({ agents: Object.fromEntries(list.map((a) => [a.id, a])) });
  },
}));

/** A word on an agent that is not ready, for its place in a picker; nothing when it is. */
export const readiness = (agent: PlatformAgent | undefined) => {
  if (!agent || agent.state === "ready") {
    return null;
  }
  return agent.state === "missing" ? "Not installed" : "Not signed in";
};
