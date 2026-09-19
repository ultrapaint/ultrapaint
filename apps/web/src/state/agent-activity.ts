/**
 * The editor's view of {@link agentActivity}: the same thing, read from the stores.
 */
import { useMemo } from "react";
import { agentActivity } from "../lib/agent-activity.ts";
import { useAgents } from "./agents.ts";
import { useProject } from "./project.ts";

export const useAgentActivity = () => {
  const threads = useAgents((s) => s.threads);
  const items = useAgents((s) => s.items);
  const pages = useProject((s) => s.pages);
  return useMemo(
    () => agentActivity(threads, items, pages),
    [threads, items, pages]
  );
};
