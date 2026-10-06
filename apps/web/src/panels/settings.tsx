import type { Settings, StorageInfo } from "@ultrapaint/contracts/settings";
import {
  CONFIG_FILE_NAME,
  defaultSettings,
  LEGACY_CONFIG_FILE_NAME,
} from "@ultrapaint/contracts/settings";
import {
  applySuggestions,
  describeSuggestions,
  type SetupSuggestions,
} from "@ultrapaint/contracts/setup";
import type { CustomiseMode, Skill } from "@ultrapaint/contracts/skills";
import {
  type AgentConfig,
  type AgentOptions,
  type ChatDefaults,
  isModelOption,
  type McpConnection,
  namedChoices,
} from "@ultrapaint/contracts/threads";
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
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Markdown } from "../components/markdown.tsx";
import { OptionSelect } from "../components/option-select.tsx";
import { api } from "../state/connection.ts";
import { useDesignSystem } from "../state/design-system.ts";
import { useEditor } from "../state/editor.ts";
import { reportError, useProject } from "../state/project.ts";
import { type SendKey, useSendKey } from "../state/send-key.ts";
import { useSkills } from "../state/skills.ts";
import { startInit } from "./design-system.tsx";

const themes = [
  { label: "Light", value: "light" },
  { label: "Dark", value: "dark" },
];

const sendKeys = [
  { label: "Enter", value: "enter" },
  { label: "⌘/Ctrl+Enter", value: "modEnter" },
];

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

/** A titled card of rows; the rows are separated by hairlines. */
const Group = ({
  children,
  description,
  title,
}: {
  children: React.ReactNode;
  description?: React.ReactNode;
  title: string;
}) => (
  <section className="flex flex-col gap-2">
    <div className="flex flex-col gap-0.5 px-1">
      <h3 className="font-heading-xsmall">{title}</h3>
      {description ? (
        <p className="font-body text-muted-foreground">{description}</p>
      ) : null}
    </div>
    <div className="divide-y rounded-lg border bg-card">{children}</div>
  </section>
);

/**
 * One setting: what it is on the left, its control on the right. Below the container's width the
 * control drops under the words instead of squeezing them.
 */
const Row = ({
  children,
  description,
  htmlFor,
  title,
  wide,
}: {
  children: React.ReactNode;
  description?: React.ReactNode;
  htmlFor?: string;
  title: string;
  /** Room for a list or a command rather than a single value. */
  wide?: boolean;
}) => (
  <div className="flex @2xl:flex-row flex-col @2xl:items-start @2xl:justify-between @2xl:gap-8 gap-3 px-4 py-3.5">
    <div className="flex min-w-0 flex-1 flex-col gap-1 @2xl:pt-1">
      <Label className="font-body" htmlFor={htmlFor}>
        {title}
      </Label>
      {description ? (
        <p className="font-body text-muted-foreground">{description}</p>
      ) : null}
    </div>
    <div
      className={cn(
        "flex shrink-0 flex-col gap-1",
        wide ? "@2xl:w-96" : "@2xl:w-72"
      )}
    >
      {children}
    </div>
  </div>
);

/** Where `/init` is started from the settings, and where its result is said to be. */
const DesignSystemGroup = () => {
  const { designSystem, detecting, loaded } = useDesignSystem();
  useEffect(() => {
    if (!loaded) {
      useDesignSystem.getState().load();
    }
  }, [loaded]);
  const open = () => {
    useProject.getState().openSettings(false);
    useEditor.getState().setLeftTab("designSystem");
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
            ? `Imported: ${designSystem.colors.reduce((n, g) => n + g.tokens.length, 0)} colours, ${designSystem.typography.styles.length} text styles. Kept in design-system.json and DESIGN.md in the designs directory.`
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

/**
 * How to point something else at this project: an agent in a terminal, another editor. The same
 * tools the threads here use, over the same server, reached with the project's own token.
 */
const McpConnectionGroup = () => {
  const [connection, setConnection] = useState<McpConnection | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    api()
      .request("mcp.connection", undefined)
      .then(setConnection)
      .catch(reportError);
  }, []);
  if (!connection?.enabled) {
    return null;
  }
  const command = `claude mcp add --transport http ultrapaint ${connection.url} --header "${connection.header}: ${connection.token}"`;
  const copy = () => {
    navigator.clipboard
      .writeText(command)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(reportError);
  };
  return (
    <Group title="Outside the editor">
      <Row
        description="Gives another agent the same tools the chats here use: the project's pages, its components, and the comments left on the designs. The token is this project's, and anyone who has it can use them."
        title="Connect an agent over MCP"
        wide
      >
        <div className="flex items-start gap-2">
          <code className="min-w-0 flex-1 select-text overflow-x-auto whitespace-pre rounded-md bg-muted px-2 py-1.5 font-code">
            {command}
          </code>
          <Button onClick={copy} size="sm" variant="outline">
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      </Row>
    </Group>
  );
};

const sourceLabel = (skill: Skill) => {
  if (skill.source === "built-in") {
    return "Built-in";
  }
  return skill.extends
    ? `Extends the built-in, in ${skill.file}`
    : `Replaced by ${skill.file}`;
};

/** One skill: on or off, what it says, and how the project takes it over. */
const SkillRow = ({
  enabled,
  onToggle,
  skill,
}: {
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  skill: Skill;
}) => {
  const [shown, setShown] = useState(false);
  const id = `settings-skill-${skill.name}`;
  const customise = (mode: CustomiseMode) => {
    useSkills
      .getState()
      .customise(skill.name, mode)
      .then((result) => {
        if (result?.file) {
          toast(`${result.file} is yours to edit.`, {
            description:
              mode === "extend"
                ? `What you write there is told after the built-in ${skill.title} skill.`
                : `It replaces the built-in ${skill.title} skill.`,
          });
        }
      });
  };
  return (
    <Row
      description={
        <>
          {skill.summary}
          <span className="mt-1 block font-body">{sourceLabel(skill)}</span>
          {shown ? (
            <span className="mt-2 block rounded-md bg-muted/40 p-3 text-foreground">
              <Markdown>{skill.text}</Markdown>
            </span>
          ) : null}
        </>
      }
      htmlFor={id}
      title={skill.title}
      wide
    >
      <div className="flex flex-wrap items-center justify-end gap-1">
        <Button onClick={() => setShown((v) => !v)} size="sm" variant="ghost">
          {shown ? "Hide" : "Show"}
        </Button>
        {skill.source === "built-in" ? (
          <>
            <Button
              onClick={() => customise("extend")}
              size="sm"
              variant="outline"
            >
              Extend…
            </Button>
            <Button
              onClick={() => customise("replace")}
              size="sm"
              variant="outline"
            >
              Replace…
            </Button>
          </>
        ) : null}
        <Switch
          checked={enabled}
          className="ml-2"
          id={id}
          onCheckedChange={onToggle}
        />
      </div>
    </Row>
  );
};

/**
 * The design skills every agent is told before it designs. The set is the tool's; a project
 * replaces or extends one with a file, adds its own, and turns any off here.
 */
const SkillsGroup = ({
  disabled,
  onToggle,
}: {
  disabled: readonly string[];
  onToggle: (name: string, enabled: boolean) => void;
}) => {
  const { dir, loaded, skills } = useSkills();
  useEffect(() => {
    if (!loaded) {
      useSkills.getState().load();
    }
  }, [loaded]);
  if (skills.length === 0) {
    return null;
  }
  const off = new Set(disabled);
  return (
    <Group
      description={`Told to every agent before it designs, ahead of DESIGN.md. A file in ${dir} with a built-in's name replaces it, or extends it when the file opens with the front matter "extends: true"; a file with any other name is a skill of its own. A switch turned off is saved with the settings.`}
      title="Design skills"
    >
      {skills.map((skill) => (
        <SkillRow
          enabled={!off.has(skill.name)}
          key={skill.name}
          onToggle={(enabled) => onToggle(skill.name, enabled)}
          skill={skill}
        />
      ))}
    </Group>
  );
};

/** Stands for "no choice": the first agent, or the agent's own model. */

/**
 * The agent and model a new thread starts with. Saved as soon as it is picked: it is the
 * user's, not the project's, and a thread can still switch both in its composer.
 */
/** Kept in this browser rather than the settings file, so it applies at once and to every project. */
const SendKeyGroup = () => {
  const sendKey = useSendKey((s) => s.sendKey);
  const setSendKey = useSendKey((s) => s.setSendKey);
  return (
    <Group title="Chat">
      <Row
        description={
          sendKey === "enter"
            ? "Enter sends the message; Shift+Enter starts a new line."
            : "Enter starts a new line; ⌘/Ctrl+Enter sends the message."
        }
        title="Send with"
      >
        <OptionSelect
          onChange={(v) => setSendKey(v as SendKey)}
          options={sendKeys}
          value={sendKey}
        />
      </Row>
    </Group>
  );
};

const ChatDefaultsGroup = () => {
  const [agents, setAgents] = useState<readonly AgentConfig[]>([]);
  const [known, setKnown] = useState<readonly AgentOptions[]>([]);
  const [defaults, setDefaults] = useState<ChatDefaults | null>(null);
  /** Why the chosen agent could not list its models, once it has been asked. */
  const [unlisted, setUnlisted] = useState<Record<string, string>>({});
  useEffect(() => {
    Promise.all([
      api().request("agents.list", undefined),
      api().request("agents.options", undefined),
      api().request("chat.defaults", undefined),
    ])
      .then(([configs, options, stored]) => {
        setAgents(configs);
        setKnown(options);
        setDefaults(stored);
      })
      .catch(reportError);
  }, []);
  const agentId =
    agents.find((a) => a.id === defaults?.agentId)?.id ?? agents[0]?.id ?? "";
  const asked = !defaults || known.some((k) => k.agentId === agentId);
  // An agent never run here is asked now; the server shares the answer with its own asking.
  useEffect(() => {
    if (asked || !agentId) {
      return;
    }
    let live = true;
    api()
      .request("agents.discover", { agentId })
      .then((options) => {
        if (live) {
          setKnown((k) => [...k.filter((x) => x.agentId !== agentId), options]);
        }
      })
      .catch((error: { message?: string }) => {
        if (live) {
          setUnlisted((u) => ({
            ...u,
            [agentId]: error.message ?? String(error),
          }));
        }
      });
    return () => {
      live = false;
    };
  }, [agentId, asked]);
  if (!defaults || agents.length === 0) {
    return null;
  }
  const listed = known.find((k) => k.agentId === agentId);
  const modelOption = listed?.configOptions.find(isModelOption);
  const models = modelOption ? namedChoices(modelOption) : [];
  const save = (next: ChatDefaults) => {
    setDefaults(next);
    api().request("chat.setDefaults", next).catch(reportError);
  };
  const onAgent = (id: string) => save({ agentId: id });
  const problem = unlisted[agentId];
  let modelDescription =
    "The model the agent answers with, unless the chat picks another.";
  if (problem !== undefined) {
    modelDescription = problem;
  } else if (!listed) {
    modelDescription = "Asking the agent which models it offers…";
  } else if (models.length === 0) {
    modelDescription = "This agent offers no choice of model.";
  }
  const onModel = (model: string) => save({ agentId, model });
  return (
    <Group
      description="Applied as soon as they are picked. A chat switches agent or model in its composer."
      title="New chats"
    >
      <Row description="The agent a new chat starts with." title="Agent">
        <OptionSelect
          onChange={onAgent}
          options={agents.map((a) => ({ label: a.name, value: a.id }))}
          value={agentId}
        />
      </Row>
      <Row description={modelDescription} title="Model">
        <OptionSelect
          disabled={models.length === 0}
          onChange={onModel}
          options={models.map((m) => ({
            description: m.description,
            label: m.name,
            value: m.value,
          }))}
          // Unset, a thread starts with the first model the agent names.
          value={defaults.model ?? models[0]?.value ?? null}
        />
      </Row>
    </Group>
  );
};

/** Why the last save was refused, with the way out when the designs directory is missing. */
const SaveProblems = ({
  busy,
  designsDir,
  onCreateDesigns,
  problems,
  resolveFrom,
}: {
  busy: boolean;
  designsDir: string;
  onCreateDesigns: () => void;
  problems: readonly string[];
  resolveFrom: string | undefined;
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
              Creates the directory with a tsconfig.json
              {resolveFrom
                ? `, and links the dependencies of ${resolveFrom} (git-ignored) so editors resolve what the pages import`
                : ""}
              . Nothing is installed.
            </span>
          </div>
        ) : null}
      </AlertDescription>
    </Alert>
  );
};

/** Only Tailwind v4 is supported: anything else is said before it is saved. */
const TailwindAlert = ({
  tailwind,
}: {
  tailwind: SetupSuggestions["tailwind"];
}) =>
  tailwind === "v4" ? null : (
    <Alert variant="destructive">
      <TriangleAlert />
      <AlertDescription>
        {tailwind === "v3"
          ? "The stylesheets set up Tailwind v3."
          : "No Tailwind setup was found in the stylesheets."}{" "}
        ultrapaint reads the design system from Tailwind v4's @theme, and only
        supports Tailwind v4.
      </AlertDescription>
    </Alert>
  );

/** The sections on the left. The first run has nothing saved, so it hides what needs a project. */
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
    <div className="flex h-12 shrink-0 items-center px-4">
      <h1 className="font-semibold">Settings</h1>
    </div>
    <nav aria-label="Settings sections" className="flex flex-col gap-0.5 p-2">
      {sections
        .filter((s) => showAll || !s.needsSaved)
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

const SettingsForm = ({ saved }: { saved: Settings | null }) => {
  const storage = useProject((s) => s.info.storage);
  const detected = useProject((s) => s.info.setup === "detected");
  const [draft, setDraft] = useState<Settings>(
    saved ?? defaultSettings(storage.defaultRepoPath ?? "")
  );
  const wanted = useProject((s) => s.settingsSection);
  // The URL may name a section that does not exist, or one the first run hides.
  const section: SectionId =
    sections.find((s) => s.id === wanted && (saved || !s.needsSaved))?.id ??
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
      const v = await api().request("settings.set", draft);
      setProblems(v.problems);
      ({ ok } = v);
      if (ok) {
        useProject.getState().openSettings(false);
        await useProject.getState().load();
      }
    } catch (error) {
      setProblems([(error as Error).message]);
    }
    setBusy(false);
    return ok;
  };
  // The design system is offered at the first edit, by the setup dialog.
  const save = async () => {
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
    api()
      .request("setup.detect", { repoPath: draft.repoPath })
      .then((suggestions) => {
        setFound(suggestions);
        setDraft((d) => applySuggestions(d, suggestions));
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
    api()
      .request("setup.detect", { repoPath: firstRepoPath })
      .then((suggestions) => {
        setFound(suggestions);
        setDraft((d) => applySuggestions(d, suggestions));
      })
      // The form works without suggestions; a repository that cannot be read says so on save.
      .catch(() => setFound(null));
  }, [firstRepoPath]);

  const createDesigns = async () => {
    setBusy(true);
    try {
      await api().request("setup.createDesigns", {
        designsDir: draft.designsDir,
        repoPath: draft.repoPath,
        resolveFrom: draft.resolveFrom,
      });
      await apply();
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
  const onComponentPackages = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const componentPackages = list(e.target.value);
    setDraft((d) => ({ ...d, componentPackages }));
  };
  const onStorybookUrl = (e: React.ChangeEvent<HTMLInputElement>) => {
    const storybookUrl = e.target.value || undefined;
    setDraft((d) => ({ ...d, storybookUrl }));
  };
  const onPagePngs = (on: boolean) =>
    setDraft((d) => ({ ...d, pagePngs: on || undefined }));
  const onTheme = (v: string) =>
    setDraft((d) => ({ ...d, theme: v as Settings["theme"] }));
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
      {found ? <TailwindAlert tailwind={found.tailwind} /> : null}
      <Group
        description="The tool runs against a local repository. Design files live inside it and are versioned with the code."
        title="Location"
      >
        <Row
          description={
            repoFromFile
              ? "Given by where the configuration file is."
              : "Absolute path to a git repository. Its root needs no package.json: the pages import from the package named below."
          }
          htmlFor="settings-repo"
          title="Repository path"
          wide
        >
          <Input
            id="settings-repo"
            onChange={onRepoPath}
            placeholder="/Users/you/code/repo"
            readOnly={repoFromFile}
            value={draft.repoPath}
          />
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
        <Row
          description="A package of the repository that already depends on React and the design system. Screens import what that package can import, so nothing has to be installed for them. Leave empty when the designs directory is a package of its own."
          htmlFor="settings-resolve"
          title="Resolve imports from"
        >
          <Input
            id="settings-resolve"
            onChange={onResolveFrom}
            placeholder="apps/web"
            value={draft.resolveFrom ?? ""}
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
      <Group title="Detection">
        <Row
          description="Reads the repository and fills in the designs directory, the stylesheets and the component packages it finds. What you typed is replaced."
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
        description="Where the design system is read from: the preview loads these, and the Assets panel is catalogued from them."
        title="Sources"
      >
        <Row
          description="One per line, resolved from the directory the preview is generated into. Include the Tailwind v4 entry of the design system and its fonts: the design system is read from them."
          htmlFor="settings-css"
          title="Host CSS imports"
          wide
        >
          <Textarea
            className="min-h-14 font-code"
            id="settings-css"
            onChange={onHostCss}
            value={draft.hostCss.join("\n")}
          />
        </Row>
        <Row
          description="Catalogued for the Assets panel. Relative to the repository, one per line."
          htmlFor="settings-libs"
          title="Source directories"
          wide
        >
          <Textarea
            className="min-h-14 font-code"
            id="settings-libs"
            onChange={onLibraryDirs}
            value={draft.libraryDirs.join("\n")}
          />
        </Row>
        <Row
          description="Package names whose exports form the Assets panel, one per line."
          htmlFor="settings-packages"
          title="Component packages"
          wide
        >
          <Textarea
            className="min-h-14 font-code"
            id="settings-packages"
            onChange={onComponentPackages}
            value={draft.componentPackages.join("\n")}
          />
        </Row>
      </Group>
      {saved ? <DesignSystemGroup /> : null}
    </>
  );

  const editor = (
    <>
      <Group title="Appearance">
        <Row
          description="The theme the editor and the preview are drawn in."
          title="Theme"
        >
          <OptionSelect
            onChange={onTheme}
            options={themes}
            value={draft.theme}
          />
        </Row>
      </Group>
      <SendKeyGroup />
      <Group title="Previews">
        <Row
          description="Optional. The Assets panel's previews use running stories."
          htmlFor="settings-storybook"
          title="Storybook URL"
        >
          <Input
            id="settings-storybook"
            onChange={onStorybookUrl}
            placeholder="http://localhost:6006"
            value={draft.storybookUrl ?? ""}
          />
        </Row>
      </Group>
    </>
  );

  const agents = (
    <>
      <ChatDefaultsGroup />
      <SkillsGroup disabled={draft.skills?.disabled ?? []} onToggle={onSkill} />
      <McpConnectionGroup />
    </>
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
        <header className="flex h-12 shrink-0 items-center gap-1.5 border-b px-6 font-body">
          <span className="text-muted-foreground">Settings</span>
          <span className="text-muted-foreground">/</span>
          <span className="font-medium">{label}</span>
        </header>
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
              resolveFrom={draft.resolveFrom}
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
                <Button disabled={busy} onClick={save}>
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
