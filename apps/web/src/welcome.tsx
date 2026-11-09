/**
 * The desktop app's start screen (`welcome.html`, ADR 0062): shown while no project is open, at
 * the first start, when a project could not start, with why, while a project opens, until its
 * editor loads, and from the project switcher, the open project kept behind it. It starts a new
 * project from a prompt: where it goes, who picks the look and the model, as the chat composer
 * offers them. Everything already on disk opens with one button, the recent projects under it.
 * There is no server behind it: all of it goes through `Platform`.
 */
import type { FirstPrompt } from "@ultrapaint/contracts/shell-bridge";
import {
  ArrowLeft,
  ArrowUp,
  ChevronDown,
  CircleAlert,
  Folder,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { composerBox, composerText } from "./components/composer-style.ts";
import { IconButton } from "./components/icon-button.tsx";
import { Lockup } from "./components/logo.tsx";
import { QuietSelect } from "./components/quiet-select.tsx";
import {
  canAddRemoteProjects,
  openRemoteProject,
  RemoteProjectDialog,
} from "./components/remote-project-dialog.tsx";
import {
  firstStartModel,
  projectNameOf,
  type StartModel,
  startModels,
} from "./lib/start-screen.ts";
import {
  type NewDesignStepId,
  type PlatformProject,
  platform,
} from "./platform.ts";
import { isSendKey, useSendKey } from "./state/send-key.ts";
import { followTheme } from "./state/theme.ts";
import { useWindowChrome } from "./state/window-controls.ts";
import "./styles.css";

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/** Where a new project goes: a new folder in `~/Ultrapaint`, or one the person chose. */
type Where =
  | { readonly kind: "new" }
  | {
      readonly kind: "chosen";
      readonly folder: string;
      /** Holding an app (or anything) it is opened as a project; empty, written into. */
      readonly empty: boolean;
      readonly name: string;
    };

const NEW_FOLDER = "new";
const CHOSEN = "chosen";

const LOOKS = [
  { label: "Agent picks the look", value: "agent" },
  { label: "I’ll pick the look", value: "pick" },
] as const;
type Look = (typeof LOOKS)[number]["value"];

/** What the window says while a step of writing the project runs. */
const STEP_DOING: Record<NewDesignStepId, string> = {
  folder: "Making the folder…",
  git: "Making the first commit…",
  install: "Installing packages…",
  open: "Opening the project…",
  write: "Writing the project…",
};

const modelKey = (m: StartModel) => `${m.agentId}\u0000${m.model ?? ""}`;

/** The models this machine's agents offer, and the one chosen; none outside the desktop app. */
const useModels = () => {
  const { agents } = platform();
  const [models, setModels] = useState<readonly StartModel[]>([]);
  const [chosen, setChosen] = useState<StartModel | undefined>();
  useEffect(() => {
    if (!agents) {
      return;
    }
    let current = true;
    Promise.all([agents.list(), agents.preferences()])
      .then(([found, remembered]) => {
        if (!current) {
          return;
        }
        const offered = startModels(found, remembered);
        setModels(offered);
        setChosen(firstStartModel(offered, found, remembered));
      })
      // Without them the agent's own default answers.
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [agents]);
  return { chosen, models, setChosen };
};

/** A chosen folder that is a project already: opened, not prompted into. */
const AlreadyAProject = ({
  folder,
  onChooseAnother,
  onClose,
  start,
}: {
  folder: { readonly name: string; readonly path: string } | null;
  onChooseAnother: () => void;
  onClose: () => void;
  /** What was written: sent in a new chat there once it opens. */
  start: FirstPrompt | null;
}) => {
  const { projects } = platform();
  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
      open={folder !== null}
    >
      <DialogContent className="gap-5 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {folder?.name} is already an Ultrapaint project
          </DialogTitle>
          <DialogDescription>
            {start
              ? "Open it, and your prompt goes to a new chat there."
              : "Open it to go on with it."}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={onChooseAnother} variant="outline">
            Choose another folder
          </Button>
          <Button
            onClick={() => {
              if (folder) {
                projects
                  ?.openFolder(folder.path, start ?? undefined)
                  .catch(() => undefined);
              }
              onClose();
            }}
          >
            Open {folder?.name}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

/** The prompt that starts a new project, with where it goes, who picks the look and the model. */
const StartComposer = ({ onProblem }: { onProblem: (m: string) => void }) => {
  const { newDesign, pickFolder, projects } = platform();
  const sendKey = useSendKey((s) => s.sendKey);
  const [text, setText] = useState("");
  const [where, setWhere] = useState<Where>({ kind: "new" });
  const [look, setLook] = useState<Look>("agent");
  const { chosen, models, setChosen } = useModels();
  const [doing, setDoing] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  // Pressed with nothing written: what is missing, under the prompt, until something is.
  const [missing, setMissing] = useState(false);
  const promptField = useRef<HTMLTextAreaElement>(null);
  const [project, setProject] = useState<{
    readonly name: string;
    readonly path: string;
  } | null>(null);

  const chooseFolder = async () => {
    const folder = await pickFolder?.({ title: "Where the project goes" });
    if (!(folder && projects)) {
      return;
    }
    const found = await projects.inspect(folder);
    if (found.kind === "project") {
      setProject({ name: found.name, path: folder });
      return;
    }
    setWhere({
      empty: found.kind === "empty",
      folder,
      kind: "chosen",
      name: found.name,
    });
  };

  /** What the prompt starts with: its text, who picks the look, the agent and model. */
  const startOf = (prompt: string): FirstPrompt => ({
    look,
    prompt,
    ...(chosen && { agentId: chosen.agentId }),
    ...(chosen?.model !== undefined && { model: chosen.model }),
  });

  const send = async () => {
    const prompt = text.trim();
    if (!prompt) {
      setMissing(true);
      promptField.current?.focus();
      return;
    }
    if (doing !== null || !newDesign || !projects) {
      return;
    }
    const start = startOf(prompt);
    setFailed(null);
    setDoing(STEP_DOING.folder);
    try {
      // A folder holding an app is opened as it is, and the prompt sent there.
      if (where.kind === "chosen" && !where.empty) {
        setDoing(STEP_DOING.open);
        await projects.openFolder(where.folder, start);
        return;
      }
      const name = where.kind === "chosen" ? where.name : projectNameOf(prompt);
      const folder =
        where.kind === "chosen"
          ? where.folder
          : await newDesign.folderFor(name);
      const outcome = await newDesign.create(
        { code: "none", folder, git: false, name, start, template: "blank" },
        (update) => {
          if (update.state === "active") {
            setDoing(STEP_DOING[update.step]);
          }
        }
      );
      if (outcome.failed) {
        setFailed(outcome.failed.message);
      }
    } catch (error) {
      onProblem(messageOf(error));
    } finally {
      // Opened, the window shows the project's editor in place of this page.
      setDoing(null);
    }
  };

  const whereChoices = [
    { label: "New folder in ~/Ultrapaint", value: NEW_FOLDER },
    ...(where.kind === "chosen" ? [{ label: where.name, value: CHOSEN }] : []),
  ];
  const modelChoices = models.map((m) => ({
    group: m.agentName,
    label: m.label,
    value: modelKey(m),
  }));

  return (
    <div className="flex flex-col gap-3">
      <div
        className={cn(
          composerBox,
          doing !== null && "pointer-events-none opacity-60"
        )}
      >
        <textarea
          aria-label="What do you want to make?"
          autoFocus
          className={cn(composerText, "min-h-24")}
          disabled={doing !== null}
          onChange={(e) => {
            setText(e.target.value);
            setMissing(false);
          }}
          onKeyDown={(e) => {
            if (isSendKey(e, sendKey)) {
              e.preventDefault();
              send();
            }
          }}
          placeholder="A booking app for a climbing gym…"
          ref={promptField}
          value={text}
        />
        <div className="@container flex min-w-0 items-center gap-0.5 p-1.5 pt-0">
          {pickFolder ? (
            <QuietSelect
              actions={[{ label: "Choose a folder…", run: chooseFolder }]}
              choices={whereChoices}
              icon={<Folder className="size-3.5 shrink-0" />}
              label="Where it goes"
              onChange={(value) => {
                if (value === NEW_FOLDER) {
                  setWhere({ kind: "new" });
                }
              }}
              value={where.kind === "new" ? NEW_FOLDER : CHOSEN}
            />
          ) : null}
          <QuietSelect
            choices={LOOKS}
            className="shrink-0"
            label="The look"
            onChange={(value) => setLook(value as Look)}
            value={look}
          />
          <div className="flex-1" />
          {chosen ? (
            <QuietSelect
              align="end"
              choices={modelChoices}
              className="shrink-0"
              label="Model"
              onChange={(value) =>
                setChosen(models.find((m) => modelKey(m) === value))
              }
              value={modelKey(chosen)}
              {...(chosen.effort === undefined ? {} : { extra: chosen.effort })}
            />
          ) : null}
          <IconButton
            className="rounded-full"
            disabled={doing !== null}
            onClick={send}
            tooltip="Start the project"
            variant="default"
          >
            {doing === null ? <ArrowUp /> : <Spinner />}
          </IconButton>
        </div>
      </div>
      {doing === null ? null : (
        <span
          className="px-1 font-body-small text-muted-foreground"
          role="status"
        >
          {doing}
        </span>
      )}
      {missing && doing === null ? (
        <span
          className="px-1 font-body-small text-muted-foreground"
          role="status"
        >
          Say what you want to make first.
        </span>
      ) : null}
      {failed ? (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertTitle>Couldn’t start the project</AlertTitle>
          <AlertDescription className="max-h-40 overflow-y-auto whitespace-pre-wrap font-code">
            {failed}
          </AlertDescription>
        </Alert>
      ) : null}
      <AlreadyAProject
        folder={project}
        onChooseAnother={() => {
          setProject(null);
          chooseFolder().catch((error: unknown) => onProblem(messageOf(error)));
        }}
        onClose={() => setProject(null)}
        start={text.trim() ? startOf(text.trim()) : null}
      />
    </div>
  );
};

/** One button for everything already on disk: a folder here, or one over SSH. */
const OpenProject = ({ onProblem }: { onProblem: (m: string) => void }) => {
  const { projects } = platform();
  if (!projects) {
    return null;
  }
  const here = () => projects.add().catch((e) => onProblem(messageOf(e)));
  if (!canAddRemoteProjects()) {
    return (
      <Button onClick={here} size="sm" variant="outline">
        Open project…
      </Button>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button size="sm" variant="outline" />}>
        Open project
        <ChevronDown data-icon="inline-end" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={here}>
            A folder on this computer…
          </DropdownMenuItem>
          <DropdownMenuItem onClick={openRemoteProject}>
            A folder over SSH…
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

const Welcome = () => {
  const { projects } = platform();
  const [list, setList] = useState<readonly PlatformProject[]>([]);
  const query = new URLSearchParams(window.location.search);
  // Why the last project could not be opened, as the app says it.
  const [problem, setProblem] = useState(() => query.get("problem"));
  const say = (error: unknown) => setProblem(messageOf(error));
  // The project the app is opening, until its editor takes the window's place.
  const [opening] = useState(() => {
    const name = query.get("opening");
    return name ? { detail: query.get("detail") ?? "", name } : null;
  });
  // The project left open behind this page, to go back to.
  const [back] = useState(() => query.get("back"));

  useEffect(() => {
    projects
      ?.list()
      .then(setList)
      .catch((error: unknown) => setProblem(messageOf(error)));
  }, [projects]);

  const goBack = () =>
    projects
      ?.current()
      .then((id) => (id ? projects.open(id) : undefined))
      .catch(say);

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-12 px-6 py-16">
      {back ? (
        <Button
          className="fixed top-12 left-4 text-muted-foreground"
          onClick={goBack}
          size="sm"
          variant="ghost"
        >
          <ArrowLeft />
          Back to {back}
        </Button>
      ) : null}
      <section className="flex flex-col gap-6">
        <header className="flex flex-col gap-4">
          <Lockup className="h-7 self-start" />
          <div className="flex flex-col gap-1">
            <h1 className="font-heading-small">Start a new project</h1>
            <p className="text-pretty font-body text-muted-foreground">
              Say what you want to make, and an agent draws its first screens.
            </p>
          </div>
        </header>
        <StartComposer onProblem={setProblem} />
      </section>
      {opening ? (
        <div className="flex items-start gap-3 rounded-lg border bg-card p-3">
          <Spinner className="mt-0.5 shrink-0 text-muted-foreground" />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate font-body-medium">
              Opening {opening.name}…
            </span>
            {opening.detail ? (
              <span
                className="truncate font-body-small text-muted-foreground"
                title={opening.detail}
              >
                {opening.detail}
              </span>
            ) : null}
            <span className="mt-1 text-pretty font-body-small text-muted-foreground">
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
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-heading-xsmall">
            {list.length > 0 ? "Recent projects" : "No projects yet"}
          </h2>
          <OpenProject onProblem={setProblem} />
        </div>
        {list.length > 0 ? (
          <ul className="flex flex-col divide-y overflow-hidden rounded-lg border bg-card">
            {list.map((project) => (
              <li key={project.id}>
                <button
                  className="flex w-full flex-col gap-0.5 px-3 py-2 text-left outline-none transition-colors duration-100 hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                  onClick={() => projects?.open(project.id).catch(say)}
                  type="button"
                >
                  <span className="truncate font-body-medium">
                    {project.name}
                  </span>
                  {project.detail ? (
                    <span
                      className="truncate font-body-small text-muted-foreground"
                      title={project.detail}
                    >
                      {project.detail}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-pretty font-body-small text-muted-foreground">
            Open a folder that holds an app to design on it, here or over SSH.
          </p>
        )}
      </section>
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
