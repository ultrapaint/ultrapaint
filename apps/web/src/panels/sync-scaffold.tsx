/** Starting an application where there is none, from the Sync view (ADR 0025). */
import { Rocket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { startApplication } from "../lib/scaffold.ts";
import { useProject } from "../state/project.ts";
import { useSync } from "../state/sync.ts";

export const ScaffoldButton = () => {
  const settings = useProject((s) => s.settings);
  if (!settings) {
    return null;
  }
  const start = async () => {
    // The repository has a package.json at its root, or it would not be open.
    if (
      await startApplication({
        beside: true,
        repoPath: settings.repoPath,
        settings,
      })
    ) {
      await useSync.getState().load();
    }
  };
  return (
    <Button className="self-start" onClick={start} size="sm">
      <Rocket />
      Start an application…
    </Button>
  );
};
