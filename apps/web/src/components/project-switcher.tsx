import { ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  type PlatformProject,
  platform,
  type ProjectSwitcher as Switcher,
} from "../platform.ts";
import { reportError } from "../state/project.ts";
import {
  canAddRemoteProjects,
  openRemoteProject,
} from "./remote-project-dialog.tsx";

/** A project in a menu: its name, and where it is under it. */
const ProjectLabel = ({ project }: { project: PlatformProject }) =>
  project.detail === undefined ? (
    project.name
  ) : (
    <span className="flex min-w-0 flex-col">
      <span>{project.name}</span>
      <span className="font-code text-muted-foreground">{project.detail}</span>
    </span>
  );

/**
 * The shell's projects, one of them open, in the header's place for the project's name: a field
 * that opens a menu of them, of the ways to another, and of those to take off the list, which
 * the open one is never among. Only a shell has a list of projects (the desktop app); in a
 * browser the header shows the one project the server runs, and this is not drawn.
 */
const SwitcherMenu = ({ switcher }: { switcher: Switcher }) => {
  const [projects, setProjects] = useState<readonly PlatformProject[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    Promise.all([switcher.list(), switcher.current()])
      .then(([list, id]) => {
        setProjects(list);
        setOpen(id);
      })
      .catch(reportError);
  }, [switcher]);
  const others = projects.filter((p) => p.id !== open);
  const remove = (id: string) =>
    switcher
      .remove(id)
      .then(() => setProjects((shown) => shown.filter((p) => p.id !== id)))
      .catch(reportError);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            className="w-full min-w-0 justify-between bg-muted font-heading-xsmall hover:border-input hover:bg-muted aria-expanded:bg-muted"
            size="sm"
            variant="ghost"
          />
        }
      >
        <span className="truncate">
          {projects.find((p) => p.id === open)?.name ?? "Choose a project"}
        </span>
        <ChevronDown className="text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-auto min-w-[max(8rem,var(--anchor-width))]">
        <DropdownMenuRadioGroup
          onValueChange={(id: string) => {
            switcher.open(id).catch(reportError);
          }}
          value={open}
        >
          {projects.map((p) => (
            <DropdownMenuRadioItem key={p.id} value={p.id}>
              <ProjectLabel project={p} />
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {projects.length > 0 ? <DropdownMenuSeparator /> : null}
        <DropdownMenuGroup>
          <DropdownMenuItem
            onClick={() => {
              switcher.showStart().catch(reportError);
            }}
          >
            New project…
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              switcher.add().catch(reportError);
            }}
          >
            Open folder…
          </DropdownMenuItem>
          {canAddRemoteProjects() ? (
            <DropdownMenuItem onClick={openRemoteProject}>
              Open over SSH…
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuGroup>
        {others.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Remove from list</DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-auto">
                {others.map((p) => (
                  <DropdownMenuItem key={p.id} onClick={() => remove(p.id)}>
                    <ProjectLabel project={p} />
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

/** The switcher when the shell keeps projects; nothing in a browser. */
export const ProjectSwitcher = () => {
  const { projects } = platform();
  return projects ? <SwitcherMenu switcher={projects} /> : null;
};

/** Whether the header gives its place to the shell's switcher. */
export const hasProjectSwitcher = () => platform().projects !== undefined;
