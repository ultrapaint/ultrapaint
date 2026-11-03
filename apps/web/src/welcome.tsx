/**
 * The welcome page of the desktop app (`welcome.html`): shown while no project is open, at the
 * first start or when a project could not start, with why, and while a project opens, until its
 * editor loads: the user can stop it or pick another project meanwhile. It lists the app's
 * projects and offers a new design or a folder, through `Platform`; there is no server behind it.
 */
import { CircleAlert, FolderPlus, Plus, Server } from "lucide-react";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  canMakeNewDesigns,
  NewDesignDialog,
  openNewDesign,
} from "./components/new-design-dialog.tsx";
import {
  canAddRemoteProjects,
  openRemoteProject,
  RemoteProjectDialog,
} from "./components/remote-project-dialog.tsx";
import { type PlatformProject, platform } from "./platform.ts";
import { useWindowChrome } from "./state/window-controls.ts";
import "./styles.css";

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const Welcome = () => {
  const { projects } = platform();
  const [list, setList] = useState<readonly PlatformProject[]>([]);
  // Why the last project could not be opened, as the app says it.
  const [problem, setProblem] = useState(() =>
    new URLSearchParams(window.location.search).get("problem")
  );
  const say = (error: unknown) => setProblem(messageOf(error));
  // The project the app is opening, until its editor takes the window's place.
  const [opening] = useState(() => {
    const query = new URLSearchParams(window.location.search);
    const name = query.get("opening");
    return name ? { detail: query.get("detail") ?? "", name } : null;
  });

  useEffect(() => {
    projects
      ?.list()
      .then(setList)
      .catch((error: unknown) => setProblem(messageOf(error)));
  }, [projects]);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 p-8">
      <div className="flex flex-col gap-1">
        <h1 className="font-heading-small">Ultrapaint</h1>
        <p className="font-body text-muted-foreground">
          Start a new design, or open a folder to design in: a repository with
          your components, or an empty folder, here or on another machine over
          SSH. The list keeps it for next time.
        </p>
      </div>
      {opening ? (
        <div className="flex items-start gap-3 rounded-md border p-3 font-body">
          <Spinner className="mt-0.5 shrink-0" />
          <div className="flex min-w-0 flex-1 flex-col">
            <span>Opening {opening.name}</span>
            <span className="truncate text-muted-foreground">
              {opening.detail}
            </span>
            <span className="text-muted-foreground">
              Starting its server. A machine that is off or out of reach can
              take a minute to give up: stop, or pick another project.
            </span>
          </div>
          {projects ? (
            <Button
              onClick={() => projects.stopOpening().catch(say)}
              size="sm"
              variant="outline"
            >
              Stop
            </Button>
          ) : null}
        </div>
      ) : null}
      {problem ? (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertDescription className="whitespace-pre-wrap">
            {problem}
          </AlertDescription>
        </Alert>
      ) : null}
      {list.length > 0 ? (
        <ul className="flex flex-col">
          {list.map((project) => (
            <li key={project.id}>
              <button
                className="flex w-full flex-col rounded-md px-2 py-1.5 text-left font-body hover:bg-accent"
                onClick={() => projects?.open(project.id).catch(say)}
                type="button"
              >
                <span>{project.name}</span>
                {project.detail ? (
                  <span className="truncate text-muted-foreground">
                    {project.detail}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {canMakeNewDesigns() ? (
          <Button onClick={openNewDesign}>
            <Plus />
            New design…
          </Button>
        ) : null}
        {projects ? (
          <Button onClick={() => projects.add().catch(say)} variant="outline">
            <FolderPlus />
            Add a project folder…
          </Button>
        ) : null}
        {canAddRemoteProjects() ? (
          <Button onClick={openRemoteProject} variant="outline">
            <Server />
            Open over SSH…
          </Button>
        ) : null}
      </div>
      <NewDesignDialog />
      <RemoteProjectDialog />
    </main>
  );
};

/** A window that draws no title bar of its own (a Mac) is moved by the top of the page. */
const WindowTop = () =>
  useWindowChrome().drag ? (
    <div className="window-drag fixed inset-x-0 top-0 h-11" />
  ) : null;

createRoot(document.getElementById("root") as HTMLElement).render(
  <TooltipProvider delay={300}>
    <WindowTop />
    <Welcome />
  </TooltipProvider>
);
