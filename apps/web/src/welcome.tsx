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
  Ellipsis,
  Folder,
  Plus,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
import { UpdateButton } from "./components/app-update.tsx";
import { TextFileChip } from "./components/chip.tsx";
import { composerBox, composerText } from "./components/composer-style.ts";
import { DialogHost } from "./components/dialogs.tsx";
import { FileDropBox, FilesInput } from "./components/file-drop.tsx";
import { IconButton } from "./components/icon-button.tsx";
import { ImageThumb } from "./components/image-thumb.tsx";
import { Lockup } from "./components/logo.tsx";
import { QuietSelect } from "./components/quiet-select.tsx";
import {
  canAddRemoteProjects,
  openRemoteProject,
  RemoteProjectDialog,
} from "./components/remote-project-dialog.tsx";
import { admit, pastedImages, readFiles } from "./lib/attach-files.ts";
import { attachmentOfFile, type FileChip } from "./lib/file-chips.ts";
import { removeFromList } from "./lib/remove-project.ts";
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
import { useWindowChrome } from "./state/window-controls.ts";

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/** What the page could not do, as its alert titles it, and why. */
interface Problem {
  readonly message: string;
  readonly title: string;
}

/** A problem met opening a project, unless `title` says doing what. */
const problemOf = (
  error: unknown,
  title = "Couldn’t open the project"
): Problem => ({ message: messageOf(error), title });

/**
 * Where a new project goes: a new folder in the new projects' folder (`~/Ultrapaint` unless the
 * person changed it, ADR 0091), or one the person chose.
 */
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

const SEPARATORS = /[/\\]/;

/** A folder's own name, the last part of its path. */
const folderName = (folder: string) =>
  folder.split(SEPARATORS).filter(Boolean).at(-1) ?? folder;

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
  onProblem,
  start,
}: {
  folder: { readonly name: string; readonly path: string } | null;
  onChooseAnother: () => void;
  onClose: () => void;
  onProblem: (m: string) => void;
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
      <DialogContent className="gap-5">
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
                  .catch((error: unknown) => onProblem(messageOf(error)));
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
  const { folders, newDesign, pickFolder, projects } = platform();
  // Where a new folder goes, once the app says: the person may have changed it (ADR 0091).
  const [newProjects, setNewProjects] = useState<string | null>(null);
  useEffect(() => {
    folders
      ?.current()
      .then((current) => setNewProjects(current.newProjects))
      // Unread, the choice keeps its usual words.
      .catch(() => undefined);
  }, [folders]);
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
  // Pictures and text files for the first chat, as its composer takes them (ADR 0064).
  const [files, setFiles] = useState<readonly FileChip[]>([]);
  // Why files were not attached, under the prompt, until more are added.
  const [refused, setRefused] = useState<readonly string[]>([]);
  const picker = useRef<HTMLInputElement>(null);
  const attach = async (picked: readonly File[]) => {
    const read = await readFiles(picked, "files");
    const admitted = admit(files, read.chips);
    setFiles((now) => [...now, ...admitted.chips]);
    setRefused([...read.refused, ...admitted.refused]);
  };
  const detach = (chip: FileChip) => {
    setFiles((now) => now.filter((f) => f.id !== chip.id));
    setRefused([]);
  };
  const pictures = files.filter((f) => f.kind === "image");
  const texts = files.filter((f) => f.kind === "text");
  const [project, setProject] = useState<{
    readonly name: string;
    readonly path: string;
  } | null>(null);

  /** A folder picked for the project; one that cannot be picked or looked into is said on the page. */
  const chooseFolder = async () => {
    try {
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
    } catch (error) {
      onProblem(messageOf(error));
    }
  };

  /** What the prompt starts with: its text, who picks the look, the agent and model. */
  const startOf = (prompt: string): FirstPrompt => ({
    look,
    prompt,
    ...(files.length > 0 && { attachments: files.map(attachmentOfFile) }),
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
    {
      label: `New folder in ${newProjects ? folderName(newProjects) : "~/Ultrapaint"}`,
      value: NEW_FOLDER,
    },
    ...(where.kind === "chosen" ? [{ label: where.name, value: CHOSEN }] : []),
  ];
  const modelChoices = models.map((m) => ({
    group: m.agentName,
    label: m.label,
    value: modelKey(m),
  }));

  return (
    <div className="flex flex-col gap-3">
      <FileDropBox
        className={cn(
          composerBox,
          doing !== null && "pointer-events-none opacity-60"
        )}
        hint="Drop to attach"
        onFiles={attach}
      >
        {pictures.length > 0 ? (
          <div className="flex flex-wrap gap-2 px-2 pt-2">
            {pictures.map((chip) => (
              <ImageThumb
                chip={chip}
                key={chip.id}
                onRemove={() => detach(chip)}
              />
            ))}
          </div>
        ) : null}
        {texts.length > 0 ? (
          <div className="flex flex-wrap gap-1 px-2 pt-2">
            {texts.map((chip) => (
              <TextFileChip
                chip={chip}
                key={chip.id}
                onRemove={() => detach(chip)}
              />
            ))}
          </div>
        ) : null}
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
          onPaste={(e) => {
            // An image on the clipboard is attached rather than pasted as text.
            const pasted = pastedImages(e.clipboardData);
            if (pasted.length > 0) {
              e.preventDefault();
              attach(pasted);
            }
          }}
          placeholder="A booking app for a climbing gym…"
          ref={promptField}
          value={text}
        />
        <div className="@container flex min-w-0 items-center gap-0.5 p-1.5 pt-0">
          <IconButton
            className="shrink-0 text-muted-foreground"
            disabled={doing !== null}
            onClick={() => picker.current?.click()}
            tooltip="Add pictures or files"
          >
            <Plus />
          </IconButton>
          <FilesInput onFiles={attach} ref={picker} />
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
      </FileDropBox>
      {doing === null ? null : (
        <span
          className="px-1 font-body-small text-muted-foreground"
          role="status"
        >
          {doing}
        </span>
      )}
      {refused.length > 0 ? (
        <span
          className="whitespace-pre-line px-1 font-body-small text-muted-foreground"
          role="status"
        >
          {refused.join("\n")}
        </span>
      ) : null}
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
          chooseFolder();
        }}
        onClose={() => setProject(null)}
        onProblem={onProblem}
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

/**
 * A project of the list: the row opens it, and its menu takes it off the list, asking first
 * when its unsaved designs would go with it. The one open behind this page stays on it.
 */
const ProjectRow = ({
  isOpen,
  onOpen,
  onRemove,
  project,
}: {
  isOpen: boolean;
  onOpen: () => void;
  onRemove: () => void;
  project: PlatformProject;
}) => (
  <li className="flex items-center gap-1 pr-1.5 transition-colors duration-100 hover:bg-accent has-focus-visible:bg-accent">
    <button
      className="flex min-w-0 flex-1 flex-col gap-0.5 px-3 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      onClick={onOpen}
      type="button"
    >
      <span className="truncate font-body-medium">{project.name}</span>
      {project.detail ? (
        <span
          className="truncate font-body-small text-muted-foreground"
          title={project.detail}
        >
          {project.detail}
        </span>
      ) : null}
    </button>
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            aria-label={`Actions for ${project.name}`}
            className="shrink-0 text-muted-foreground"
            size="icon"
            variant="ghost"
          >
            <Ellipsis />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem disabled={isOpen} onClick={onRemove}>
          Remove from list
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </li>
);

const Welcome = () => {
  const { projects } = platform();
  const [list, setList] = useState<readonly PlatformProject[]>([]);
  // The project open behind this page, which stays on the list.
  const [current, setCurrent] = useState<string | null>(null);
  const query = new URLSearchParams(window.location.search);
  // What could not be done: at first, why the last project could not be opened, as the app
  // says it.
  const [problem, setProblem] = useState(() => {
    const message = query.get("problem");
    return message ? problemOf(message) : null;
  });
  const say = (error: unknown) => setProblem(problemOf(error));
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
      .catch((error: unknown) => setProblem(problemOf(error)));
    projects
      ?.current()
      .then(setCurrent)
      .catch((error: unknown) => setProblem(problemOf(error)));
  }, [projects]);

  const remove = (project: PlatformProject) => {
    if (!projects) {
      return;
    }
    removeFromList(projects, project)
      .then((gone) => {
        if (gone) {
          setList((shown) => shown.filter((p) => p.id !== project.id));
        }
      })
      .catch((error: unknown) =>
        setProblem(problemOf(error, "Couldn’t remove the project"))
      );
  };

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
      <UpdateButton className="fixed top-12 right-4 text-muted-foreground" />
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
        <StartComposer onProblem={say} />
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
          <AlertTitle>{problem.title}</AlertTitle>
          <AlertDescription className="whitespace-pre-wrap">
            {problem.message}
          </AlertDescription>
        </Alert>
      ) : null}
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-heading-xsmall">
            {list.length > 0 ? "Recent projects" : "No projects yet"}
          </h2>
          <OpenProject onProblem={say} />
        </div>
        {list.length > 0 ? (
          <ul className="flex flex-col divide-y overflow-hidden rounded-lg border bg-card">
            {list.map((project) => (
              <ProjectRow
                isOpen={project.id === current}
                key={project.id}
                onOpen={() => projects?.open(project.id).catch(say)}
                onRemove={() => remove(project)}
                project={project}
              />
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

/** The whole page, as the window's entry draws it (`welcome-main.tsx`) and the tests do. */
export const WelcomePage = () => (
  <TooltipProvider delay={300}>
    <WindowTop />
    <Welcome />
    <DialogHost />
  </TooltipProvider>
);
