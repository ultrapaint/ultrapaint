/**
 * The project's button in the title row and its menu (ADR 0107), the same in the desktop app and
 * in a browser: the project's icon, name and chevron, opening a menu about this project only:
 * the project as a header (icon, name, path), then Project settings (Settings › Name and icon),
 * Show in Finder where the folder is on this machine, and Copy path. It opens no project and
 * closes none: the desktop app does that from its tabs and start page.
 */
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { isMac } from "../lib/keys.ts";
import { platform } from "../platform.ts";
import { reportError, useProject } from "../state/project.ts";
import { ProjectIcon } from "./project-icon.tsx";

/** What the system's file manager is called where the editor runs. */
const fileManager = () => {
  if (isMac) {
    return "Finder";
  }
  return navigator.userAgent.includes("Windows") ? "Explorer" : "Files";
};

const copyPath = (path: string) => {
  navigator.clipboard
    .writeText(path)
    .then(() => toast.success("Path copied"))
    .catch(reportError);
};

export const ProjectMenu = () => {
  const name = useProject((s) => s.info.name) ?? "";
  const icon = useProject((s) => s.info.icon);
  const repoPath = useProject((s) => s.info.repoPath) ?? "";
  // The folder shows in the file manager only where it is on this machine: the desktop app hides
  // this machine's capabilities from a project over SSH.
  const show = platform().folders?.open;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          // As Figma's file name: a fill only under the pointer or open.
          <Button
            className="max-w-full gap-1.5 px-2 font-body-medium"
            size="lg"
            variant="ghost"
          />
        }
      >
        <ProjectIcon icon={icon} name={name} size={16} />
        <span className="truncate">{name}</span>
        <ChevronDown className="text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-70">
        <div className="flex items-center gap-2.5 px-2 py-1.5">
          <ProjectIcon icon={icon} name={name} size={24} />
          <div className="flex min-w-0 flex-col">
            <span className="truncate font-body-medium">{name}</span>
            <span className="truncate font-body-small text-muted-foreground">
              {repoPath}
            </span>
          </div>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem
            onClick={() =>
              useProject.getState().openSettings(true, "nameAndIcon")
            }
          >
            Project settings
          </DropdownMenuItem>
          {show ? (
            <DropdownMenuItem
              onClick={() => {
                show(repoPath).catch(reportError);
              }}
            >
              Show in {fileManager()}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onClick={() => copyPath(repoPath)}>
            Copy path
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
