import { FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { chooseFolder } from "../lib/project-setup.ts";
import { PanelEmpty } from "./panel.tsx";

/**
 * What a panel shows with no folder open: any folder opens as a project (ADR 0092), so this is
 * only ever the server started in the home directory or at the root. The folder is picked with
 * the shell's picker, or typed in the settings.
 */
export const NoFolder = () => (
  <PanelEmpty
    action={
      <Button onClick={chooseFolder} size="sm" variant="outline">
        Choose a folder…
      </Button>
    }
    icon={<FolderOpen />}
    title="No folder open"
  >
    Choose a folder to design in, with an app in it or none yet.
  </PanelEmpty>
);
