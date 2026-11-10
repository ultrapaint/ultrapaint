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
  TriangleAlert,
  Wand2,
  X,
} from "lucide-react";
import type * as React from "react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/cn";
import { IconButton } from "../components/icon-button.tsx";
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
  onChange,
  placeholder,
  value,
}: {
  id: string;
  /** Its ties to the reasons a refused save gave under its row. */
  invalid?: React.AriaAttributes;
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
  return loaded ? <SettingsForm saved={saved} /> : null;
};

/** The configuration file as the footer names it: from the repository when it lies inside it. */
const shortPath = (configPath: string, repoPath: string) => {
  const root = `${repoPath.replace(TRAILING_SLASH_RE, "")}/`;
  return repoPath && configPath.startsWith(root)
    ? configPath.slice(root.length)
    : configPath;
};

/**
 * Where a save goes, in the words of the storage mode the server runs in: the file a save writes
 * to (in mono, from the repository when it lies inside it, else in full), or why nothing is
 * written.
 */
const StorageLine = ({
  detected,
  repoPath,
  storage,
}: {
  detected: boolean;
  repoPath: string;
  storage: StorageInfo;
}) => {
  const warning = storage.mode === "ephemeral" || detected;
  let words: React.ReactNode;
  if (detected) {
    words = "Detected, not saved. Apply keeps them until the editor stops.";
  } else if (storage.mode === "ephemeral") {
    words = storage.session
      ? "No configuration file: kept until the command stops."
      : "No configuration file: these settings are not kept.";
  } else if (storage.configPath) {
    words = (
      <>
        Saves to{" "}
        <code className="font-code">
          {shortPath(storage.configPath, repoPath)}
        </code>
      </>
    );
  }
  return (
    <p className="flex min-w-0 flex-1 items-center gap-1.5 font-body-small text-muted-foreground">
      {warning ? (
        <TriangleAlert className="size-3.5 shrink-0 text-warning" />
      ) : null}
      <span className="truncate">{words}</span>
    </p>
  );
};

/** The primary button's words: Apply where nothing is kept, Save and open on the first run. */
const saveLabelOf = ({
  busy,
  saved,
  unsaved,
}: {
  busy: boolean;
  saved: boolean;
  unsaved: boolean;
}) => {
  if (busy) {
    return "Saving…";
  }
  if (unsaved) {
    return "Apply";
  }
  return saved ? "Save" : "Save and open";
};

/** Moves a configuration file still under its earlier name to the current one. */
const renameConfig = () =>
  api()
    .request("settings.renameConfig", undefined)
    .then((path) => toast.success(`Renamed to ${path}`))
    .catch(reportError);

/** The Repository rows a refused save can name; the rest of its reasons go in the footer. */
type ProblemRow = "application" | "components" | "designs" | "path";

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

/** The reasons a refused save gives for one row, under it; nothing when it gave none. */
const rowProblems = (problems: readonly string[], row: ProblemRow) => {
  const mine = problems.filter((p) => problemRow(p) === row);
  return mine.length > 0 ? mine : null;
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

/**
 * The repository's folder. Set by where the configuration file lies, it is read, not typed: all
 * of it as text, the folder's own name at the end included.
 */
const PathField = ({
  invalid,
  onChange,
  onChoose,
  readOnly,
  value,
}: {
  invalid: React.AriaAttributes;
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
      />
      {onChoose ? (
        <Button onClick={onChoose} variant="outline">
          Choose…
        </Button>
      ) : null}
    </div>
  );

/** Why a save was refused, in the footer: the reasons no row holds. */
const SaveProblems = ({ problems }: { problems: readonly string[] }) => {
  const general = problems.filter((p) => problemRow(p) === null);
  return general.length > 0 ? (
    <RowMessage kind="error">
      <p>Couldn’t save the settings.</p>
      <Reasons reasons={general} />
    </RowMessage>
  ) : null;
};

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

/**
 * The sections down the dialog's side, under its title. The first run hides what needs a
 * project. Tab reaches the section shown alone; the arrows move between them, showing each.
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
    const step = { ArrowDown: 1, ArrowUp: -1 }[e.key];
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
    <aside className="flex w-52 shrink-0 flex-col border-r">
      <h2 className="shrink-0 px-5 pt-5 pb-3 font-heading-small">Settings</h2>
      <nav
        aria-label="Settings sections"
        className="flex flex-col gap-0.5 px-3"
      >
        {listed.map(({ icon: Icon, id, label }) => {
          const active = id === section;
          return (
            <button
              aria-current={active ? "page" : undefined}
              // The section shown is raised as the groups are, as the left card's rail raises
              // its place; the focus is the ring alone.
              className={cn(
                "flex h-7 items-center gap-2 rounded-md px-2 text-left font-body-medium outline-none transition-colors duration-100 focus-visible:ring-2 focus-visible:ring-ring",
                active
                  ? "bg-card text-foreground not-focus-visible:ring-1 not-focus-visible:ring-border"
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
  onReview,
  onSkills,
  review,
  saved,
  skills,
}: {
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
      <ReviewGroup onChange={onReview} review={review} />
      <SkillsGroup config={skills} onChange={onSkills} />
      <McpConnectionGroup />
    </>
  ) : (
    <MachineAgentsGroup />
  );

const labelOf = (id: SectionId) =>
  sections.find((s) => s.id === id)?.label ?? id;

/** Names in a sentence: "A", "A and B", "A, B and C". */
const listOf = (names: readonly string[]) =>
  names.length < 2
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * The sections holding edits a save has not kept, in the sidebar's order. Settings detected or
 * never saved wait as a whole, under the Repository.
 */
export const waitingSections = ({
  detected,
  draft,
  saved,
}: {
  detected: boolean;
  draft: Settings;
  saved: Settings | null;
}): SectionId[] => {
  if (draft === saved && !detected) {
    return [];
  }
  const repository =
    detected ||
    saved === null ||
    !same(
      [
        draft.repoPath,
        draft.designsDir,
        draft.resolveFrom,
        draft.libraryDirs,
        draft.pagePngs,
        draft.git,
      ],
      [
        saved.repoPath,
        saved.designsDir,
        saved.resolveFrom,
        saved.libraryDirs,
        saved.pagePngs,
        saved.git,
      ]
    );
  const designSystem =
    saved !== null &&
    !same(
      [draft.hostCss, draft.styleSystem],
      [saved.hostCss, saved.styleSystem]
    );
  const agents =
    saved !== null &&
    !same([draft.skills, draft.review], [saved.skills, saved.review]);
  return (
    [
      ["repository", repository],
      ["designSystem", designSystem],
      ["agents", agents],
    ] as const
  )
    .filter(([, waits]) => waits)
    .map(([id]) => id);
};

/**
 * The footer of a section that applies at once: Done, with nothing said of applying (ADR 0063).
 * Edits other sections hold are not undone by it, so it names them, with the way to the first.
 */
const InstantFooter = ({
  onDone,
  onShow,
  waiting,
}: {
  onDone: () => void;
  onShow: (id: SectionId) => void;
  waiting: readonly SectionId[];
}) => {
  const [first] = waiting;
  return (
    <div className="flex items-center gap-4">
      <p className="min-w-0 flex-1 font-body-small text-muted-foreground">
        {first
          ? `Your edits in ${listOf(waiting.map(labelOf))} aren’t saved yet.`
          : null}
      </p>
      <div className="flex shrink-0 gap-2">
        {first ? (
          <Button onClick={() => onShow(first)} variant="outline">
            Show {labelOf(first)}
          </Button>
        ) : null}
        <Button onClick={onDone}>Done</Button>
      </div>
    </div>
  );
};

/** Whether a section's footer is Done alone: nothing in it waits for a save. */
const appliesAtOnce = (
  section: SectionId,
  saved: boolean,
  waiting: readonly SectionId[]
) =>
  section === "editor" ||
  (section === "agents" && saved && !waiting.includes("agents"));

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
  const saveLabel = saveLabelOf({ busy, saved: saved !== null, unsaved });

  /**
   * What a save answered: nothing refused closes the dialog; reasons about rows show the
   * Repository, whose rows they are, with each under its row.
   */
  const refuse = (refused: readonly string[]) => {
    setProblems(refused);
    if (refused.length === 0) {
      useProject.getState().openSettings(false);
    } else if (refused.some((p) => problemRow(p) !== null)) {
      setSection("repository");
    }
  };
  const apply = async (): Promise<boolean> => {
    setBusy(true);
    let ok = false;
    try {
      const refused = await save(draft);
      refuse(refused);
      ok = refused.length === 0;
    } catch (error) {
      setProblems([(error as Error).message]);
    }
    setBusy(false);
    return ok;
  };
  // A folder opened is set up in its chat (ADR 0062); the design system waits until it is made.
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
      refuse(await setUpDesigns(draft));
    } catch (error) {
      setProblems([(error as Error).message]);
    }
    setBusy(false);
  };

  const cancel = () => useProject.getState().openSettings(false);
  const onRepoPath = (e: React.ChangeEvent<HTMLInputElement>) => {
    const repoPath = e.target.value;
    setDraft((d) => ({ ...d, repoPath }));
  };
  // A shell with a native folder picker offers it beside the typed path (Platform).
  const { pickFolder } = platform();
  const chooseFolder = () =>
    pickFolder?.({
      defaultPath: draft.repoPath || undefined,
      title: "The project’s folder",
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
  const onHostCss = (hostCss: string[]) => setDraft((d) => ({ ...d, hostCss }));
  const onLibraryDirs = (libraryDirs: string[]) =>
    setDraft((d) => ({ ...d, libraryDirs }));
  const onPagePngs = (on: boolean) =>
    setDraft((d) => ({ ...d, pagePngs: on || undefined }));
  const onGit = (on: boolean) =>
    setDraft((d) => ({ ...d, git: on ? "on" : undefined }));
  const onSkills = (skills: SkillsConfig | undefined) =>
    setDraft((d) => ({ ...d, skills }));
  const onReview = (review: ReviewSettings | undefined) =>
    setDraft((d) => ({ ...d, review }));

  const errorFor = (row: ProblemRow, extra?: React.ReactNode) => {
    const reasons = rowProblems(problems, row);
    return reasons ? (
      <RowMessage id={`settings-problem-${row}`} kind="error">
        <Reasons reasons={reasons} />
        {extra}
      </RowMessage>
    ) : null;
  };
  /** A field's ties to the reasons under its row, when a save gave some. */
  const invalid = (row: ProblemRow) =>
    rowProblems(problems, row)
      ? {
          "aria-describedby": `settings-problem-${row}`,
          "aria-invalid": true,
        }
      : {};

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
              ? "The repository’s folder: the one the configuration file is in."
              : "The repository’s folder, as an absolute path. Git and a package.json are optional."
          }
          htmlFor={repoFromFile ? undefined : "settings-repo"}
          layout="field"
          message={errorFor("path")}
          title="Path"
        >
          <PathField
            invalid={invalid("path")}
            onChange={onRepoPath}
            onChoose={pickFolder ? chooseFolder : undefined}
            readOnly={repoFromFile}
            value={draft.repoPath}
          />
        </Row>
        <Row
          description="Fills in the fields below and the stylesheets from what it finds in this folder, replacing what you typed."
          title="Detect from the repository"
        >
          <Button
            disabled={!draft.repoPath}
            onClick={detectNow}
            variant="outline"
          >
            <FolderSearch />
            Detect
          </Button>
        </Row>
        <Row
          description="Where pages are saved, relative to the repository. Pages already written stay put."
          htmlFor="settings-designs"
          layout="field"
          message={errorFor(
            "designs",
            <Button
              disabled={busy}
              onClick={createDesigns}
              size="sm"
              variant="outline"
            >
              Create {draft.designsDir}
            </Button>
          )}
          title="Designs directory"
        >
          <Input
            className="font-code"
            id="settings-designs"
            onChange={onDesignsDir}
            placeholder="docs/designs"
            spellCheck={false}
            value={draft.designsDir}
            {...invalid("designs")}
          />
        </Row>
      </Group>
      <Group
        note="Hints for the agents that build a design. The canvas draws Ultrapaint’s own components either way."
        title="Your code"
      >
        <Row
          description="The package designs are built in. Leave it empty when the designs directory is that package."
          htmlFor="settings-resolve"
          layout="field"
          message={errorFor("application")}
          title="Application"
        >
          <Input
            className="font-code"
            id="settings-resolve"
            onChange={onResolveFrom}
            placeholder="apps/web"
            spellCheck={false}
            value={draft.resolveFrom ?? ""}
            {...invalid("application")}
          />
        </Row>
        <Row
          description="Your own components, one path per line."
          htmlFor="settings-libs"
          layout="field"
          message={errorFor("components")}
          title="Component directories"
        >
          <ListField
            id="settings-libs"
            invalid={invalid("components")}
            onChange={onLibraryDirs}
            placeholder="src/components"
            value={draft.libraryDirs}
          />
        </Row>
      </Group>
      <Group>
        <Row
          description="Saved beside each page file, so pull requests show screens as image diffs."
          htmlFor="settings-page-pngs"
          title="Write a PNG of every page"
        >
          <Switch
            checked={draft.pagePngs === true}
            id="settings-page-pngs"
            onCheckedChange={onPagePngs}
          />
        </Row>
        <Row
          description="Lets the Changes panel commit. Off, git is only read."
          htmlFor="settings-git"
          title="Write to git"
        >
          <Switch
            checked={writesGit(draft)}
            id="settings-git"
            onCheckedChange={onGit}
          />
        </Row>
      </Group>
    </>
  );

  const designSystem = (
    <Group>
      {saved ? <DesignSystemRows /> : null}
      <Row
        description="The Tailwind v4 entry and its fonts, one per line, relative to the designs directory’s .ultrapaint folder. Sync reads tokens from them and writes them back."
        htmlFor="settings-css"
        layout="field"
        message={<StylesNotice found={found} />}
        title="Stylesheets"
      >
        <ListField
          id="settings-css"
          onChange={onHostCss}
          placeholder="../../src/index.css"
          value={draft.hostCss}
        />
      </Row>
    </Group>
  );

  // Applied at once, in every project: the footer has Done in place of a save.
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
      onReview={onReview}
      onSkills={onSkills}
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
  // The preferences apply as they are picked, into the user's own directory: their footer has
  // nothing to save, and names the sections whose edits still wait for a save.
  const waiting = waitingSections({ detected, draft, saved });
  // Agents too, while its shared settings (review, design skills) hold no edit: its New chats
  // apply as they are picked.
  const instant = appliesAtOnce(section, saved !== null, waiting);

  // The left card's two levels: the sections and the page on its frame ({rail}), each group
  // raised on {card}.
  return (
    <div className="flex h-full min-w-0 flex-1 bg-rail">
      <Sidebar
        onSelect={setSection}
        section={section}
        showAll={saved !== null}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        {/* The page is named by its section, selected beside it: the header holds the close
            button alone, centred on the dialog's title, and the page starts level with the
            sections. */}
        <header className="flex h-14 shrink-0 items-start justify-end pt-4.5 pr-4">
          <IconButton onClick={cancel} tooltip="Close">
            <X />
          </IconButton>
        </header>
        <div className="@container min-h-0 flex-1 overflow-y-auto">
          <div className="flex max-w-3xl flex-col gap-12 px-5 pb-5">{body}</div>
        </div>
        <footer className="flex shrink-0 flex-col gap-3 border-t px-5 py-3">
          {instant ? null : <SaveProblems problems={problems} />}
          {instant ? (
            <InstantFooter
              onDone={cancel}
              onShow={setSection}
              waiting={waiting}
            />
          ) : (
            <div className="flex items-center gap-4">
              <StorageLine
                detected={detected}
                repoPath={draft.repoPath}
                storage={storage}
              />
              <div className="flex shrink-0 gap-2">
                {storage.configPath?.endsWith(`/${LEGACY_CONFIG_FILE_NAME}`) ? (
                  <Button onClick={renameConfig} variant="ghost">
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
                  {busy ? <Spinner /> : null}
                  {saveLabel}
                </Button>
              </div>
            </div>
          )}
        </footer>
      </div>
    </div>
  );
};
