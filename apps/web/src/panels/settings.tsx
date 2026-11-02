import type { DesignDocument } from "@ultrapaint/contracts/design-system";
import type { Settings, StorageInfo } from "@ultrapaint/contracts/settings";
import {
  CONFIG_FILE_NAME,
  defaultSettings,
  LEGACY_CONFIG_FILE_NAME,
  writesGit,
} from "@ultrapaint/contracts/settings";
import {
  describeSuggestions,
  type SetupSuggestions,
} from "@ultrapaint/contracts/setup";
import { tokensOfKind } from "@ultrapaint/contracts/token-table";
import { cn } from "cn";
import {
  ArrowLeft,
  Bot,
  CircleAlert,
  FolderGit2,
  FolderSearch,
  type LucideIcon,
  SlidersHorizontal,
  SwatchBook,
  TriangleAlert,
  Wand2,
} from "lucide-react";
import type * as React from "react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { placeDocument } from "../lib/place-document.ts";
import { detect, save, setUpDesigns } from "../lib/settings-actions.ts";
import { startInit } from "../lib/start-thread.ts";
import { platform } from "../platform.ts";
import { api } from "../state/connection.ts";
import { useDesignSystem } from "../state/design-system.ts";
import { showLeftPanel } from "../state/panels.ts";
import { reportError, useProject } from "../state/project.ts";
import { useWindowChrome } from "../state/window-controls.ts";
import {
  ChatDefaultsGroup,
  MachineAgentsGroup,
  McpConnectionGroup,
  SendKeyGroup,
  SkillsGroup,
} from "./settings-agents.tsx";
import { Group, Row } from "./settings-group.tsx";
import { ProfileGroup } from "./settings-profile.tsx";

const LIST_SEPARATOR_RE = /[\n,]/;

const MISSING_DESIGNS_PREFIX = "Designs directory does not exist";

const list = (v: string) =>
  v
    .split(LIST_SEPARATOR_RE)
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * Settings take the whole window rather than a dialog: the form is longer than a dialog can
 * hold. The editor is not mounted behind it. A sidebar picks a section;
 * the section is groups of rows, one setting per row, its control on the right.
 */
type SectionId = "repository" | "designSystem" | "editor" | "agents";

const sections: readonly {
  icon: LucideIcon;
  id: SectionId;
  label: string;
  /** Sections that only make sense once there are settings to work against. */
  needsSaved?: boolean;
}[] = [
  { icon: FolderGit2, id: "repository", label: "Repository" },
  { icon: SwatchBook, id: "designSystem", label: "Design system" },
  { icon: SlidersHorizontal, id: "editor", label: "Editor" },
  { icon: Bot, id: "agents", label: "Agents", needsSaved: true },
];

/** Where `/init` is started from the settings, and where its result is said to be. */
/** Where DESIGN.md is, and whether the format's linter is content with it. */
const documentDescription = (document: DesignDocument | null) => {
  if (!document) {
    return "The design system in the open format every agent reads, at the root of the repository. There is none yet.";
  }
  if (document.legacy) {
    return `${document.path}: in the designs directory. At the root of the repository, agents outside the editor find it too, and its front matter follows the design system's tokens.`;
  }
  const errors = document.findings.filter((f) => f.severity === "error").length;
  const warnings = document.findings.filter(
    (f) => f.severity === "warning"
  ).length;
  const lint =
    errors + warnings === 0
      ? "The format's linter finds nothing to say."
      : `The format's linter finds ${[errors > 0 ? `${errors} error${errors === 1 ? "" : "s"}` : "", warnings > 0 ? `${warnings} warning${warnings === 1 ? "" : "s"}` : ""].filter(Boolean).join(" and ")}: the Design system panel lists them.`;
  return `${document.path}, its front matter following the design system's tokens. ${lint}`;
};

const DesignSystemGroup = () => {
  const designSystem = useDesignSystem((s) => s.designSystem);
  const document = useDesignSystem((s) => s.document);
  const detecting = useDesignSystem((s) => s.detecting);
  const loaded = useDesignSystem((s) => s.loaded);
  useEffect(() => {
    if (!loaded) {
      useDesignSystem.getState().load();
    }
  }, [loaded]);
  const open = () => {
    useProject.getState().openSettings(false);
    showLeftPanel("designSystem");
  };
  const init = () => {
    useProject.getState().openSettings(false);
    startInit();
  };
  return (
    <Group
      description="What the agents and the inspector know about the design system: its tokens, its text styles, and how it is meant to be used."
      title="Tokens and conventions"
    >
      <Row
        description={
          designSystem
            ? `Imported: ${tokensOfKind(designSystem, "color").length} colours, ${designSystem.typography.styles.length} text styles. Kept in design-system.json in the designs directory, and DESIGN.md at the root of the repository.`
            : "Not imported yet. An agent reads the Tailwind v4 theme and the components, asks you about the application, and writes design-system.json and DESIGN.md."
        }
        title={designSystem ? "Imported design system" : "Design system"}
        wide
      >
        <div className="flex flex-wrap justify-end gap-1">
          {designSystem ? (
            <Button onClick={open} variant="ghost">
              Show
            </Button>
          ) : null}
          <Button
            disabled={detecting}
            onClick={() => useDesignSystem.getState().detect()}
            variant="ghost"
          >
            Detect automatically
          </Button>
          <Button onClick={init} variant="outline">
            <Wand2 />
            {designSystem ? "Update with an agent" : "Initialise with an agent"}
          </Button>
        </div>
      </Row>
      {designSystem ? (
        <Row description={documentDescription(document)} title="DESIGN.md" wide>
          {document?.legacy || !document ? (
            <Button onClick={placeDocument} variant="outline">
              {document ? "Move to the repository root" : "Write it"}
            </Button>
          ) : null}
        </Row>
      ) : null}
    </Group>
  );
};

export const SettingsPage = () => {
  const saved = useProject((s) => s.settings);
  const loaded = useProject((s) => s.loaded);
  // Mounted with the page, so every open starts from the saved settings. A reload that lands
  // here waits for them, and for the repository the server proposes.
  return loaded ? <SettingsForm saved={saved} /> : null;
};

/** Where a save goes, in the words of the storage mode the server runs in. */
const storageLine = (storage: StorageInfo, detected: boolean) => {
  if (detected) {
    return "Detected in the repository and not saved: Apply keeps them while the tool runs, Save to file… for good.";
  }
  if (storage.mode === "ephemeral") {
    return storage.session
      ? "Started without a configuration file: these settings are kept until the command stops."
      : "Started without a configuration file: these settings are not saved.";
  }
  return `Saved to ${storage.configPath}`;
};

/** Moves a configuration file still under its earlier name to the current one. */
const renameConfig = () =>
  api()
    .request("settings.renameConfig", undefined)
    .then((path) => toast.success(`Renamed to ${path}`))
    .catch(reportError);

/** Why the last save was refused, with the way out when the designs directory is missing. */
const SaveProblems = ({
  busy,
  designsDir,
  onCreateDesigns,
  problems,
}: {
  busy: boolean;
  designsDir: string;
  onCreateDesigns: () => void;
  problems: readonly string[];
}) => {
  if (problems.length === 0) {
    return null;
  }
  const missingDesigns = problems.some((p) =>
    p.startsWith(MISSING_DESIGNS_PREFIX)
  );
  return (
    <Alert variant="destructive">
      <CircleAlert />
      <AlertTitle>The settings could not be saved</AlertTitle>
      <AlertDescription>
        <ul className="list-disc pl-4">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
        {missingDesigns ? (
          <div className="mt-2 flex flex-col gap-1">
            <Button
              className="self-start"
              disabled={busy}
              onClick={onCreateDesigns}
              size="sm"
              variant="outline"
            >
              Create {designsDir}
            </Button>
            <span className="font-body text-muted-foreground">
              Creates the directory: pages import nothing (ADR 0040), so nothing
              is installed or linked.
            </span>
          </div>
        ) : null}
      </AlertDescription>
    </Alert>
  );
};

/**
 * Stylesheets no style system the tool has reads are said before anything is saved, in the
 * style system's words.
 */
const StylesAlert = ({ found }: { found: SetupSuggestions }) =>
  found.styleSystem === undefined ? (
    <Alert variant="destructive">
      <TriangleAlert />
      <AlertDescription>
        {found.stylesNote ??
          "The stylesheets are not written in a style system ultrapaint reads."}
      </AlertDescription>
    </Alert>
  ) : null;

/**
 * Whether a section is there before anything is saved: not one that needs a project, except the
 * agents where the shell has agents of its own to set up (the desktop app).
 */
const shown = (id: SectionId) =>
  !sections.find((s) => s.id === id)?.needsSaved ||
  (id === "agents" && platform().agents !== undefined);

/** The sections on the left. The first run has nothing saved, so it hides what needs a project. */
/**
 * The sidebar's heading. In a desktop window that draws no title bar of its own (a Mac) the
 * window's buttons sit at its start: it leaves them room, is as tall as the editor's title card
 * so they stay where they were, and moves the window when dragged.
 */
const SettingsTitle = () => {
  const chrome = useWindowChrome();
  return (
    <div
      className={cn(
        "flex shrink-0 items-center px-4",
        chrome.drag ? "window-drag h-15" : "h-12"
      )}
      style={chrome.inset > 0 ? { paddingLeft: chrome.inset } : undefined}
    >
      <h1 className="font-semibold">Settings</h1>
    </div>
  );
};

/** Where in the settings this is; as tall as the sidebar's heading, and as draggable. */
const SectionHeader = ({ label }: { label: string }) => {
  const chrome = useWindowChrome();
  return (
    <header
      className={cn(
        "flex shrink-0 items-center gap-1.5 border-b px-6 font-body",
        chrome.drag ? "window-drag h-15" : "h-12"
      )}
    >
      <span className="text-muted-foreground">Settings</span>
      <span className="text-muted-foreground">/</span>
      <span className="font-medium">{label}</span>
    </header>
  );
};

const Sidebar = ({
  onBack,
  onSelect,
  section,
  showAll,
}: {
  onBack: () => void;
  onSelect: (id: SectionId) => void;
  section: SectionId;
  showAll: boolean;
}) => (
  <aside className="flex w-56 shrink-0 flex-col border-r bg-sidebar">
    <SettingsTitle />
    <nav aria-label="Settings sections" className="flex flex-col gap-0.5 p-2">
      {sections
        .filter((s) => showAll || shown(s.id))
        .map(({ icon: Icon, id, label }) => {
          const active = id === section;
          return (
            <button
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex h-8 items-center gap-2.5 rounded-md px-2.5 text-left font-body outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/30",
                active
                  ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground"
              )}
              key={id}
              onClick={() => onSelect(id)}
              type="button"
            >
              <Icon className="size-4 shrink-0" />
              {label}
            </button>
          );
        })}
    </nav>
    <div className="mt-auto p-2">
      <Button
        className="w-full justify-start text-muted-foreground"
        onClick={onBack}
        variant="ghost"
      >
        <ArrowLeft />
        Back to the editor
      </Button>
    </div>
  </aside>
);

/** The agents: before anything is saved, only those on this computer, which need no project. */
const AgentsSection = ({
  disabledSkills,
  onSkill,
  saved,
}: {
  disabledSkills: readonly string[];
  onSkill: (name: string, enabled: boolean) => void;
  saved: boolean;
}) =>
  saved ? (
    <>
      <MachineAgentsGroup />
      <ChatDefaultsGroup />
      <SkillsGroup disabled={disabledSkills} onToggle={onSkill} />
      <McpConnectionGroup />
    </>
  ) : (
    <MachineAgentsGroup />
  );

const SettingsForm = ({ saved }: { saved: Settings | null }) => {
  const storage = useProject((s) => s.info.storage);
  const detected = useProject((s) => s.info.setup === "detected");
  const [draft, setDraft] = useState<Settings>(
    saved ?? defaultSettings(storage.defaultRepoPath ?? "")
  );
  const wanted = useProject((s) => s.settingsSection);
  // The URL may name a section that does not exist, or one the first run hides.
  const section: SectionId =
    sections.find((s) => s.id === wanted && (saved || shown(s.id)))?.id ??
    "repository";
  const setSection = (id: SectionId) =>
    useProject.getState().openSettings(true, id);
  const unsaved = storage.mode === "ephemeral";
  // A configuration file in the repository says where the repository is by where it lies.
  const repoFromFile = storage.mode === "file";
  const [problems, setProblems] = useState<readonly string[]>([]);
  const [busy, setBusy] = useState(false);
  const idleLabel = unsaved ? "Apply" : "Save and open";
  const saveLabel = busy ? "Validating…" : idleLabel;

  const apply = async (): Promise<boolean> => {
    setBusy(true);
    let ok = false;
    try {
      const refused = await save(draft);
      setProblems(refused);
      ok = refused.length === 0;
      if (ok) {
        useProject.getState().openSettings(false);
      }
    } catch (error) {
      setProblems([(error as Error).message]);
    }
    setBusy(false);
    return ok;
  };
  // The design system is offered at the first edit, by the setup dialog.
  const saveAndOpen = async () => {
    await apply();
  };
  const saveToFile = async () => {
    if (await apply()) {
      useProject.getState().openSaveConfig(true);
    }
  };

  // ---- first-run setup: what the repository looks like ----
  const [found, setFound] = useState<SetupSuggestions | null>(null);
  const detectNow = () => {
    if (!draft.repoPath) {
      return;
    }
    detect(draft.repoPath)
      .then((detection) => {
        setFound(detection.found);
        setDraft(detection.onto);
        setProblems([]);
      })
      .catch((error: Error) => setProblems([error.message]));
  };
  // Nothing is configured yet and the server knows a repository: propose a setup for it.
  const firstRepoPath = saved ? "" : (storage.defaultRepoPath ?? "");
  useEffect(() => {
    if (!firstRepoPath) {
      return;
    }
    detect(firstRepoPath)
      .then((detection) => {
        setFound(detection.found);
        setDraft(detection.onto);
      })
      // The form works without suggestions; a repository that cannot be read says so on save.
      .catch(() => setFound(null));
  }, [firstRepoPath]);

  const createDesigns = async () => {
    setBusy(true);
    try {
      const refused = await setUpDesigns(draft);
      setProblems(refused);
      if (refused.length === 0) {
        useProject.getState().openSettings(false);
      }
    } catch (error) {
      setProblems([(error as Error).message]);
    }
    setBusy(false);
  };

  const cancel = () => useProject.getState().openSettings(false);
  // Escape leaves the page, as it closed the dialog. The editor opens without settings too.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) {
        useProject.getState().openSettings(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const onRepoPath = (e: React.ChangeEvent<HTMLInputElement>) => {
    const repoPath = e.target.value;
    setDraft((d) => ({ ...d, repoPath }));
  };
  // A shell with a native folder picker offers it beside the typed path (Platform).
  const { pickFolder } = platform();
  const chooseFolder = () =>
    pickFolder?.({
      defaultPath: draft.repoPath || undefined,
      title: "The project's folder",
    })
      .then((repoPath) => {
        if (repoPath) {
          setDraft((d) => ({ ...d, repoPath }));
        }
      })
      .catch((error: Error) => setProblems([error.message]));
  const onResolveFrom = (e: React.ChangeEvent<HTMLInputElement>) => {
    const resolveFrom = e.target.value.trim() || undefined;
    setDraft((d) => ({ ...d, resolveFrom }));
  };
  const onDesignsDir = (e: React.ChangeEvent<HTMLInputElement>) => {
    const designsDir = e.target.value;
    setDraft((d) => ({ ...d, designsDir }));
  };
  const onHostCss = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const hostCss = list(e.target.value);
    setDraft((d) => ({ ...d, hostCss }));
  };
  const onLibraryDirs = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const libraryDirs = list(e.target.value);
    setDraft((d) => ({ ...d, libraryDirs }));
  };
  const onPagePngs = (on: boolean) =>
    setDraft((d) => ({ ...d, pagePngs: on || undefined }));
  const onGit = (on: boolean) =>
    setDraft((d) => ({ ...d, git: on ? "on" : undefined }));
  const onSkill = (name: string, enabled: boolean) =>
    setDraft((d) => {
      const current = d.skills?.disabled ?? [];
      const disabled = enabled
        ? current.filter((n) => n !== name)
        : [...current.filter((n) => n !== name), name];
      return { ...d, skills: disabled.length === 0 ? undefined : { disabled } };
    });

  const label = sections.find((s) => s.id === section)?.label ?? "";

  const repository = (
    <>
      {found ? (
        <Alert>
          <FolderSearch />
          <AlertDescription>{describeSuggestions(found)}</AlertDescription>
        </Alert>
      ) : null}
      {found ? <StylesAlert found={found} /> : null}
      <Group
        description="The tool runs against a local repository. Design files live inside it and are versioned with the code."
        title="Location"
      >
        <Row
          description={
            repoFromFile
              ? "Given by where the configuration file is."
              : "Absolute path to the project's folder, a git repository or not. It needs no package.json: the canvas runs none of its code."
          }
          htmlFor="settings-repo"
          title="Repository path"
          wide
        >
          <div className="flex gap-1">
            <Input
              id="settings-repo"
              onChange={onRepoPath}
              placeholder="/Users/you/code/repo"
              readOnly={repoFromFile}
              value={draft.repoPath}
            />
            {pickFolder && !repoFromFile ? (
              <Button onClick={chooseFolder} variant="outline">
                Choose…
              </Button>
            ) : null}
          </div>
        </Row>
        <Row
          description="Relative to the repository. Pages are saved here as design documents (.page.json, one element per line), with the design system beside them. Changing it opens the project there; the pages already written stay where they are."
          htmlFor="settings-designs"
          title="Designs directory"
        >
          <Input
            id="settings-designs"
            onChange={onDesignsDir}
            placeholder="products/prime/designs"
            value={draft.designsDir}
          />
        </Row>
      </Group>
      <Group
        description="Optional hints for the agents that implement a design: where your application and its components are. The canvas draws ultrapaint's system components, whatever is set here."
        title="Implementation"
      >
        <Row
          description="The package of the repository that is your application: where designs are implemented, and what its stylesheets' imports resolve from. Empty when the designs directory is a package of its own."
          htmlFor="settings-resolve"
          title="Application"
        >
          <Input
            id="settings-resolve"
            onChange={onResolveFrom}
            placeholder="apps/web"
            value={draft.resolveFrom ?? ""}
          />
        </Row>
        <Row
          description="Where the application's own components are, relative to the repository, one per line: where an agent applies a system component's look."
          htmlFor="settings-libs"
          title="Component directories"
          wide
        >
          <Textarea
            className="min-h-14 font-code"
            id="settings-libs"
            onChange={onLibraryDirs}
            value={draft.libraryDirs.join("\n")}
          />
        </Row>
      </Group>
      <Group
        description="Pictures of the screens, kept in the repository beside the design documents."
        title="Pictures"
      >
        <Row
          description="Writes a PNG of every page beside its file (orders.page.png), drawn by the editor's preview at the size of the page's frame and drawn again when the page or the design system changes. Anyone browsing the repository sees the screens, and pull requests show them as image diffs."
          htmlFor="settings-page-pngs"
          title="PNG of every page"
        >
          <div className="flex justify-end">
            <Switch
              checked={draft.pagePngs === true}
              id="settings-page-pngs"
              onCheckedChange={onPagePngs}
            />
          </div>
        </Row>
      </Group>
      <Group
        description="Where the folder is a git repository, the Changes panel shows its status and diffs, and the branch is shown. The tool needs no git."
        title="Git"
      >
        <Row
          description="Lets the Changes panel commit the files you pick, and make a folder that is no repository one. Off, the tool never writes to git."
          htmlFor="settings-git"
          title="Write to git"
        >
          <div className="flex justify-end">
            <Switch
              checked={writesGit(draft)}
              id="settings-git"
              onCheckedChange={onGit}
            />
          </div>
        </Row>
      </Group>
      <Group title="Detection">
        <Row
          description="Reads the repository and fills in the designs directory and the stylesheets it finds, with the hints for implementing. What you typed is replaced."
          title="Detect from repository"
        >
          <div className="flex justify-end">
            <Button
              disabled={!draft.repoPath}
              onClick={detectNow}
              variant="outline"
            >
              <FolderSearch />
              Detect
            </Button>
          </div>
        </Row>
      </Group>
    </>
  );

  const designSystem = (
    <>
      <Group
        description="Where the code's tokens are: Sync reads the design system from them and writes the design's values back."
        title="Sources"
      >
        <Row
          description="One per line, as the setup writes them (relative to the designs directory's .ultrapaint folder): the Tailwind v4 entry with its theme, and its fonts."
          htmlFor="settings-css"
          title="Stylesheets"
          wide
        >
          <Textarea
            className="min-h-14 font-code"
            id="settings-css"
            onChange={onHostCss}
            value={draft.hostCss.join("\n")}
          />
        </Row>
      </Group>
      {saved ? <DesignSystemGroup /> : null}
    </>
  );

  const editor = (
    <>
      <ProfileGroup />
      <SendKeyGroup />
    </>
  );

  const agents = (
    <AgentsSection
      disabledSkills={draft.skills?.disabled ?? []}
      onSkill={onSkill}
      saved={saved !== null}
    />
  );

  const body = {
    agents,
    designSystem,
    editor,
    repository,
  }[section];

  return (
    <div className="flex h-full bg-background">
      <Sidebar
        onBack={cancel}
        onSelect={setSection}
        section={section}
        showAll={saved !== null}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <SectionHeader label={label} />
        <div className="@container min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-8">
            {body}
          </div>
        </div>
        <footer className="shrink-0 border-t">
          <div className="mx-auto flex max-w-3xl flex-col gap-3 px-6 py-4">
            <SaveProblems
              busy={busy}
              designsDir={draft.designsDir}
              onCreateDesigns={createDesigns}
              problems={problems}
            />
            <div className="flex items-center justify-between gap-4">
              <p
                className={cn(
                  "min-w-0 truncate font-body",
                  unsaved ? "text-warning" : "text-muted-foreground"
                )}
                title={storageLine(storage, detected)}
              >
                {storageLine(storage, detected)}
              </p>
              <div className="flex shrink-0 gap-1">
                {storage.configPath?.endsWith(`/${LEGACY_CONFIG_FILE_NAME}`) ? (
                  <Button
                    onClick={renameConfig}
                    title={`${LEGACY_CONFIG_FILE_NAME} is the file's old name`}
                    variant="ghost"
                  >
                    Rename to {CONFIG_FILE_NAME}
                  </Button>
                ) : null}
                <Button onClick={cancel} variant="outline">
                  Cancel
                </Button>
                {unsaved ? (
                  <Button
                    disabled={busy}
                    onClick={saveToFile}
                    variant="outline"
                  >
                    Save to file…
                  </Button>
                ) : null}
                <Button disabled={busy} onClick={saveAndOpen}>
                  {saveLabel}
                </Button>
              </div>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
};
