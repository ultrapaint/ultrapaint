import { useEffect, useState } from "react";
import {
  type PlatformProject,
  platform,
  type ProjectSwitcher as Switcher,
} from "../platform.ts";
import { reportError } from "../state/project.ts";
import { OptionSelect } from "./option-select.tsx";
import {
  canAddRemoteProjects,
  openRemoteProject,
} from "./remote-project-dialog.tsx";

/** The option that asks the shell for another project rather than naming one. */
const ADD = "\u0000add";
/** The option that shows the start screen, the open project kept behind it. */
const NEW = "\u0000new";
/** The option that opens the dialog for a folder on another machine. */
const REMOTE = "\u0000remote";

/**
 * The shell's projects, one of them open, in the header's place for the project's name. Only a
 * shell has a list of projects (the desktop app); in a browser the header shows the one project
 * the server runs, and this is not drawn.
 */
const SwitcherSelect = ({ switcher }: { switcher: Switcher }) => {
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
  const choose = (id: string) => {
    if (id === NEW) {
      switcher.showStart().catch(reportError);
      return;
    }
    if (id === REMOTE) {
      openRemoteProject();
      return;
    }
    const next = id === ADD ? switcher.add() : switcher.open(id);
    next.catch(reportError);
  };
  return (
    <OptionSelect
      className="font-heading-xsmall"
      onChange={choose}
      options={[
        ...projects.map((p) => ({
          ...(p.detail === undefined ? {} : { description: p.detail }),
          label: p.name,
          value: p.id,
        })),
        { label: "New project…", value: NEW },
        { label: "Open folder…", value: ADD },
        ...(canAddRemoteProjects()
          ? [{ label: "Open over SSH…", value: REMOTE }]
          : []),
      ]}
      placeholder="Choose a project"
      size="sm"
      value={open}
    />
  );
};

/** The switcher when the shell keeps projects; nothing in a browser. */
export const ProjectSwitcher = () => {
  const { projects } = platform();
  return projects ? <SwitcherSelect switcher={projects} /> : null;
};

/** Whether the header gives its place to the shell's switcher. */
export const hasProjectSwitcher = () => platform().projects !== undefined;
