/**
 * The welcome page of the desktop app (`welcome.html`): shown while no project is open, at the
 * first start or when a project could not start, with why. It lists the app's projects and
 * offers a new design or a folder, through `Platform`; there is no server behind it.
 */
import { CircleAlert, FolderPlus, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  canMakeNewDesigns,
  NewDesignDialog,
  openNewDesign,
} from "./components/new-design-dialog.tsx";
import { type PlatformProject, platform } from "./platform.ts";
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
          your components, or an empty folder. The list keeps it for next time.
        </p>
      </div>
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
        {projects?.add ? (
          <Button onClick={() => projects.add?.().catch(say)} variant="outline">
            <FolderPlus />
            Add a project folder…
          </Button>
        ) : null}
      </div>
      <NewDesignDialog />
    </main>
  );
};

createRoot(document.getElementById("root") as HTMLElement).render(
  <TooltipProvider delay={300}>
    <Welcome />
  </TooltipProvider>
);
