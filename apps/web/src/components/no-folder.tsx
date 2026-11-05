import { FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { chooseFolder } from "../lib/project-setup.ts";
import { PanelEmpty } from "./panel.tsx";

/**
 * What a panel shows with no folder open: the folder is chosen in the settings. A folder opened
 * is set up in a chat (ADR 0062), so this is only ever the server started outside one.
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
    Choose the folder of the app you’ll design.
  </PanelEmpty>
);
