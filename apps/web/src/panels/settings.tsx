import type { DesignDocument } from "@ultrapaint/contracts/design-system";
import type { ReviewSettings } from "@ultrapaint/contracts/review";
import type { Settings, StorageInfo } from "@ultrapaint/contracts/settings";
import {
  CONFIG_FILE_NAME,
  defaultSettings,
  LEGACY_CONFIG_FILE_NAME,
} from "@ultrapaint/contracts/settings";
import {
  describeSuggestions,
  type SetupSuggestions,
} from "@ultrapaint/contracts/setup";
import type { SkillsConfig } from "@ultrapaint/contracts/skills";
import { tokensOfKind } from "@ultrapaint/contracts/token-table";
import { plural } from "@ultrapaint/shared/text";
import { FolderSearch, Search, Wand2, X } from "lucide-react";
import type * as React from "react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/cn";
import { IconButton } from "../components/icon-button.tsx";
import { OptionSelect } from "../components/option-select.tsx";
import { useAutosave } from "../lib/autosave.ts";
import { isTyping } from "../lib/keys.ts";
import { placeDocument } from "../lib/place-document.ts";
import { detect, save, setUpDesigns } from "../lib/settings-actions.ts";
import { startInit } from "../lib/start-thread.ts";
import { platform } from "../platform.ts";
import { api } from "../state/connection.ts";
import { useDesignSystem } from "../state/design-system.ts";
import { showLeftPanel } from "../state/panels.ts";
import { reportError, useProject } from "../state/project.ts";
import { AboutSection } from "./settings-about.tsx";
import {
  ChatDefaultsGroup,
  MachineAgentsGroup,
  McpConnectionGroup,
  SendKeyRow,
  SkillsGroup,
} from "./settings-agents.tsx";
import { AppearanceSection } from "./settings-appearance.tsx";
import { FoldersGroup } from "./settings-folders.tsx";
import { GeneralSection } from "./settings-general.tsx";
import { Group, PathList, Row, RowMessage, Status } from "./settings-group.tsx";
import { ReviewGroup } from "./settings-review.tsx";
import {
  labelOf,
  SECTION_GROUPS,
  SECTIONS,
  type SectionId,
  scopeLabel,
  scopeOf,
  searchSettings,
  sectionNamed,
} from "./settings-sections.ts";
import { ShortcutsSection } from "./settings-shortcuts.tsx";

const TRAILING_SLASH_RE = /\/+$/;

const MISSING_DESIGNS_PREFIX = "Designs directory does not exist";

/**
 * The settings, in a dialog over the editor: their sections down its side, grouped by whose they
 * are (yours, the project's, this computer's), with a search over every setting; the section's
 * groups of rows, one setting per row, its control on the right.
 */

/** Sections that only make sense once the project has settings to work against. */
const NEEDS_SAVED: ReadonlySet<SectionId> = new Set([
  "designSystem",
  "review",
  "skills",
]);

/** DESIGN.md in a line: where it is, and what the format's linter says of it. */
const documentStatus = (
  document: DesignDocument | null
): { line: string; status?: React.ReactNode } => {
  if (!document) {
    return {
      line: "Not written yet. Every agent reads it at the repository’s root.",
    };
  }
  if (document.legacy) {
    return {
      line: "In the designs directory. At the root, agents outside the editor find it too.",
    };
  }
  const errors = document.findings.filter((f) => f.severity === "error").length;
  const warnings = document.findings.filter(
    (f) => f.severity === "warning"
  ).length;
  if (errors + warnings === 0) {
    return {
      line: "At the repository’s root, where every agent finds it.",
      status: <Status tone="success">No problems</Status>,
    };
  }
  return {
    line: "Listed in the Design system panel.",
    status: (
      <Status tone="warning">
        {[
          errors > 0 ? plural(errors, "error") : "",
          warnings > 0 ? plural(warnings, "warning") : "",
        ]
          .filter(Boolean)
          .join(", ")}
      </Status>
    ),
  };
};

/** The design system the agents and the inspector know, and DESIGN.md beside it. */
const DesignSystemSummary = () => {
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
  const doc = documentStatus(document);
  return (
    <>
      <div
        className="flex @xl:flex-row flex-col @xl:items-center gap-3 rounded-lg bg-muted px-4 py-3"
        data-setting="design-system"
      >
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="font-body-semibold">
            {designSystem ? "Design system" : "No design system yet"}
          </span>
          <span className="text-pretty font-body-small text-muted-foreground">
            {designSystem
              ? `${plural(tokensOfKind(designSystem, "color").length, "colour")} and ${plural(designSystem.typography.styles.length, "text style")}.`
              : "Pages are drawn in the default look. An agent reads your theme and components, asks about the product, and writes one."}
          </span>
        </div>
        <div className="flex flex-wrap gap-1">
          {designSystem ? (
            <Button onClick={open} variant="ghost">
              Open
            </Button>
          ) : (
            <Button
              disabled={detecting}
              onClick={() => useDesignSystem.getState().detect()}
              variant="ghost"
            >
              {detecting ? <Spinner /> : null}
              {detecting ? "Reading the code…" : "Read from the code"}
            </Button>
          )}
          <Button onClick={init} variant="outline">
            <Wand2 />
            {designSystem ? "Update with an agent" : "Make one with an agent"}
          </Button>
        </div>
      </div>
      {designSystem ? (
        <Group>
          <Row description={doc.line} setting="design-md" title="DESIGN.md">
            {document?.legacy || !document ? (
              <Button onClick={placeDocument} variant="outline">
                {document ? "Move to the root" : "Write DESIGN.md"}
              </Button>
            ) : (
              doc.status
            )}
          </Row>
        </Group>
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

/** The section a URL or a caller asks for, if the dialog shows it; General otherwise. */
const sectionShown = (wanted: string, shown: (id: SectionId) => boolean) => {
  const id = sectionNamed(wanted);
  return id && shown(id) ? id : "general";
};

/**
 * The dialog before the settings are read: its sections, and the page's rows as skeletons, or,
 * when the read failed, why, with Try again.
 */
const SettingsLoading = () => {
  const wanted = useProject((s) => s.settingsSection);
  const loadError = useProject((s) => s.loadError);
  // Every section is listed while the settings are read, as a project with settings has them
  // all: a first run is the one that loses those needing a project once the read lands.
  const section = sectionShown(wanted, () => true);
  const tryAgain = () => {
    useProject.setState({ loadError: null });
    useProject.getState().load();
  };
  return (
    <SettingsFrame
      onSelect={(id) => useProject.getState().openSettings(true, id)}
      section={section}
      shown={() => true}
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

/** How long a setting found by the search is outlined. */
const PULSE_MS = 1400;

/** Scrolls the page to the setting found and outlines it a moment, as T3 Code does. */
const showSetting = (page: HTMLElement | null, setting: string) => {
  const target = page?.querySelector<HTMLElement>(
    `[data-setting="${setting}"]`
  );
  if (!target) {
    return;
  }
  target.scrollIntoView({ block: "center" });
  target.classList.remove("settings-found");
  // A frame later, so the outline starts again when the same setting is found twice.
  requestAnimationFrame(() => {
    target.classList.add("settings-found");
    setTimeout(() => target.classList.remove("settings-found"), PULSE_MS);
  });
  target
    .querySelector<HTMLElement>(
      "input, button[role=switch], button[role=radio][aria-checked=true], button, [role=combobox]"
    )
    ?.focus({ preventScroll: true });
};

/**
 * The dialog around a section: the sections down its whole side on the frame ({rail}), headed by
 * Settings and the search; beside them the page on {sidebar}, headed by the section's name (and,
 * for the project's, the file its settings are saved in), the section's own action and the close
 * button, the one way out, over a hairline the page scrolls under. No footer, as everything saves
 * as it changes (ADR 0079). Narrow, the sections are a select over the page.
 */
const SettingsFrame = ({
  actions,
  children,
  onSelect,
  section,
  shown,
}: {
  /** The section's own action over its whole page (Repository's Detect again). */
  actions?: React.ReactNode;
  children: React.ReactNode;
  onSelect: (id: SectionId) => void;
  section: SectionId;
  shown: (id: SectionId) => boolean;
}) => {
  const page = useRef<HTMLDivElement>(null);
  const [found, setFound] = useState<string | null>(null);
  // A setting picked in the search is shown once its section is drawn.
  useEffect(() => {
    if (!found) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      showSetting(page.current, found);
      setFound(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [found]);
  const pick = (id: SectionId, setting?: string) => {
    onSelect(id);
    if (setting) {
      setFound(setting);
    } else {
      page.current?.scrollTo({ top: 0 });
    }
  };
  const configPath = useProject((s) => s.info.storage.configPath);
  const repoPath = useProject(
    (s) => s.settings?.repoPath ?? s.info.repoPath ?? ""
  );
  const savedIn =
    scopeOf(section) === "project" && configPath
      ? shortPath(configPath, repoPath)
      : null;
  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-rail md:flex-row">
      <Sidebar onSelect={pick} section={section} shown={shown} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-sidebar md:border-l">
        <header className="flex h-12 shrink-0 items-center gap-3 border-b px-5">
          {/* Wide, Settings heads the sections and the page names its section. Narrow, the
              select of sections over the page names the one shown, and the page says Settings. */}
          <h2 className="flex min-w-0 flex-1 items-baseline gap-2.5 font-heading-xsmall">
            <span className="md:hidden">Settings</span>
            <span className="max-md:sr-only">{labelOf(section)}</span>
            {savedIn ? (
              <span className="min-w-0 truncate font-code text-muted-foreground max-md:hidden">
                {savedIn}
              </span>
            ) : null}
          </h2>
          {actions}
          <IconButton
            onClick={() => useProject.getState().openSettings(false)}
            tooltip="Close"
          >
            <X />
          </IconButton>
        </header>
        <div className="@container min-h-0 flex-1 overflow-y-auto" ref={page}>
          <div className="flex max-w-3xl flex-col gap-8 p-5">
            <NarrowSections onSelect={pick} section={section} shown={shown} />
            {children}
          </div>
        </div>
      </div>
    </div>
  );
};

/** The configuration file as its header names it: from the repository when it lies inside it. */
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
 * What the project's settings file asks of the person, at the top of Repository, only when it
 * asks something: a session the first change will save (ADR 0092), one started never to save,
 * with Save to file…, or a file still under its earlier name, with Rename. Where the settings
 * are saved is said beside each project page's title.
 */
const ConfigFileNotice = ({
  onSaveToFile,
  storage,
}: {
  onSaveToFile: () => void;
  storage: StorageInfo;
}) => {
  if (storage.mode === "ephemeral" && storage.saveOnChange) {
    return (
      <Alert role="status">
        <AlertDescription>
          Not saved yet. Your first change saves it to {CONFIG_FILE_NAME}.
        </AlertDescription>
      </Alert>
    );
  }
  if (storage.mode === "ephemeral") {
    return (
      <Alert role="status">
        <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
          <span>
            {storage.session
              ? "Ultrapaint was started with --ephemeral: these settings are kept until the command stops."
              : "Ultrapaint was started with --ephemeral: these settings aren’t kept."}
          </span>
          <Button onClick={onSaveToFile} size="sm" variant="outline">
            Save to file…
          </Button>
        </AlertDescription>
      </Alert>
    );
  }
  if (storage.configPath?.endsWith(`/${LEGACY_CONFIG_FILE_NAME}`)) {
    return (
      <Alert role="status">
        <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
          <span>
            The settings are in {LEGACY_CONFIG_FILE_NAME}, the file’s earlier
            name.
          </span>
          <Button onClick={renameConfig} size="sm" variant="outline">
            Rename to {CONFIG_FILE_NAME}
          </Button>
        </AlertDescription>
      </Alert>
    );
  }
  return null;
};

/** The Repository rows a refused save can name. */
type ProblemRow = "application" | "components" | "designs" | "path";

/** Where a change was made: the row whose control saved it. */
type ChangedAt =
  | ProblemRow
  | "detect"
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

const SEARCH_STEPS: Record<string, number> = { ArrowDown: 1, ArrowUp: -1 };

/**
 * The sections, down the dialog's side under their groups' names, and the search over every
 * setting: typed into, the sections give way to what it found, each named with its section;
 * picking one shows its section and outlines the setting. `/` reaches the search. Tab reaches the
 * section shown alone; the arrows move between them, showing each.
 */
const Sidebar = ({
  onSelect,
  section,
  shown,
}: {
  onSelect: (id: SectionId, setting?: string) => void;
  section: SectionId;
  shown: (id: SectionId) => boolean;
}) => {
  const project = useProject((s) => s.info.name);
  const [query, setQuery] = useState("");
  const search = useRef<HTMLInputElement>(null);
  const results = searchSettings(query, shown);
  const listed = SECTIONS.filter((s) => shown(s.id));
  // `/` reaches the search wherever the dialog is, unless something is being typed.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && !isTyping(e)) {
        e.preventDefault();
        search.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const pickResult = (id: SectionId, setting: string) => {
    setQuery("");
    onSelect(id, setting);
  };
  const onNavKey = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    const step = SEARCH_STEPS[e.key] ?? { ArrowLeft: -1, ArrowRight: 1 }[e.key];
    if (step === undefined) {
      return;
    }
    e.preventDefault();
    const at = listed.findIndex((s) => s.id === section);
    const next = listed[(at + step + listed.length) % listed.length];
    if (next) {
      onSelect(next.id);
      e.currentTarget
        .closest("nav")
        ?.querySelector<HTMLElement>(`[data-section=${next.id}]`)
        ?.focus();
    }
  };
  const onResultKey = (e: React.KeyboardEvent<HTMLElement>) => {
    const step = SEARCH_STEPS[e.key];
    if (step === undefined) {
      return;
    }
    e.preventDefault();
    const buttons = [
      ...(e.currentTarget
        .closest("aside")
        ?.querySelectorAll<HTMLElement>("[data-result]") ?? []),
    ];
    const at = buttons.indexOf(e.currentTarget);
    if (at === -1) {
      buttons[step > 0 ? 0 : buttons.length - 1]?.focus();
    } else if (at + step < 0) {
      search.current?.focus();
    } else {
      buttons[Math.min(at + step, buttons.length - 1)]?.focus();
    }
  };
  return (
    <aside className="hidden shrink-0 flex-col md:flex md:w-56">
      {/* The dialog's title is said once, by its DialogTitle; this one is what is seen. */}
      <div
        aria-hidden
        className="flex h-12 items-center px-5 font-heading-xsmall"
      >
        Settings
      </div>
      <div className="px-3 pb-2">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Search settings"
            className="pr-7 pl-7"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && query) {
                e.stopPropagation();
                setQuery("");
              } else if (e.key === "Enter" && results[0]) {
                pickResult(results[0].section, results[0].id);
              } else {
                onResultKey(e);
              }
            }}
            placeholder="Search"
            ref={search}
            value={query}
          />
          {query ? null : (
            <Kbd className="pointer-events-none absolute top-1/2 right-1.5 -translate-y-1/2">
              /
            </Kbd>
          )}
        </div>
      </div>
      {query.trim() ? (
        <div className="flex min-h-0 flex-col overflow-y-auto px-3 pb-3">
          {results.length === 0 ? (
            <div className="flex flex-col items-start gap-2 px-2 py-2">
              <p className="font-body-small text-muted-foreground">
                No setting matches “{query.trim()}”.
              </p>
              <Button onClick={() => setQuery("")} size="sm" variant="ghost">
                Clear search
              </Button>
            </div>
          ) : (
            <ul aria-label="Settings found" className="flex flex-col gap-0.5">
              {results.map((r) => (
                <li key={r.id}>
                  <button
                    className="flex w-full flex-col items-start rounded-md px-2 py-1 text-left outline-none hover:bg-foreground/6 focus-visible:ring-2 focus-visible:ring-ring"
                    data-result
                    onClick={() => pickResult(r.section, r.id)}
                    onKeyDown={onResultKey}
                    type="button"
                  >
                    <span className="font-body-medium">{r.title}</span>
                    <span className="font-body-small text-muted-foreground">
                      {labelOf(r.section)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <nav
          aria-label="Settings sections"
          className="flex min-h-0 flex-col gap-0.5 overflow-y-auto px-3 pb-3"
        >
          {SECTION_GROUPS.map((group) => {
            const items = group.sections.filter((s) => shown(s.id));
            if (items.length === 0) {
              return null;
            }
            return (
              <div className="flex flex-col gap-0.5" key={group.scope}>
                <div className="truncate px-2 pt-3 pb-1 font-body-small text-muted-foreground">
                  {scopeLabel(group.scope, project)}
                </div>
                {items.map(({ icon: Icon, id, label }) => {
                  const active = id === section;
                  return (
                    <button
                      aria-current={active ? "page" : undefined}
                      // The section shown is raised as the groups are, as the left card's rail
                      // raises its place; the focus is the ring alone, 2px off the row.
                      className={cn(
                        "flex h-7 shrink-0 items-center gap-2 rounded-md px-2 text-left font-body-medium outline-none transition-colors duration-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-rail",
                        active
                          ? "bg-sidebar text-foreground not-focus-visible:ring-1 not-focus-visible:ring-border"
                          : "text-muted-foreground hover:bg-foreground/6 hover:text-foreground"
                      )}
                      data-section={id}
                      key={id}
                      onClick={() => onSelect(id)}
                      onKeyDown={onNavKey}
                      tabIndex={active ? 0 : -1}
                      type="button"
                    >
                      <Icon className="size-4 shrink-0" />
                      {label}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </nav>
      )}
    </aside>
  );
};

/** Narrow, the sections are one select over the page, under their groups' names. */
const NarrowSections = ({
  onSelect,
  section,
  shown,
}: {
  onSelect: (id: SectionId) => void;
  section: SectionId;
  shown: (id: SectionId) => boolean;
}) => {
  const project = useProject((s) => s.info.name);
  return (
    <div className="md:hidden">
      <OptionSelect
        aria-label="Section"
        onChange={(id) => onSelect(id as SectionId)}
        options={SECTION_GROUPS.flatMap((g) =>
          g.sections
            .filter((s) => shown(s.id))
            .map((s) => ({
              group: scopeLabel(g.scope, project),
              label: s.label,
              value: s.id,
            }))
        )}
        value={section}
      />
    </div>
  );
};

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * The settings, saved as they change (ADR 0079): a switch, a choice or a select at once, a path
 * when its field is left, and what waits when the dialog closes. Nothing says a change was saved;
 * one that wasn't says why under the row it was made in, and under the rows the reasons name.
 */
const SettingsForm = ({ saved }: { saved: Settings | null }) => {
  const storage = useProject((s) => s.info.storage);
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
  // The desktop app sets agents up before anything is saved; the project's own pages wait.
  const shown = (id: SectionId) => saved !== null || !NEEDS_SAVED.has(id);
  // The URL may name a section that does not exist, or one the first run hides.
  const section = sectionShown(wanted, shown);
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
  /** Detect again: the fields filled from the repository and saved, with Undo in its toast. */
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
      toast("Filled in from the folder", {
        action: { label: "Undo", onClick: () => replace(before) },
      });
    } catch (error) {
      setDetectProblem(`Couldn’t read the folder: ${(error as Error).message}`);
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
      <ConfigFileNotice onSaveToFile={saveToFile} storage={storage} />
      {found && !saved ? (
        <Alert>
          <FolderSearch />
          <AlertDescription>{describeSuggestions(found)}</AlertDescription>
        </Alert>
      ) : null}
      {problemLine(detectProblem) ?? messageAt("detect")}
      <Group>
        <Row
          description={repoFromFile ? "Where the settings file is." : undefined}
          htmlFor={repoFromFile ? undefined : "settings-repo"}
          layout="field"
          message={
            <>
              {problemLine(pickProblem)}
              {messageAt("path")}
            </>
          }
          setting="folder"
          title="Folder"
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
          description="Pages, canvases and their pictures, from the folder."
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
          setting="designs"
          title="Designs"
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
        <Row
          description="Saved beside each design, so pull requests show image diffs."
          htmlFor="settings-page-pngs"
          message={messageAt("pagePngs")}
          setting="page-pngs"
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
      </Group>
      <Group
        note="Hints for the agents that build a design. The canvas draws Ultrapaint’s own components either way."
        title="Your code"
      >
        <Row
          description="The app designs are built in, with its package.json. None is needed to design."
          htmlFor="settings-resolve"
          layout="field"
          message={messageAt("application")}
          setting="application"
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
          description="Folders whose components agents may use."
          htmlFor="settings-libs"
          layout="field"
          message={messageAt("components")}
          setting="components"
          title="Components"
        >
          <PathList
            addLabel="Add a folder"
            id="settings-libs"
            invalid={invalid("components")}
            onChange={(libraryDirs) =>
              change({ libraryDirs }, "components", "later")
            }
            onLeave={saver.flush}
            placeholder="src/components"
            value={draft.libraryDirs}
          />
        </Row>
      </Group>
    </>
  );

  const designSystem = (
    <>
      {saved ? <DesignSystemSummary /> : null}
      <Group>
        <Row
          description="The Tailwind entry and its fonts. Sync reads and writes their tokens."
          htmlFor="settings-css"
          layout="field"
          message={
            <>
              <StylesNotice found={found} />
              {messageAt("stylesheets")}
            </>
          }
          setting="stylesheets"
          title="Stylesheets"
        >
          <PathList
            addLabel="Add a stylesheet"
            id="settings-css"
            onChange={(hostCss) => change({ hostCss }, "stylesheets", "later")}
            onLeave={saver.flush}
            placeholder="src/index.css"
            value={draft.hostCss}
          />
        </Row>
      </Group>
    </>
  );

  const body: Record<SectionId, React.ReactNode> = {
    about: (
      <AboutSection
        folders={
          <section data-setting="folders">
            <FoldersGroup />
          </section>
        }
      />
    ),
    agents: <MachineAgentsGroup />,
    appearance: <AppearanceSection />,
    chats: (
      <>
        <ChatDefaultsGroup />
        <Group title="Composer">
          <SendKeyRow />
        </Group>
      </>
    ),
    connections: <McpConnectionGroup />,
    designSystem,
    general: <GeneralSection />,
    repository,
    review: (
      <ReviewGroup
        message={messageAt("review")}
        onChange={(review: ReviewSettings | undefined) =>
          change({ review }, "review", "now")
        }
        review={draft.review}
      />
    ),
    shortcuts: <ShortcutsSection />,
    skills: (
      <SkillsGroup
        config={draft.skills}
        message={messageAt("skills")}
        onChange={(skills: SkillsConfig | undefined) =>
          change({ skills }, "skills", "now")
        }
      />
    ),
  };

  return (
    <SettingsFrame
      actions={
        section === "repository" && draft.repoPath ? (
          <Button
            data-setting="detect"
            disabled={detecting}
            onClick={detectNow}
            variant="ghost"
          >
            {detecting ? <Spinner /> : <FolderSearch />}
            {detecting ? "Reading the folder…" : "Detect again"}
          </Button>
        ) : null
      }
      onSelect={setSection}
      section={section}
      shown={shown}
    >
      {body[section]}
    </SettingsFrame>
  );
};
