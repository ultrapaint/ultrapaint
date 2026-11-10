/**
 * Design system's panel (ADR 0045): the navigation of its board view. The Foundations the design
 * system has data for, then the Guidelines, DESIGN.md's sections, with a search over the tokens;
 * the item open is lit, a click opens another, and what DESIGN.md's linter finds is under them.
 * The Sync and `/init` are in its title, a step the sync waits on is a row over the list, and the
 * Sync's view takes its place while the set-up is shown. A project with no design system of its
 * own sees the default look's foundations, and the ways to make its own (ADR 0062). A file of the
 * design system that does not read is said over the list, in the foundations' place when it is
 * `design-system.json`; what the tokens file holds that was left out is with the linter's findings.
 */
import {
  DESIGN_SYSTEM_FILE,
  type DesignFinding,
} from "@ultrapaint/contracts/design-system";
import {
  AlertTriangle,
  ChevronDown,
  RefreshCw,
  Search,
  Wand2,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { cn } from "@/lib/cn";
import {
  foundationsOf,
  guidelinesOf,
  type SystemItem,
} from "../boards/system-boards.ts";
import { FileProblem } from "../components/file-problem.tsx";
import { IconButton } from "../components/icon-button.tsx";
import { NoFolder } from "../components/no-folder.tsx";
import { PanelEmpty } from "../components/panel.tsx";
import { pickFigmaFile } from "../lib/import-figma.ts";
import { openLookPage } from "../lib/look-page.ts";
import { makeSystemFromCode, startInit } from "../lib/start-thread.ts";
import { openBoard, useBoard } from "../state/board.ts";
import { useDesignSystem } from "../state/design-system.ts";
import { useDesignSystemSetup } from "../state/design-system-setup.ts";
import { useLookPage } from "../state/look-page.ts";
import { useProject } from "../state/project.ts";
import { syncWaiting, useSync } from "../state/sync.ts";
import { LookPanel } from "./look-panel.tsx";
import { problemParts } from "./page-problem.ts";
import { SyncView } from "./sync.tsx";

const NONE: readonly never[] = [];

const showSetup = () => useDesignSystemSetup.getState().show(true);
const hideSetup = () => useDesignSystemSetup.getState().show(false);

/** A group's name over its rows: small and muted, as the rows say what it holds. */
const Heading = ({ children }: { children: string }) => (
  <h3 className="flex h-9 items-end px-4 pb-1.5 font-body-small text-muted-foreground">
    {children}
  </h3>
);

/** One thing a file's reader says that stops nothing, beside its warning: red for an error. */
const Finding = ({
  children,
  error = false,
}: {
  children: ReactNode;
  error?: boolean;
}) => (
  <li className="flex items-start gap-2">
    <AlertTriangle
      className={cn(
        "mt-0.5 size-3.5 shrink-0",
        error ? "text-destructive" : "text-warning"
      )}
    />
    <span className="min-w-0 text-muted-foreground">{children}</span>
  </li>
);

const QUOTED = /`([^`]+)`/;

/** A note's words, with the token it names between backticks in mono. */
const noteWords = (note: string) =>
  note.split(QUOTED).map((part, i) =>
    i % 2 === 1 ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: the parts of one note, in its order.
      <code className="font-code text-foreground" key={i}>
        {part}
      </code>
    ) : (
      part
    )
  );

/**
 * Under the guidelines, what the files' readers say that stops nothing: what the tokens file
 * holds that the design system could not take (`notes`), then DESIGN.md's linter's errors and
 * warnings; its information says nothing to act on.
 */
const Findings = ({
  findings,
  notes,
}: {
  findings: readonly DesignFinding[];
  notes: readonly string[];
}) => {
  const shown = findings.filter((f) => f.severity !== "info");
  if (shown.length + notes.length === 0) {
    return null;
  }
  return (
    <ul className="mt-3 flex flex-col gap-2 px-3 font-body-small">
      {notes.map((note) => (
        <Finding key={note}>{noteWords(note)}</Finding>
      ))}
      {shown.map((f) => (
        <Finding
          error={f.severity === "error"}
          key={`${f.path ?? ""}${f.message}`}
        >
          {f.path ? (
            <span className="font-code text-foreground">{f.path} </span>
          ) : null}
          {f.message}
        </Finding>
      ))}
    </ul>
  );
};

/** The values' file (ADR 0035), beside `design-system.json` in the designs directory. */
const DESIGN_TOKENS_FILE = "design.tokens.json";

const NAMED = /^design(?:-system|\.tokens)\.json is (?:not valid: )?/;
const MEANWHILE =
  /: the values are design-system\.json's and the code's until it reads$/;

/**
 * The server's reason alone: without the file's name and what the values are meanwhile, which
 * the message says in its own lines, and without the JSON parser's name.
 */
const reasonOf = (problem: string) =>
  problem
    .replace(NAMED, "")
    .replace(MEANWHILE, "")
    .replace("SyntaxError: ", "");

/**
 * One of the design system's two files does not read (ADR 0035), said over the list: with
 * `design-system.json` nothing of it is listed and designs are drawn in the default look; with
 * the tokens file (`tokens`) the foundations are listed with the values the other file and the
 * code have. The server reads the file again when it is saved, so nothing here asks it to.
 */
const FilesProblem = ({
  problem,
  tokens,
}: {
  problem: string;
  tokens: boolean;
}) => {
  const designsDir = useProject((s) => s.settings?.designsDir);
  const name = tokens ? DESIGN_TOKENS_FILE : DESIGN_SYSTEM_FILE;
  const file = designsDir ? `${designsDir}/${name}` : name;
  return (
    <FileProblem
      className="mx-2 mb-2"
      parts={problemParts(reasonOf(problem))}
      role="alert"
      title={tokens ? "Not a valid tokens file." : "Not a valid design system."}
    >
      Fix it in <code className="font-code text-foreground">{file}</code>
      {tokens
        ? ": the values are design-system.json’s and the code’s until then."
        : ": designs use Ultrapaint’s default look until then."}
    </FileProblem>
  );
};

/** An item of the list: lit while its boards are open, a click opening them, its count at the right. */
const ItemRow = ({ item, open }: { item: SystemItem; open: boolean }) => (
  <button
    aria-current={open ? "page" : undefined}
    className="mx-2 flex h-7 w-[calc(100%-1rem)] items-center gap-2 rounded-md px-2 text-left font-body-medium text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground aria-[current=page]:bg-accent aria-[current=page]:text-foreground"
    onClick={() => openBoard({ item: item.id, view: "system" })}
    title={item.name}
    type="button"
  >
    <span className="truncate">{item.name}</span>
    {item.count > 0 ? (
      <span className="ml-auto font-body-small-medium text-muted-foreground tabular-nums">
        {item.count}
      </span>
    ) : null}
  </button>
);

/** While the list is read: rows in its shape. */
const LoadingRows = () => (
  <div
    aria-busy="true"
    aria-label="Reading the design system"
    className="flex flex-col"
    role="status"
  >
    {[56, 80, 64, 52, 72].map((width) => (
      <div className="mx-2 flex h-7 items-center px-2" key={width}>
        <span
          className="h-2.5 animate-pulse rounded-full bg-muted"
          style={{ width }}
        />
      </div>
    ))}
  </div>
);

/** The sync has something waiting (the rail's dot): what, and the way to it. */
const SyncWaiting = () => {
  const waiting = useSync((s) =>
    syncWaiting(s.plan)
      ? (s.plan?.steps.find((step) => step.state === "attention") ?? null)
      : null
  );
  if (!waiting) {
    return null;
  }
  return (
    <button
      className="mx-2 mb-1 flex min-h-7 w-[calc(100%-1rem)] items-center gap-2 rounded-md px-2 py-1 text-left outline-none transition-colors hover:bg-accent focus-visible:bg-accent"
      onClick={showSetup}
      title={waiting.detail}
      type="button"
    >
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-warning" />
      <span className="min-w-0 flex-1 truncate font-body-small">
        {waiting.title}
      </span>
      <span className="shrink-0 font-body-small text-muted-foreground">
        Review
      </span>
    </button>
  );
};

/**
 * No design system of its own (ADR 0062): the foundations listed are the default look's, and
 * this says so, with the ways to make the project's own. Nothing else asks for one.
 */
const DefaultLook = () => {
  const name = useProject((s) => s.info.name);
  return (
    <section
      aria-label="Default look"
      className="mx-2 mb-2 flex flex-col gap-3 rounded-lg bg-card p-2 ring-1 ring-border"
    >
      <div className="flex flex-col gap-0.5">
        <h3 className="font-heading-xsmall">Ultrapaint’s default look</h3>
        <p className="font-body-small text-muted-foreground">
          Designs use it until {name ?? "the project"} has its own.
        </p>
      </div>
      <div className="flex gap-2">
        <Button onClick={makeSystemFromCode} size="sm">
          Make it from the code
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button size="sm" variant="ghost" />}>
            Other ways
            <ChevronDown data-icon="inline-end" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={() => openLookPage()}>
              Pick a new look…
            </DropdownMenuItem>
            <DropdownMenuItem onClick={pickFigmaFile}>
              Import from Figma…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </section>
  );
};

export const DesignSystemList = () => {
  const configured = useProject((s) => s.info.configured);
  const designSystem = useDesignSystem((s) => s.designSystem);
  const document = useDesignSystem((s) => s.document);
  const loaded = useDesignSystem((s) => s.loaded);
  const problem = useDesignSystem((s) => s.problem);
  const notes = useDesignSystem((s) => s.notes);
  const setupShown = useDesignSystemSetup((s) => s.shown);
  const lookPage = useLookPage((s) => s.open);
  const openItem = useBoard((s) =>
    s.open?.view === "system" ? s.open.item : null
  );
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (configured && !loaded) {
      useDesignSystem.getState().load();
    }
  }, [configured, loaded]);

  if (!configured) {
    return <NoFolder />;
  }
  if (lookPage) {
    return <LookPanel />;
  }
  if (setupShown) {
    return <SyncView onBack={designSystem ? hideSetup : undefined} />;
  }
  // `design-system.json` is there and does not read: not a project with no design system, whose
  // foundations listed are the default look's.
  const unread = !designSystem && problem !== undefined;
  // Nothing is listed until the design system is read: the neutral Color would show meanwhile.
  const foundations =
    loaded && !unread ? foundationsOf(designSystem, query) : [];
  const guidelines = loaded ? guidelinesOf(document, query) : [];
  const searching = query.trim() !== "";

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center gap-0.5 pr-2 pl-4">
        <h2 className="flex-1 truncate font-heading-xsmall">Foundations</h2>
        <IconButton
          className="text-muted-foreground"
          onClick={showSetup}
          tooltip="Sync with the code"
        >
          <RefreshCw />
        </IconButton>
        {designSystem || !loaded ? (
          <IconButton
            className="text-muted-foreground"
            onClick={startInit}
            tooltip="Run /init with an agent"
          >
            <Wand2 />
          </IconButton>
        ) : null}
      </div>
      {loaded && !designSystem && !unread ? <DefaultLook /> : null}
      <div className="shrink-0 px-2 pb-2">
        <InputGroup>
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            aria-label="Search tokens and guidelines"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && query) {
                e.stopPropagation();
                setQuery("");
              }
            }}
            placeholder="Search"
            value={query}
          />
        </InputGroup>
      </div>
      <div className="min-h-0 flex-1 overflow-auto pb-2">
        {problem === undefined ? null : (
          <FilesProblem problem={problem} tokens={designSystem !== null} />
        )}
        {loaded ? <SyncWaiting /> : <LoadingRows />}
        {foundations.map((item) => (
          <ItemRow item={item} key={item.id} open={item.id === openItem} />
        ))}
        {guidelines.length > 0 ? <Heading>Guidelines</Heading> : null}
        {guidelines.map((item) => (
          <ItemRow item={item} key={item.id} open={item.id === openItem} />
        ))}
        {loaded && searching && foundations.length + guidelines.length === 0 ? (
          <PanelEmpty
            action={
              <Button
                onClick={() => setQuery("")}
                size="sm"
                variant="secondary"
              >
                Clear search
              </Button>
            }
            icon={<Search />}
            title={`Nothing matches “${query.trim()}”`}
          >
            Search by a token’s name or value, or a guideline’s words.
          </PanelEmpty>
        ) : null}
        <Findings findings={document?.findings ?? NONE} notes={notes ?? NONE} />
      </div>
    </div>
  );
};
