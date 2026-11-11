import type { DesignDocument } from "@ultrapaint/contracts/design-system";
import type { ReviewSettings } from "@ultrapaint/contracts/review";
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
import type { SkillsConfig } from "@ultrapaint/contracts/skills";
import { tokensOfKind } from "@ultrapaint/contracts/token-table";
import { plural } from "@ultrapaint/shared/text";
import {
  Bot,
  FolderGit2,
  FolderSearch,
  type LucideIcon,
  SlidersHorizontal,
  SwatchBook,
  Wand2,
  X,
} from "lucide-react";
import type * as React from "react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/cn";
import { IconButton } from "../components/icon-button.tsx";
import { useAutosave } from "../lib/autosave.ts";
import { placeDocument } from "../lib/place-document.ts";
import { detect, save, setUpDesigns } from "../lib/settings-actions.ts";
import { startInit } from "../lib/start-thread.ts";
import { platform } from "../platform.ts";
import { api } from "../state/connection.ts";
import { useDesignSystem } from "../state/design-system.ts";
import { showLeftPanel } from "../state/panels.ts";
import { reportError, useProject } from "../state/project.ts";
import {
  ChatDefaultsGroup,
  MachineAgentsGroup,
  McpConnectionGroup,
  SendKeyRow,
  SkillsGroup,
} from "./settings-agents.tsx";
import { Group, Row, RowMessage } from "./settings-group.tsx";
import { KeepFindingsRow, ProfileRow } from "./settings-profile.tsx";
import { ReviewGroup } from "./settings-review.tsx";
import { ThemeRow } from "./settings-theme.tsx";

const LIST_SEPARATOR_RE = /[\n,]/;

const TRAILING_SLASH_RE = /\/+$/;

const MISSING_DESIGNS_PREFIX = "Designs directory does not exist";

const list = (v: string) =>
  v
    .split(LIST_SEPARATOR_RE)
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * A list of paths, one per line. The text is the field's own while it is typed in, so a new
 * line stays until something is written on it; the settings get the list.
 */
const ListField = ({
  id,
  invalid,
  onBlur,
  onChange,
  placeholder,
  value,
}: {
  id: string;
  /** Its ties to the reasons a refused save gave under its row. */
  invalid?: React.AriaAttributes;
  /** Left: what was typed is saved. */
  onBlur: () => void;
  onChange: (value: string[]) => void;
  placeholder: string;
  value: readonly string[];
}) => {
  const [text, setText] = useState(value.join("\n"));
  // Detection replaces the list: the field shows what it found.
  const [shown, setShown] = useState(value);
  if (shown !== value && list(text).join("\n") !== value.join("\n")) {
    setShown(value);
    setText(value.join("\n"));
  }
  return (
    <Textarea
      className="min-h-16 font-code"
      id={id}
      onBlur={onBlur}
      onChange={(e) => {
        setText(e.target.value);
        onChange(list(e.target.value));
      }}
      placeholder={placeholder}
      spellCheck={false}
      value={text}
      {...invalid}
    />
  );
};

/**
 * The settings, in a dialog over the editor: their sections down its side, and the section's
 * groups of rows, one setting per row, its control on the right.
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
  // The person's own, in every project: not one more part of the project.
  { icon: SlidersHorizontal, id: "editor", label: "Preferences" },
  { icon: Bot, id: "agents", label: "Agents", needsSaved: true },
];

/** DESIGN.md in a line: where it is, and what the format's linter says of it. */
const documentDescription = (document: DesignDocument | null) => {
  if (!document) {
    return "Not written yet. Agents everywhere read it at the repository’s root.";
  }
  if (document.legacy) {
    return `${document.path}, in the designs directory. At the root, agents outside the editor find it too.`;
  }
  const errors = document.findings.filter((f) => f.severity === "error").length;
  const warnings = document.findings.filter(
    (f) => f.severity === "warning"
  ).length;
  const lint =
    errors + warnings === 0
      ? "The linter finds nothing"
      : `${[errors > 0 ? plural(errors, "error") : "", warnings > 0 ? plural(warnings, "warning") : ""].filter(Boolean).join(", ")}, listed in the Design system panel`;
  return `${document.path} · ${lint}.`;
};

/** The design system the agents and the inspector know, and DESIGN.md beside it. */
const DesignSystemRows = () => {
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
    <>
      <Row
        description={
          designSystem
            ? `${plural(tokensOfKind(designSystem, "color").length, "colour")} and ${plural(designSystem.typography.styles.length, "text style")}, in design-system.json.`
            : "Not set up yet. An agent reads your theme and components, asks about the product, and writes it."
        }
        title="Design system"
      >
        <div className="flex flex-wrap @xl:justify-end gap-1">
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
            {detecting ? <Spinner /> : null}
            Detect
          </Button>
          <Button onClick={init} variant="outline">
            <Wand2 />
            {designSystem ? "Update with an agent" : "Set up with an agent"}
          </Button>
        </div>
      </Row>
      {designSystem ? (
        <Row description={documentDescription(document)} title="DESIGN.md">
          {document?.legacy || !document ? (
            <Button onClick={placeDocument} variant="outline">
              {document ? "Move to the root" : "Write DESIGN.md"}
            </Button>
          ) : null}
        </Row>
      ) : null}
    </>
  );
};

export const SettingsPage = () => {
  const saved = useProject((s) => s.settings);
  const loaded = useProject((s) => s.loaded);
  // Mounted with the page, so every open starts from the saved settings. A reload that lands
  // here waits for them, and for the repository the server proposes.
  return loaded ? <SettingsForm saved={saved} /> : <SettingsLoading />;
};

/** A line of text not read yet: the foreground at 10%. */
const Bone = ({ className }: { className: string }) => (
  <div className={cn("rounded-sm bg-foreground/10", className)} />
);

/**
 * The dialog before the settings are read: its sections, and the page's rows as skeletons, or,
 * when the read failed, why, with Try again.
 */
const SettingsLoading = () => {
  const wanted = useProject((s) => s.settingsSection);
  const loadError = useProject((s) => s.loadError);
  // Every section is listed while the settings are read, as a project with settings has them
  // all: a first run is the one that loses those needing a project once the read lands.
  const section: SectionId =
    sections.find((s) => s.id === wanted)?.id ?? "repository";
  const tryAgain = () => {
    useProject.setState({ loadError: null });
    useProject.getState().load();
  };
  return (
    <SettingsFrame
      onSelect={(id) => useProject.getState().openSettings(true, id)}
      section={section}
      showAll
    >
      {loadError ? (
        <RowMessage kind="error">
          <p>Couldn’t load the settings ({loadError}).</p>
          <Button onClick={tryAgain} size="sm" variant="outline">
            Try again
          </Button>
        </RowMessage>
      ) : (
        <div aria-busy="true" aria-label="Loading the settings" role="status">
          <Group>
            {["path", "detect", "designs"].map((row) => (
              <div
                className="flex @xl:flex-row flex-col @xl:items-center @xl:gap-6 gap-3 px-4 py-3"
                key={row}
              >
                <div className="flex flex-1 flex-col gap-1.5 py-0.5">
                  <Bone className="h-3 w-28" />
                  <Bone className="h-3 w-48" />
                </div>
                <Bone className="h-7 @xl:w-52 w-full rounded-md" />
              </div>
            ))}
          </Group>
        </div>
      )}
    </SettingsFrame>
  );
};

/**
 * The dialog around a section: the sections down its whole side on the frame ({rail}); beside
 * them the page on {sidebar}, headed by Settings / the section and the close button, the one way
 * out, over a hairline the page scrolls under. Flush with the dialog's edges, the page is square
 * and parted from the sections by a hairline. No footer, as everything saves as it changes
 * (ADR 0079).
 */
const SettingsFrame = ({
  children,
  onSelect,
  section,
  showAll,
}: {
  children: React.ReactNode;
  onSelect: (id: SectionId) => void;
  section: SectionId;
  showAll: boolean;
}) => (
  <div className="flex h-full min-w-0 flex-1 flex-col bg-rail md:flex-row">
    <Sidebar onSelect={onSelect} section={section} showAll={showAll} />
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-sidebar md:border-l">
      <header className="flex h-12 shrink-0 items-center justify-between gap-4 border-b px-5">
        <h2 className="flex min-w-0 items-center gap-2 font-body">
          <span className="text-muted-foreground max-md:text-foreground">
            Settings
          </span>
          {/* Narrow, the row of sections over the page already names the one shown. */}
          <span aria-hidden className="text-muted-foreground max-md:hidden">
            /
          </span>
          <span className="truncate max-md:sr-only">{labelOf(section)}</span>
        </h2>
        <IconButton
          onClick={() => useProject.getState().openSettings(false)}
          tooltip="Close"
        >
          <X />
        </IconButton>
      </header>
      <div className="@container min-h-0 flex-1 overflow-y-auto">
        <div className="flex max-w-3xl flex-col gap-12 p-5">{children}</div>
      </div>
    </div>
  </div>
);

/** The configuration file as its row names it: from the repository when it lies inside it. */
const shortPath = (configPath: string, repoPath: string) => {
  const root = `${repoPath.replace(TRAILING_SLASH_RE, "")}/`;
  return repoPath && configPath.startsWith(root)
    ? configPath.slice(root.length)
    : configPath;
};

/** Moves a configuration file still under its earlier name to the current one. */
const renameConfig = () =>
  api()
    .request("settings.renameConfig", undefined)
    .then((path) => toast.success(`Renamed to ${path}`))
    .catch(reportError);

/**
 * Where a change is written, in the words of the storage mode the server runs in: the file (in
 * mono, from the repository when it lies inside it, else in full), Rename while it has its
 * earlier name; or, as a notice, why nothing is written yet, with Save to file… in a session
 * with no configuration file.
 */
const ConfigFileGroup = ({
  detected,
  onSaveToFile,
  repoPath,
  storage,
}: {
  detected: boolean;
  onSaveToFile: () => void;
  repoPath: string;
  storage: StorageInfo;
}) => {
  const unsaved = storage.mode === "ephemeral";
  let notice: string | null = null;
  if (detected) {
    notice = "Detected, not saved yet.";
  } else if (unsaved) {
    notice = storage.session
      ? "No configuration file: kept until the command stops."
      : "No configuration file: these settings are not kept.";
  }
  const path = notice ? undefined : storage.configPath;
  if (!(notice || path)) {
    return null;
  }
  let action: React.ReactNode = null;
  if (unsaved) {
    action = (
      <Button onClick={onSaveToFile} variant="outline">
        Save to file…
      </Button>
    );
  } else if (path?.endsWith(`/${LEGACY_CONFIG_FILE_NAME}`)) {
    action = (
      <Button onClick={renameConfig} variant="outline">
        Rename to {CONFIG_FILE_NAME}
      </Button>
    );
  }
  return (
    <Group>
      <Row
        description={
          path ? (
            <code className="break-all font-code">
              {shortPath(path, repoPath)}
            </code>
          ) : undefined
        }
        message={
          notice ? <RowMessage kind="notice">{notice}</RowMessage> : null
        }
        title="Configuration file"
      >
        {action}
      </Row>
    </Group>
  );
};

/** The Repository rows a refused save can name. */
type ProblemRow = "application" | "components" | "designs" | "path";

/** Where a change was made: the row whose control saved it. */
type ChangedAt =
  | ProblemRow
  | "detect"
  | "git"
  | "pagePngs"
  | "review"
  | "skills"
  | "stylesheets";

/** The row a refused save's reason is about (the server's words, SettingsService.validate). */
export const problemRow = (problem: string): ProblemRow | null => {
  if (problem.startsWith("Repository path")) {
    return "path";
  }
  if (problem.startsWith(MISSING_DESIGNS_PREFIX)) {
    return "designs";
  }
  if (problem.includes("package.json")) {
    return "application";
  }
  if (problem.startsWith("Component directory")) {
    return "components";
  }
  return null;
};

/**
 * Stylesheets no style system the tool has reads, said under them before anything is saved, in
 * the style system's words: a notice, as nothing is wrong with the settings.
 */
const StylesNotice = ({ found }: { found: SetupSuggestions | null }) =>
  found && found.styleSystem === undefined ? (
    <RowMessage kind="notice">
      {found.stylesNote ??
        "Ultrapaint can’t read these stylesheets’ style system."}
    </RowMessage>
  ) : null;

/** A path field's own: saved when it is left, Enter included (ADR 0079). */
interface Leaves {
  onBlur: () => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}

/**
 * The repository's folder. Set by where the configuration file lies, it is read, not typed: all
 * of it as text, the folder's own name at the end included.
 */
const PathField = ({
  invalid,
  leaves,
  onChange,
  onChoose,
  readOnly,
  value,
}: {
  invalid: React.AriaAttributes;
  leaves: Leaves;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  /** The shell's folder picker, where it has one (Platform). */
  onChoose: (() => void) | undefined;
  readOnly: boolean;
  value: string;
}) =>
  readOnly ? (
    <p className="break-all py-1 font-code">{value}</p>
  ) : (
    <div className="flex gap-1">
      <Input
        className="font-code"
        id="settings-repo"
        onChange={onChange}
        placeholder="/Users/you/code/shop"
        spellCheck={false}
        value={value}
        {...invalid}
        {...leaves}
      />
      {onChoose ? (
        <Button onClick={onChoose} variant="outline">
          Choose…
        </Button>
      ) : null}
    </div>
  );

/** Reasons, one per line. */
const Reasons = ({ reasons }: { reasons: readonly string[] }) => (
  <>
    {reasons.map((r) => (
      <p key={r}>{r}</p>
    ))}
  </>
);

/**
 * Whether a section is there before anything is saved: not one that needs a project, except the
 * agents where the shell has agents of its own to set up (the desktop app).
 */
const shown = (id: SectionId) =>
  !sections.find((s) => s.id === id)?.needsSaved ||
  (id === "agents" && platform().agents !== undefined);

const SIDEBAR_STEPS: Record<string, number> = {
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowRight: 1,
  ArrowUp: -1,
};

/**
 * The sections, down the dialog's side, or in a row over the page where the dialog is narrow. The
 * first run hides what needs a project. Tab reaches the section shown alone; the arrows move
 * between them, showing each.
 */
const Sidebar = ({
  onSelect,
  section,
  showAll,
}: {
  onSelect: (id: SectionId) => void;
  section: SectionId;
  showAll: boolean;
}) => {
  const listed = sections.filter((s) => showAll || shown(s.id));
  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    const step = SIDEBAR_STEPS[e.key];
    if (step === undefined) {
      return;
    }
    e.preventDefault();
    const at = listed.findIndex((s) => s.id === section);
    const next = listed[(at + step + listed.length) % listed.length];
    if (next) {
      onSelect(next.id);
      e.currentTarget.parentElement
        ?.querySelector<HTMLElement>(`[data-section=${next.id}]`)
        ?.focus();
    }
  };
  return (
    <aside className="shrink-0 md:w-52">
      <nav
        aria-label="Settings sections"
        className="flex gap-0.5 overflow-x-auto p-3 md:flex-col md:pt-2.5"
      >
        {listed.map(({ icon: Icon, id, label }) => {
          const active = id === section;
          return (
            <button
              aria-current={active ? "page" : undefined}
              // The section shown is raised as the groups are, as the left card's rail raises
              // its place; the focus is the ring alone, 2px off the row.
              className={cn(
                "flex h-7 shrink-0 items-center gap-2 rounded-md px-2 text-left font-body-medium outline-none transition-colors duration-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-rail",
                active
                  ? "bg-sidebar text-foreground not-focus-visible:ring-1 not-focus-visible:ring-border"
                  : "text-muted-foreground hover:bg-foreground/6 hover:text-foreground"
              )}
              data-section={id}
              key={id}
              onClick={() => onSelect(id)}
              onKeyDown={onKeyDown}
              tabIndex={active ? 0 : -1}
              type="button"
            >
              <Icon className="size-4 shrink-0" />
              {label}
            </button>
          );
        })}
      </nav>
    </aside>
  );
};

/** The agents: before anything is saved, only those on this computer, which need no project. */
const AgentsSection = ({
  messageAt,
  onReview,
  onSkills,
  review,
  saved,
  skills,
}: {
  messageAt: (at: ChangedAt) => React.ReactNode;
  onReview: (review: ReviewSettings | undefined) => void;
  onSkills: (skills: SkillsConfig | undefined) => void;
  review: ReviewSettings | undefined;
  saved: boolean;
  skills: SkillsConfig | undefined;
}) =>
  saved ? (
    <>
      <MachineAgentsGroup />
      <ChatDefaultsGroup />
      <ReviewGroup
        message={messageAt("review")}
        onChange={onReview}
        review={review}
      />
      <SkillsGroup
        config={skills}
        message={messageAt("skills")}
        onChange={onSkills}
      />
      <McpConnectionGroup />
    </>
  ) : (
    <MachineAgentsGroup />
  );

const labelOf = (id: SectionId) =>
  sections.find((s) => s.id === id)?.label ?? id;

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * The settings, saved as they change (ADR 0079): a switch, a choice or a select at once, a path
 * when its field is left, and what waits when the dialog closes. Nothing says a change was saved;
 * one that wasn't says why under the row it was made in, and under the rows the reasons name.
 */
const SettingsForm = ({ saved }: { saved: Settings | null }) => {
  const storage = useProject((s) => s.info.storage);
  const detected = useProject((s) => s.info.setup === "detected");
  const [opened] = useState<Settings>(
    () => saved ?? defaultSettings(storage.defaultRepoPath ?? "")
  );
  const [draft, setDraft] = useState(opened);
  /** The draft as the last change left it, for handlers that run before React draws it. */
  const latest = useRef(opened);
  /** The fields the person changed since the dialog opened: detection on its own leaves them. */
  const touched = useRef(new Set<keyof Settings>());
  /** The settings last sent, so a field left unchanged sends nothing. */
  const sent = useRef<Settings | null>(saved);
  const wanted = useProject((s) => s.settingsSection);
  // The URL may name a section that does not exist, or one the first run hides.
  const section: SectionId =
    sections.find((s) => s.id === wanted && (saved || shown(s.id)))?.id ??
    "repository";
  const setSection = (id: SectionId) =>
    useProject.getState().openSettings(true, id);
  // A configuration file in the repository says where the repository is by where it lies.
  const repoFromFile = storage.mode === "file";
  /** Why the last change wasn't saved, and where it was made. */
  const [refusal, setRefusal] = useState<{
    at: ChangedAt;
    problems: readonly string[];
  } | null>(null);
  const problems = refusal?.problems ?? [];

  const saver = useAutosave(
    async ({ at, settings }: { at: ChangedAt; settings: Settings }) => {
      if (same(settings, sent.current)) {
        return;
      }
      sent.current = settings;
      let refused: readonly string[];
      try {
        refused = await save(settings);
      } catch (error) {
        refused = [(error as Error).message];
      }
      setRefusal(refused.length > 0 ? { at, problems: refused } : null);
      if (refused.length > 0) {
        sent.current = null;
        // Saved as the dialog closed: no row is left to say why, so a toast does.
        if (!useProject.getState().settingsOpen) {
          toast.error("Couldn’t save the settings", {
            description: refused.join("\n"),
          });
        }
      }
    }
  );
  // Closing, by the close button or Escape, saves what still waits.
  const open = useProject((s) => s.settingsOpen);
  useEffect(() => {
    if (!open) {
      saver.flush();
    }
  }, [open, saver]);
  /** A change made in the row `at`: saved `now` (a switch, a choice) or when its field is left. */
  const change = (
    patch: Partial<Settings>,
    at: ChangedAt,
    when: "later" | "now"
  ) => {
    const next = { ...latest.current, ...patch };
    latest.current = next;
    for (const key of Object.keys(patch)) {
      touched.current.add(key as keyof Settings);
    }
    setDraft(next);
    saver[when]({ at, settings: next });
  };
  /** Puts settings the person didn't type in the form (detection, its undo), saved at once. */
  const replace = (next: Settings) => {
    latest.current = next;
    setDraft(next);
    saver.now({ at: "detect", settings: next });
  };
  const leaves: Leaves = {
    onBlur: saver.flush,
    onKeyDown: (e) => {
      if (e.key === "Enter") {
        saver.flush();
      }
    },
  };

  // ---- what the repository looks like ----
  const [found, setFound] = useState<SetupSuggestions | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [detectProblem, setDetectProblem] = useState<string | null>(null);
  /** Detect: the fields filled from the repository and saved, with Undo in its toast. */
  const detectNow = async () => {
    const before = latest.current;
    if (!before.repoPath) {
      return;
    }
    setDetecting(true);
    setDetectProblem(null);
    try {
      const detection = await detect(before.repoPath);
      setFound(detection.found);
      replace(detection.onto(latest.current));
      toast("Detected from the repository", {
        action: { label: "Undo", onClick: () => replace(before) },
      });
    } catch (error) {
      setDetectProblem(
        `Couldn’t detect the repository: ${(error as Error).message}`
      );
    }
    setDetecting(false);
  };
  // Nothing is configured yet and the server knows a repository: propose a setup for it, into
  // the fields the person hasn't changed meanwhile. A proposal is saved with the first change.
  const firstRepoPath = saved ? "" : (storage.defaultRepoPath ?? "");
  useEffect(() => {
    if (!firstRepoPath) {
      return;
    }
    detect(firstRepoPath)
      .then((detection) => {
        setFound(detection.found);
        const now = latest.current;
        const kept = Object.fromEntries(
          [...touched.current].map((key) => [key, now[key]])
        );
        const next = { ...detection.onto(now), ...kept };
        latest.current = next;
        setDraft(next);
      })
      // The form works without suggestions; a repository that cannot be read says so on save.
      .catch(() => setFound(null));
  }, [firstRepoPath]);

  const [creating, setCreating] = useState(false);
  const createDesigns = async () => {
    setCreating(true);
    try {
      const refused = await setUpDesigns(latest.current);
      sent.current = refused.length > 0 ? null : latest.current;
      setRefusal(
        refused.length > 0 ? { at: "designs", problems: refused } : null
      );
    } catch (error) {
      setRefusal({ at: "designs", problems: [(error as Error).message] });
    }
    setCreating(false);
  };

  // A shell with a native folder picker offers it beside the typed path (Platform).
  const { pickFolder } = platform();
  const [pickProblem, setPickProblem] = useState<string | null>(null);
  const chooseFolder = () => {
    setPickProblem(null);
    pickFolder?.({
      defaultPath: latest.current.repoPath || undefined,
      title: "The project’s folder",
    })
      .then((repoPath) => {
        if (repoPath) {
          change({ repoPath }, "path", "now");
        }
      })
      .catch((error: Error) =>
        setPickProblem(`Couldn’t open the folder picker: ${error.message}`)
      );
  };
  const saveToFile = () => {
    saver.flush();
    useProject.getState().openSettings(false);
    useProject.getState().openSaveConfig(true);
  };

  /**
   * What a row says of a refused save: the reasons about it, and, in the row the change was made
   * in, that it wasn't saved, with the reasons no row on this page shows.
   */
  const messageAt = (at: ChangedAt, extra?: React.ReactNode) => {
    const own = problems.filter((p) => problemRow(p) === at);
    const here = refusal?.at === at;
    const others = here
      ? problems.filter((p) => {
          const row = problemRow(p);
          return row !== at && (row === null || section !== "repository");
        })
      : [];
    if (own.length === 0 && others.length === 0 && !here) {
      return null;
    }
    return (
      <RowMessage id={`settings-problem-${at}`} kind="error">
        {own.length === 0 ? <p>Couldn’t save this change.</p> : null}
        <Reasons reasons={[...own, ...others]} />
        {own.length > 0 ? extra : null}
      </RowMessage>
    );
  };
  /** A field's ties to the reasons under its row, when a save gave some. */
  const invalid = (row: ProblemRow) =>
    problems.some((p) => problemRow(p) === row)
      ? {
          "aria-describedby": `settings-problem-${row}`,
          "aria-invalid": true,
        }
      : {};
  const problemLine = (problem: string | null) =>
    problem ? <RowMessage kind="error">{problem}</RowMessage> : null;

  const repository = (
    <>
      {found ? (
        <Alert>
          <FolderSearch />
          <AlertDescription>{describeSuggestions(found)}</AlertDescription>
        </Alert>
      ) : null}
      <Group>
        <Row
          description={
            repoFromFile
              ? "The folder the configuration file is in."
              : "Git and a package.json are optional."
          }
          htmlFor={repoFromFile ? undefined : "settings-repo"}
          layout="field"
          message={
            <>
              {problemLine(pickProblem)}
              {messageAt("path")}
            </>
          }
          title="Path"
        >
          <PathField
            invalid={invalid("path")}
            leaves={leaves}
            onChange={(e) =>
              change({ repoPath: e.target.value }, "path", "later")
            }
            onChoose={pickFolder ? chooseFolder : undefined}
            readOnly={repoFromFile}
            value={draft.repoPath}
          />
        </Row>
        <Row
          description="Fills in the fields below and the stylesheets from what it finds in this folder, replacing what you typed."
          message={problemLine(detectProblem) ?? messageAt("detect")}
          title="Detect from the repository"
        >
          <Button
            disabled={!draft.repoPath || detecting}
            onClick={detectNow}
            variant="outline"
          >
            {detecting ? <Spinner /> : <FolderSearch />}
            Detect
          </Button>
        </Row>
        <Row
          description="Relative to the repository. Designs stay put."
          htmlFor="settings-designs"
          layout="field"
          message={messageAt(
            "designs",
            <Button
              disabled={creating}
              onClick={createDesigns}
              size="sm"
              variant="outline"
            >
              {creating ? <Spinner /> : null}
              Create {draft.designsDir}
            </Button>
          )}
          title="Designs directory"
        >
          <Input
            className="font-code"
            id="settings-designs"
            onChange={(e) =>
              change({ designsDir: e.target.value }, "designs", "later")
            }
            placeholder="docs/designs"
            spellCheck={false}
            value={draft.designsDir}
            {...invalid("designs")}
            {...leaves}
          />
        </Row>
      </Group>
      <Group
        note="Hints for the agents that build a design. The canvas draws Ultrapaint’s own components either way. Paths are relative to the repository."
        title="Your code"
      >
        <Row
          description="The application designs are built in."
          htmlFor="settings-resolve"
          layout="field"
          message={messageAt("application")}
          title="Application"
        >
          <Input
            className="font-code"
            id="settings-resolve"
            onChange={(e) =>
              change(
                { resolveFrom: e.target.value.trim() || undefined },
                "application",
                "later"
              )
            }
            placeholder="apps/web"
            spellCheck={false}
            value={draft.resolveFrom ?? ""}
            {...invalid("application")}
            {...leaves}
          />
        </Row>
        <Row
          htmlFor="settings-libs"
          layout="field"
          message={messageAt("components")}
          title="Component directories"
        >
          <ListField
            id="settings-libs"
            invalid={invalid("components")}
            onBlur={saver.flush}
            onChange={(libraryDirs) =>
              change({ libraryDirs }, "components", "later")
            }
            placeholder={"src/components\npackages/ui/src"}
            value={draft.libraryDirs}
          />
        </Row>
      </Group>
      <Group>
        <Row
          description="Saved beside each design file, so pull requests show them as image diffs."
          htmlFor="settings-page-pngs"
          message={messageAt("pagePngs")}
          title="Write a PNG of every design"
        >
          <Switch
            checked={draft.pagePngs === true}
            id="settings-page-pngs"
            onCheckedChange={(on) =>
              change({ pagePngs: on || undefined }, "pagePngs", "now")
            }
          />
        </Row>
        <Row
          description="Lets the Changes panel commit. Off, git is only read."
          htmlFor="settings-git"
          message={messageAt("git")}
          title="Write to git"
        >
          <Switch
            checked={writesGit(draft)}
            id="settings-git"
            onCheckedChange={(on) =>
              change({ git: on ? "on" : undefined }, "git", "now")
            }
          />
        </Row>
      </Group>
      <ConfigFileGroup
        detected={detected}
        onSaveToFile={saveToFile}
        repoPath={draft.repoPath}
        storage={storage}
      />
    </>
  );

  const designSystem = (
    <Group>
      {saved ? <DesignSystemRows /> : null}
      <Row
        description="The Tailwind v4 entry and its fonts, one per line, relative to the designs directory’s .ultrapaint folder. Sync reads tokens from them and writes them back."
        htmlFor="settings-css"
        layout="field"
        message={
          <>
            <StylesNotice found={found} />
            {messageAt("stylesheets")}
          </>
        }
        title="Stylesheets"
      >
        <ListField
          id="settings-css"
          onBlur={saver.flush}
          onChange={(hostCss) => change({ hostCss }, "stylesheets", "later")}
          placeholder="../../src/index.css"
          value={draft.hostCss}
        />
      </Row>
    </Group>
  );

  // The person's own, in every project, each saved by its row.
  const editor = (
    <Group>
      <ThemeRow />
      <ProfileRow />
      <SendKeyRow />
      <KeepFindingsRow />
    </Group>
  );

  const agents = (
    <AgentsSection
      messageAt={messageAt}
      onReview={(review) => change({ review }, "review", "now")}
      onSkills={(skills) => change({ skills }, "skills", "now")}
      review={draft.review}
      saved={saved !== null}
      skills={draft.skills}
    />
  );

  const body = {
    agents,
    designSystem,
    editor,
    repository,
  }[section];

  return (
    <SettingsFrame
      onSelect={setSection}
      section={section}
      showAll={saved !== null}
    >
      {body}
    </SettingsFrame>
  );
};
