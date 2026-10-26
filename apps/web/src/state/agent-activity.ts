/**
 * The editor's view of {@link agentActivity}: the same thing, read from the stores. It is worked
 * out once whenever what it is made of changes, however many read it: every frame on the canvas
 * does, and an agent's thread changes with each word it writes. A reader picks what concerns it,
 * and is drawn again only when that changes.
 */
import { useSyncExternalStore } from "react";
import { type AgentActivity, agentActivity } from "../lib/agent-activity.ts";
import { useAgents } from "./agents.ts";
import { useProject } from "./project.ts";

let last: {
  inputs: readonly unknown[];
  value: readonly AgentActivity[];
} | null = null;

/** The activity as the stores have it now; the same array while they hold the same things. */
const current = (): readonly AgentActivity[] => {
  const { focused, items, threads } = useAgents.getState();
  const { pages } = useProject.getState();
  const inputs = [threads, items, pages, focused];
  if (!last || inputs.some((input, i) => input !== last?.inputs[i])) {
    last = { inputs, value: agentActivity(threads, items, pages, focused) };
  }
  return last.value;
};

const subscribe = (onChange: () => void) => {
  const offAgents = useAgents.subscribe(onChange);
  const offProject = useProject.subscribe(onChange);
  return () => {
    offAgents();
    offProject();
  };
};

/**
 * What `pick` reads of the activity. It must answer the same value for the same activity (an
 * element of it, an id), so a reader is not drawn again for a change elsewhere.
 */
export const useAgentActivityOf = <T>(
  pick: (activity: readonly AgentActivity[]) => T
): T => useSyncExternalStore(subscribe, () => pick(current()));
