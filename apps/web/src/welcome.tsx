/**
 * The welcome page of the desktop app (`welcome.html`): shown while no project is open, at the
 * first start or when a project could not start, with why, and while a project opens, until its
 * editor loads: the user can stop it or pick another project meanwhile. It lists the app's
 * projects and offers a new design or a folder, through `Platform`; there is no server behind it.
 */
import { CircleAlert, FolderOpen, Plus, Server } from "lucide-react";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Logo } from "./components/logo.tsx";
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
import { followTheme } from "./state/theme.ts";
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
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-8 px-6 py-16">
      <header className="flex flex-col gap-4">
        <Logo className="size-9" />
        <div className="flex flex-col gap-1">
          <h1 className="font-heading-small">Welcome to Ultrapaint</h1>
          <p className="text-pretty font-body text-muted-foreground">
            Design in a repository with your own components, beside your agents.
            Open a folder, here or over SSH, or start a new design.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canMakeNewDesigns() ? (
            <Button onClick={openNewDesign}>
              <Plus />
              New design…
            </Button>
          ) : null}
          {projects ? (
            <Button onClick={() => projects.add().catch(say)} variant="outline">
              <FolderOpen />
              Open folder…
            </Button>
          ) : null}
          {canAddRemoteProjects() ? (
            <Button onClick={openRemoteProject} variant="outline">
              <Server />
              Open over SSH…
            </Button>
          ) : null}
        </div>
      </header>
      {opening ? (
        <div className="flex items-start gap-3 rounded-lg border bg-card p-3">
          <Spinner className="mt-0.5 shrink-0 text-muted-foreground" />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate font-label">Opening {opening.name}…</span>
            {opening.detail ? (
              <span
                className="truncate font-small text-muted-foreground"
                title={opening.detail}
              >
                {opening.detail}
              </span>
            ) : null}
            <span className="mt-1 text-pretty font-small text-muted-foreground">
              Starting its server. A machine that is off or out of reach can
              take a minute to give up.
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
          <AlertTitle>Couldn’t open the project</AlertTitle>
          <AlertDescription className="whitespace-pre-wrap">
            {problem}
          </AlertDescription>
        </Alert>
      ) : null}
      {list.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="px-1 font-small text-muted-foreground">Recent</h2>
          <ul className="flex flex-col divide-y overflow-hidden rounded-lg border bg-card">
            {list.map((project) => (
              <li key={project.id}>
                <button
                  className="flex w-full flex-col gap-0.5 px-3 py-2 text-left outline-none transition-colors duration-100 hover:bg-accent focus-visible:bg-accent"
                  onClick={() => projects?.open(project.id).catch(say)}
                  type="button"
                >
                  <span className="truncate font-label">{project.name}</span>
                  {project.detail ? (
                    <span
                      className="truncate font-small text-muted-foreground"
                      title={project.detail}
                    >
                      {project.detail}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
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

// The editor's theme, or the system's: the page is the editor's first face.
followTheme();

createRoot(document.getElementById("root") as HTMLElement).render(
  <TooltipProvider delay={300}>
    <WindowTop />
    <Welcome />
  </TooltipProvider>
);
