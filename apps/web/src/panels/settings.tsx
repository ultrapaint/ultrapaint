import { getPlatform } from "@ultrapaint/client-runtime/platform";
import type { Settings, StorageInfo } from "@ultrapaint/contracts/settings";
import { defaultSettings } from "@ultrapaint/contracts/settings";
import type { SetupSuggestions } from "@ultrapaint/contracts/setup";
import {
  type AgentConfig,
  type AgentOptions,
  type ChatDefaults,
  isModelOption,
  type McpConnection,
} from "@ultrapaint/contracts/threads";
import {
  ArrowLeft,
  CircleAlert,
  FolderSearch,
  TriangleAlert,
  Wand2,
} from "lucide-react";
import type * as React from "react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { OptionSelect } from "../components/option-select.tsx";
import { applySuggestions, describeSuggestions } from "../lib/setup.ts";
import { api } from "../state/connection.ts";
import { useDesignSystem } from "../state/design-system.ts";
import { useEditor } from "../state/editor.ts";
import { reportError, useProject } from "../state/project.ts";
import { startInit } from "./design-system.tsx";

const themes = [
  { label: "light", value: "light" },
  { label: "dark", value: "dark" },
];

const LIST_SEPARATOR_RE = /[\n,]/;

const MISSING_DESIGNS_PREFIX = "Designs directory does not exist";

const list = (v: string) =>
  v
    .split(LIST_SEPARATOR_RE)
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * Settings take the whole window rather than a dialog: the first run lands here, and the form is
 * longer than a dialog can hold. The editor is not mounted behind it.
 */
/** Where `/init` is started from the settings, and where its result is said to be. */
const DesignSystemField = () => {
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
  return (
    <Field>
      <FieldLabel>Tokens and conventions</FieldLabel>
      <div className="flex flex-wrap gap-1">
        <Button
          onClick={() => {
            useProject.getState().openSettings(false);
            startInit();
          }}
          variant="outline"
        >
          <Wand2 />
          {designSystem
            ? "Update with an agent (/init)"
            : "Initialise with an agent (/init)"}
        </Button>
        <Button
          disabled={detecting}
          onClick={() => useDesignSystem.getState().detect()}
          variant="ghost"
        >
          Detect automatically
        </Button>
        {designSystem ? (
          <Button onClick={open} variant="ghost">
            Show
          </Button>
        ) : null}
      </div>
      <FieldDescription>
        {designSystem
          ? `Imported: ${designSystem.colors.reduce((n, g) => n + g.tokens.length, 0)} colours, ${designSystem.typography.styles.length} text styles. Kept in design-system.json and DESIGN.md in the designs directory.`
          : "Not imported yet. An agent reads the Tailwind v4 theme and the components, asks you about the application, and writes design-system.json and DESIGN.md."}
      </FieldDescription>
    </Field>
  );
};

export const SettingsPage = () => {
  const saved = useProject((s) => s.settings);
  // Mounted with the page, so every open starts from the saved settings.
  return <SettingsForm saved={saved} />;
};

/** Where a save goes, in the words of the storage mode the server runs in. */
const storageLine = (storage: StorageInfo) => {
  if (storage.mode === "ephemeral") {
    return "Started without a configuration file: these settings are not saved.";
  }
  return `Saved to ${storage.configPath}`;
};

/**
 * How to point something else at this project: an agent in a terminal, another editor. The same
 * tools the threads here use, over the same server, reached with the project's own token.
 */
const McpConnectionField = () => {
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
    <Field>
      <FieldLabel>Agents outside the editor</FieldLabel>
      <div className="flex items-start gap-2">
        <code className="min-w-0 flex-1 select-text overflow-x-auto whitespace-pre rounded-md bg-muted px-2 py-1.5 font-mono text-[10px] leading-relaxed">
          {command}
        </code>
        <Button onClick={copy} size="sm" variant="outline">
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <FieldDescription>
        Gives another agent the same tools the threads here use: the project's
        pages, its components, and the comments left on the designs. The token
        is this project's, and anyone who has it can use them.
      </FieldDescription>
    </Field>
  );
};

/** Stands for "no choice": the first agent, or the agent's own model. */
const AGENT_DEFAULT = "";

/**
 * The agent and model a new thread starts with. Saved as soon as it is picked: it is the
 * user's, not the project's, and a thread can still switch both in its composer.
 */
const ChatDefaultsField = () => {
  const [agents, setAgents] = useState<readonly AgentConfig[]>([]);
  const [known, setKnown] = useState<readonly AgentOptions[]>([]);
  const [defaults, setDefaults] = useState<ChatDefaults | null>(null);
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
  if (!defaults || agents.length === 0) {
    return null;
  }
  const agentId =
    agents.find((a) => a.id === defaults.agentId)?.id ?? agents[0]?.id ?? "";
  const models =
    known.find((k) => k.agentId === agentId)?.configOptions.find(isModelOption)
      ?.options ?? [];
  const save = (next: ChatDefaults) => {
    setDefaults(next);
    api().request("chat.setDefaults", next).catch(reportError);
  };
  const onAgent = (id: string) => save({ agentId: id });
  const onModel = (model: string) =>
    save({ agentId, ...(model === AGENT_DEFAULT ? {} : { model }) });
  return (
    <>
      <Field>
        <FieldLabel>Default agent</FieldLabel>
        <OptionSelect
          className="max-w-64"
          onChange={onAgent}
          options={agents.map((a) => ({ label: a.name, value: a.id }))}
          value={agentId}
        />
      </Field>
      <Field>
        <FieldLabel>Default model</FieldLabel>
        <OptionSelect
          className="max-w-64"
          disabled={models.length === 0}
          onChange={onModel}
          options={[
            { label: "The agent's own default", value: AGENT_DEFAULT },
            ...models.map((m) => ({
              description: m.description,
              label: m.name,
              value: m.value,
            })),
          ]}
          value={defaults.model ?? AGENT_DEFAULT}
        />
        <FieldDescription>
          {models.length === 0
            ? "The models are listed once this agent has answered a prompt here."
            : "New threads start with these. A thread switches agent or model in its composer."}
        </FieldDescription>
      </Field>
    </>
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
            <span className="text-muted-foreground text-xs">
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

const SettingsForm = ({ saved }: { saved: Settings | null }) => {
  const storage = useProject((s) => s.info.storage);
  const [draft, setDraft] = useState<Settings>(
    saved ?? defaultSettings(storage.defaultRepoPath ?? "")
  );
  const unsaved = storage.mode === "ephemeral";
  // A configuration file in the repository says where the repository is by where it lies.
  const repoFromFile = storage.mode === "file";
  const [problems, setProblems] = useState<readonly string[]>([]);
  const [busy, setBusy] = useState(false);
  const idleLabel = unsaved ? "Apply" : "Save and open";
  const saveLabel = busy ? "Validating…" : idleLabel;
  const platform = getPlatform();

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
  const save = async () => {
    const first = !saved;
    if ((await apply()) && first) {
      // A new project starts with its design system: offered, not imposed.
      toast("Import the design system?", {
        action: { label: "Initialise", onClick: startInit },
        description:
          "An agent reads the Tailwind v4 theme and the components, and asks you what it cannot find out.",
        duration: 20_000,
      });
    }
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
  // Escape leaves the page, as it closed the dialog, once there are settings to go back to.
  useEffect(() => {
    if (!saved) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) {
        useProject.getState().openSettings(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [saved]);
  const browse = async () => {
    const p = await platform.pickFolder?.();
    if (p) {
      setDraft((d) => ({ ...d, repoPath: p }));
    }
  };
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
  const onTheme = (v: string) =>
    setDraft((d) => ({ ...d, theme: v as Settings["theme"] }));

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
        {saved ? (
          <Button
            aria-label="Back to the editor"
            onClick={cancel}
            size="icon-sm"
            variant="ghost"
          >
            <ArrowLeft />
          </Button>
        ) : null}
        <h1 className="font-semibold">Settings</h1>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-8">
          <div className="flex flex-col gap-1">
            <h2 className="font-semibold text-lg">Target repository</h2>
            <p className="text-muted-foreground text-sm">
              The tool runs against a local repository. Design files live inside
              it and are versioned with the code.
            </p>
          </div>
          {found ? (
            <Alert>
              <FolderSearch />
              <AlertDescription>{describeSuggestions(found)}</AlertDescription>
            </Alert>
          ) : null}
          {found ? <TailwindAlert tailwind={found.tailwind} /> : null}
          <FieldSet>
            <FieldLegend>Repository</FieldLegend>
            <FieldGroup className="gap-4">
              <Field>
                <FieldLabel htmlFor="settings-repo">Repository path</FieldLabel>
                <div className="flex gap-1">
                  <Input
                    id="settings-repo"
                    onChange={onRepoPath}
                    placeholder="/Users/you/code/repo"
                    readOnly={repoFromFile}
                    value={draft.repoPath}
                  />
                  {platform.pickFolder && !repoFromFile ? (
                    <Button onClick={browse} variant="outline">
                      Browse…
                    </Button>
                  ) : null}
                </div>
                <FieldDescription>
                  {repoFromFile
                    ? "Given by where the configuration file is."
                    : "Absolute path to a git repository with a package.json."}
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="settings-designs">
                  Designs directory
                </FieldLabel>
                <Input
                  id="settings-designs"
                  onChange={onDesignsDir}
                  placeholder="products/prime/designs"
                  value={draft.designsDir}
                />
                <FieldDescription>
                  Relative to the repository. Pages are saved here as design
                  documents (.page.json), with the design system beside them.
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="settings-resolve">
                  Resolve imports from
                </FieldLabel>
                <Input
                  id="settings-resolve"
                  onChange={onResolveFrom}
                  placeholder="apps/web"
                  value={draft.resolveFrom ?? ""}
                />
                <FieldDescription>
                  A package of the repository that already depends on React and
                  the design system. Screens import what that package can
                  import, so nothing has to be installed for them. Leave empty
                  when the designs directory is a package of its own.
                </FieldDescription>
              </Field>
            </FieldGroup>
          </FieldSet>
          <FieldSeparator />
          <FieldSet>
            <FieldLegend>Design system</FieldLegend>
            <FieldGroup className="gap-4">
              <Field>
                <FieldLabel htmlFor="settings-css">Host CSS imports</FieldLabel>
                <Textarea
                  className="min-h-14 font-mono text-xs"
                  id="settings-css"
                  onChange={onHostCss}
                  value={draft.hostCss.join("\n")}
                />
                <FieldDescription>
                  One per line, resolved from the directory the preview is
                  generated into. Include the Tailwind v4 entry of the design
                  system and its fonts: the design system is read from them.
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="settings-libs">
                  Design-system source dirs
                </FieldLabel>
                <Textarea
                  className="min-h-14 font-mono text-xs"
                  id="settings-libs"
                  onChange={onLibraryDirs}
                  value={draft.libraryDirs.join("\n")}
                />
                <FieldDescription>
                  Catalogued for the palette. Relative to the repository, one
                  per line.
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="settings-packages">
                  Component packages
                </FieldLabel>
                <Textarea
                  className="min-h-14 font-mono text-xs"
                  id="settings-packages"
                  onChange={onComponentPackages}
                  value={draft.componentPackages.join("\n")}
                />
                <FieldDescription>
                  Package names whose exports form the palette, one per line.
                </FieldDescription>
              </Field>
              {saved ? <DesignSystemField /> : null}
            </FieldGroup>
          </FieldSet>
          <FieldSeparator />
          <FieldSet>
            <FieldLegend>Editor</FieldLegend>
            <FieldGroup className="gap-4">
              <Field>
                <FieldLabel htmlFor="settings-storybook">
                  Storybook URL
                </FieldLabel>
                <Input
                  id="settings-storybook"
                  onChange={onStorybookUrl}
                  placeholder="http://localhost:6006"
                  value={draft.storybookUrl ?? ""}
                />
                <FieldDescription>
                  Optional. Palette previews use running stories.
                </FieldDescription>
              </Field>
              <Field className="max-w-48">
                <FieldLabel>Theme</FieldLabel>
                <OptionSelect
                  onChange={onTheme}
                  options={themes}
                  value={draft.theme}
                />
              </Field>
            </FieldGroup>
          </FieldSet>
          {saved ? (
            <>
              <FieldSeparator />
              <FieldSet>
                <FieldLegend>Chat</FieldLegend>
                <FieldGroup className="gap-4">
                  <ChatDefaultsField />
                </FieldGroup>
              </FieldSet>
            </>
          ) : null}
          <McpConnectionField />
        </div>
      </div>
      <footer className="shrink-0 border-t">
        <div className="mx-auto flex max-w-2xl flex-col gap-3 px-6 py-4">
          <SaveProblems
            busy={busy}
            designsDir={draft.designsDir}
            onCreateDesigns={createDesigns}
            problems={problems}
            resolveFrom={draft.resolveFrom}
          />
          <p
            className={
              unsaved ? "text-warning text-xs" : "text-muted-foreground text-xs"
            }
          >
            {storageLine(storage)}
          </p>
          <div className="flex items-center justify-between gap-2">
            <Button onClick={detectNow} variant="ghost">
              Detect from repository
            </Button>
            <div className="flex gap-1">
              {saved ? (
                <Button onClick={cancel} variant="outline">
                  Cancel
                </Button>
              ) : null}
              {unsaved ? (
                <Button disabled={busy} onClick={saveToFile} variant="outline">
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
  );
};
