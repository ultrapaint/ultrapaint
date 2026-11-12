/**
 * The Git tab of the Changes panel, there only while the folder is a git repository (ADR 0087):
 * what git sees changed, each named as the editor names it (a page by its name and canvas, a
 * component, the design system), its lines added and removed; a tick on each, the designs'
 * ticked unless the person unticks them, the others' folded and unticked (ADR 0076); and at the
 * panel's foot the commit card, its branch, its message and Commit. Nothing is committed but by
 * that button.
 */
import type { GitFileStatus, GitStatus } from "@ultrapaint/contracts/git";
import { basename } from "@ultrapaint/shared/path";
import { plural } from "@ultrapaint/shared/text";
import { ChevronDown, GitBranch } from "lucide-react";
import {
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
  useId,
  useRef,
  useState,
} from "react";
import { create } from "zustand";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { api } from "../state/connection.ts";
import { useProject } from "../state/project.ts";

const GIT_EXITED_RE = /^git \S+ exited \d+:\s*/;
const PAGE_SUFFIX_RE = /\.page\.json$/;
const TRAILING_SLASH_RE = /\/$/;
const COMPONENT_SUFFIX_RE = /\.component\.json$/;
const DESIGN_SYSTEM_FILE_RE =
  /(^|\/)(DESIGN\.md|design\.tokens\.json|design-system\.json)$/;

/** What Commit, pressed, says is missing; null when it commits. */
export const commitBlocked = (ticked: number, message: string) => {
  if (ticked === 0) {
    return "Tick the changes to commit";
  }
  if (!message.trim()) {
    return `Write a message to commit ${plural(ticked, "change")}`;
  }
  return null;
};

/** Commit's button: how many changes it takes, once some are ticked. */
export const commitLabel = (ticked: number) =>
  ticked === 0 ? "Commit" : `Commit ${plural(ticked, "change")}`;

/** What git said when a command failed, without the server's "git commit exited 1:" before it. */
export const gitSaid = (message: string) =>
  message.replace(GIT_EXITED_RE, "").trim() || message;

/**
 * The folder every path of a group shares, left off its rows: two files or more only, so a
 * lone file still says where it is.
 */
export const sharedFolder = (paths: readonly string[]) => {
  if (paths.length < 2) {
    return "";
  }
  const folders = paths.map((p) => p.split("/").slice(0, -1));
  const [first = [], ...rest] = folders;
  let { length } = first;
  for (const folder of rest) {
    let i = 0;
    while (i < length && folder[i] === first[i]) {
      i += 1;
    }
    length = i;
  }
  return first.slice(0, length).join("/");
};

/**
 * What git says of a file, in a word, from its status code, where its lines do not say it. A
 * modified file says nothing. A conflict comes first: git writes some (`AA`, `DD`, `AU`, `DU`)
 * with the letters of a new or deleted file.
 */
export const statusWord = (code: string): string | null => {
  const c = code.trim();
  if (c.includes("U") || c === "AA" || c === "DD") {
    return "Conflict";
  }
  if (c === "??" || c.startsWith("A")) {
    return "New";
  }
  if (c.includes("D")) {
    return "Deleted";
  }
  if (c.startsWith("R")) {
    return "Renamed";
  }
  return null;
};

/** A changed file as the editor names it: what it is, and where it is muted after it. */
export const changeName = (
  path: string,
  pages: readonly { file: string; name: string; canvas: string }[],
  canvasName: (id: string) => string | undefined,
  designsDir = ""
): { name: string; where: string } => {
  const page = pages.find((p) => p.file === path);
  if (page) {
    return { name: page.name, where: canvasName(page.canvas) ?? "" };
  }
  const file = basename(path);
  // A canvas's layout: the canvas by its name. Its folder under the designs is its id.
  if (file === "canvas.json") {
    const prefix = designsDir === "" ? "" : `${designsDir}/`;
    const folder = path.slice(0, -file.length).replace(TRAILING_SLASH_RE, "");
    const id = folder === designsDir ? "" : folder.slice(prefix.length);
    const name = canvasName(id);
    if (name !== undefined) {
      return { name, where: "Canvas" };
    }
  }
  if (COMPONENT_SUFFIX_RE.test(file)) {
    return { name: file.replace(COMPONENT_SUFFIX_RE, ""), where: "Component" };
  }
  if (DESIGN_SYSTEM_FILE_RE.test(path)) {
    return { name: file, where: "Design system" };
  }
  if (PAGE_SUFFIX_RE.test(file)) {
    return { name: file.replace(PAGE_SUFFIX_RE, ""), where: "Page" };
  }
  return { name: file, where: path.split("/").slice(0, -1).join("/") };
};

/**
 * What the person chose of the commit, kept while the panel shows a diff or another tab: the
 * message, the designs' changes they unticked, the other files they ticked.
 */
interface CommitDraft {
  message: string;
  ticked: ReadonlySet<string>;
  unticked: ReadonlySet<string>;
}

export const useCommitDraft = create<CommitDraft>(() => ({
  message: "",
  ticked: new Set(),
  unticked: new Set(),
}));

/** The files a commit takes: the designs' unless unticked, the others' only once ticked. */
export const toCommit = (
  files: readonly GitFileStatus[],
  draft: Pick<CommitDraft, "ticked" | "unticked">
) =>
  files
    .filter((f) =>
      f.design ? !draft.unticked.has(f.path) : draft.ticked.has(f.path)
    )
    .map((f) => f.path);

const SECTION = "flex flex-col gap-0.5";

/** A skeleton's bar, plain to see on the panel in both themes. */
export const BAR = "h-3 rounded-sm bg-foreground/10 motion-safe:animate-pulse";

/** Rows in the shape of the ones on their way, so nothing moves when they come. */
const LoadingRows = () => (
  <div aria-label="Loading" className={SECTION} role="status">
    {["w-3/5", "w-2/5", "w-1/2"].map((width) => (
      <div className="flex h-8 items-center gap-2 px-2" key={width}>
        <span className="min-w-0 flex-1">
          <span className={cn(BAR, "block", width)} />
        </span>
      </div>
    ))}
  </div>
);

/**
 * What could not be read, in full on the errors' red box, and the way to read it again.
 */
export const Unread = ({
  children,
  onRetry,
}: {
  children: ReactNode;
  onRetry: () => void;
}) => (
  <div className="flex min-h-7 items-center justify-between gap-2 rounded-md bg-destructive/10 py-0.5 pr-0.5 pl-2">
    <span className="wrap-anywhere min-w-0 font-body-small text-destructive">
      {children}
    </span>
    <Button className="shrink-0" onClick={onRetry} size="sm" variant="ghost">
      Try again
    </Button>
  </div>
);

/** A file's lines added and removed, as git counts them; a word where they say nothing. */
const Lines = ({ file }: { file: GitFileStatus }) => {
  const word = statusWord(file.code);
  if (word === "Conflict" || !file.lines) {
    return word ? (
      <span
        className={cn(
          "shrink-0 font-body-small",
          word === "Conflict" ? "text-foreground" : "text-muted-foreground"
        )}
      >
        {word === "Conflict" ? (
          <span
            aria-hidden
            className="mr-1 inline-block size-1.5 rounded-full bg-warning align-middle"
          />
        ) : null}
        {word}
      </span>
    ) : null;
  }
  const { added, removed } = file.lines;
  return (
    <span className="flex shrink-0 gap-1.5 font-body-small tabular-nums">
      {/* Said in words to a screen reader; the colours and signs are for the eye. */}
      <span className="sr-only">
        {plural(added, "line")} added, {plural(removed, "line")} removed
      </span>
      {added > 0 ? (
        <span aria-hidden className="text-success">
          +{added}
        </span>
      ) : null}
      {removed > 0 ? (
        <span aria-hidden className="text-destructive">
          −{removed}
        </span>
      ) : null}
      {added === 0 && removed === 0 ? (
        <span className="text-muted-foreground">{word ?? "Changed"}</span>
      ) : null}
    </span>
  );
};

/**
 * A row: its tick, then its button over the rest of it, so a click anywhere but the tick shows
 * the file's changes and keyboard focus rings the whole row.
 */
const ChangeRow = ({
  file,
  name,
  onShow,
  onTick,
  ticked,
  where,
}: {
  file: GitFileStatus;
  name: string;
  onShow: () => void;
  onTick: () => void;
  ticked: boolean;
  where: string;
}) => (
  <li className="relative flex h-8 shrink-0 items-center gap-2 rounded-md pr-2 pl-2 transition-colors duration-100 hover:bg-accent/50 has-[[data-row-button]:focus-visible]:ring-2 has-[[data-row-button]:focus-visible]:ring-ring">
    <Checkbox
      aria-label={`Commit ${name}`}
      checked={ticked}
      className="z-10"
      onCheckedChange={onTick}
    />
    {/* The row has room for part of its name; its tooltip has the file's whole path. */}
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            className="flex min-w-0 flex-1 items-baseline gap-2 text-left outline-none after:absolute after:inset-0 after:rounded-md"
            data-row-button
            onClick={onShow}
            type="button"
          >
            <span className="min-w-0 truncate font-body-medium">{name}</span>
            {where ? (
              // The place gives way first; the name truncates only once it is gone.
              <span className="min-w-0 shrink-[999] truncate font-body-small text-muted-foreground">
                {where}
              </span>
            ) : null}
            <span className="ml-auto flex shrink-0">
              <Lines file={file} />
            </span>
          </button>
        }
      />
      <TooltipContent className="wrap-anywhere">{file.path}</TooltipContent>
    </Tooltip>
  </li>
);

/**
 * The commit card, at the panel's foot whatever the list holds: the field's label and the
 * branch it commits to, the message growing as it is written, and Commit under it, which says
 * what is missing when pressed too soon and what git said when it failed.
 */
const CommitCard = ({
  branch,
  paths,
}: {
  branch: string | undefined;
  paths: readonly string[];
}) => {
  const id = useId();
  const message = useCommitDraft((s) => s.message);
  const [busy, setBusy] = useState(false);
  const [asked, setAsked] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const missing = asked ? commitBlocked(paths.length, message) : null;

  const commit = async () => {
    // Pressed again while a commit is on its way is not a second commit.
    if (busy) {
      return;
    }
    if (commitBlocked(paths.length, message) !== null) {
      setAsked(true);
      if (paths.length > 0) {
        field.current?.focus();
      }
      return;
    }
    const sent = message;
    setBusy(true);
    setFailure(null);
    try {
      await api().request("git.commit", { message: sent, paths: [...paths] });
      setAsked(false);
      useCommitDraft.setState((s) => {
        const ticked = new Set(s.ticked);
        const unticked = new Set(s.unticked);
        for (const path of paths) {
          ticked.delete(path);
          unticked.delete(path);
        }
        return {
          message: s.message === sent ? "" : s.message,
          ticked,
          unticked,
        };
      });
    } catch (error) {
      setFailure(
        gitSaid(error instanceof Error ? error.message : String(error))
      );
    } finally {
      setBusy(false);
    }
  };

  const onChange = (e: ChangeEvent<HTMLTextAreaElement>) =>
    useCommitDraft.setState({ message: e.target.value });
  // ⌘↵ or Ctrl+↵ commits; Enter alone is a new line of the message.
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      commit();
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-lg bg-muted p-3">
      <div className="flex items-center gap-2">
        <label className="flex-1 font-body-semibold" htmlFor={id}>
          Message
        </label>
        {branch ? (
          <span className="flex min-w-0 items-center gap-1 font-body-small text-muted-foreground">
            <GitBranch className="size-3.5 shrink-0" />
            <span className="truncate">{branch}</span>
          </span>
        ) : null}
      </div>
      <Textarea
        aria-describedby={missing || failure ? `${id}-said` : undefined}
        aria-invalid={failure ? true : undefined}
        className="max-h-40 min-h-16 bg-background"
        id={id}
        onChange={onChange}
        onKeyDown={onKeyDown}
        placeholder="Tighten the header’s spacing"
        ref={field}
        value={message}
      />
      {failure ? (
        <p
          className="wrap-anywhere whitespace-pre-line font-body-small text-destructive"
          id={`${id}-said`}
          role="alert"
        >
          Couldn’t commit: {failure}
        </p>
      ) : null}
      {missing && !busy && !failure ? (
        <p className="font-body-small text-muted-foreground" id={`${id}-said`}>
          {missing}
        </p>
      ) : null}
      <Button aria-busy={busy} className="w-full" onClick={commit}>
        {busy ? <Spinner /> : null}
        {commitLabel(paths.length)}
      </Button>
    </div>
  );
};

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

/** When the last commit was made, as a person says it: "2 minutes ago", "yesterday". */
export const ago = (at: number, now = Date.now()) => {
  const seconds = Math.round((at - now) / 1000);
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ["second", 60],
    ["minute", 60],
    ["hour", 24],
    ["day", 30],
    ["month", 12],
  ];
  let value = seconds;
  for (const [unit, size] of steps) {
    if (Math.abs(value) < size) {
      return relative.format(value, unit);
    }
    value = Math.round(value / size);
  }
  return relative.format(value, "year");
};

/** Nothing changed since the last commit: said where the list would be, with that commit. */
const NothingToCommit = ({ status }: { status: GitStatus }) => (
  <div className="flex flex-1 flex-col items-center justify-center gap-1 px-6 pb-16 text-center">
    <p className="font-body-medium">Nothing to commit</p>
    <p className="font-body-small text-muted-foreground">
      The designs are as the last commit has them.
    </p>
    {status.lastCommit ? (
      <p className="mt-3 font-body-small text-muted-foreground">
        Last commit: “{status.lastCommit.message}”, {ago(status.lastCommit.at)}
      </p>
    ) : null}
  </div>
);

/** A folded group's header: its title and count, and a chevron, the whole header the toggle. */
const FoldHeader = ({
  count,
  onToggle,
  open,
  title,
}: {
  count: number;
  onToggle: () => void;
  open: boolean;
  title: string;
}) => (
  <button
    aria-expanded={open}
    className="flex h-8 w-full items-center gap-1.5 rounded-md px-2 text-left font-body-small-medium text-muted-foreground outline-none transition-colors duration-100 hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring"
    onClick={onToggle}
    type="button"
  >
    {title}
    <span className="font-body-small">{count}</span>
    <ChevronDown
      aria-hidden
      className={cn(
        "ml-auto size-4 shrink-0 transition-transform duration-150",
        open && "rotate-180"
      )}
    />
  </button>
);

/** The Git tab: what changed, ticked to go in the commit, and the commit card at its foot. */
export const GitTab = ({
  failed,
  onRetry,
  onShowFile,
  status,
}: {
  failed: boolean;
  onRetry: () => void;
  onShowFile: (path: string) => void;
  status: GitStatus | null;
}) => {
  const pages = useProject((s) => s.pages);
  const canvases = useProject((s) => s.canvases);
  const designsDir = useProject((s) => s.settings?.designsDir ?? "");
  const ticked = useCommitDraft((s) => s.ticked);
  const unticked = useCommitDraft((s) => s.unticked);
  // Files Ultrapaint did not write are listed only when asked for.
  const [showOther, setShowOther] = useState(false);
  const files = status?.files ?? [];
  const design = files.filter((f) => f.design);
  const other = files.filter((f) => !f.design);
  const paths = toCommit(files, { ticked, unticked });
  const canvasName = (id: string) => canvases.find((c) => c.id === id)?.name;
  const shared = sharedFolder(other.map((f) => f.path));

  const tick = (file: GitFileStatus) =>
    useCommitDraft.setState((s) => {
      const key = file.design ? "unticked" : "ticked";
      const next = new Set(s[key]);
      if (next.has(file.path)) {
        next.delete(file.path);
      } else {
        next.add(file.path);
      }
      return { [key]: next };
    });
  const isTicked = (file: GitFileStatus) =>
    file.design ? !unticked.has(file.path) : ticked.has(file.path);

  // Folding the other files unticks them, so a commit takes only files in view.
  const toggleOther = () => {
    if (showOther) {
      useCommitDraft.setState({ ticked: new Set() });
    }
    setShowOther(!showOther);
  };

  let list: ReactNode;
  if (failed) {
    list = <Unread onRetry={onRetry}>Git didn’t answer</Unread>;
  } else if (status === null) {
    list = <LoadingRows />;
  } else if (files.length === 0) {
    return <NothingToCommit status={status} />;
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto px-2 pt-1 pb-3">
        {list}
        {design.length > 0 ? (
          <ul aria-label="Changes to the designs" className={SECTION}>
            {design.map((file) => {
              const { name, where } = changeName(
                file.path,
                pages,
                canvasName,
                designsDir
              );
              return (
                <ChangeRow
                  file={file}
                  key={file.path}
                  name={name}
                  onShow={() => onShowFile(file.path)}
                  onTick={() => tick(file)}
                  ticked={isTicked(file)}
                  where={where}
                />
              );
            })}
          </ul>
        ) : null}
        {other.length > 0 ? (
          <div className={SECTION}>
            <FoldHeader
              count={other.length}
              onToggle={toggleOther}
              open={showOther}
              title={design.length > 0 ? "Other files" : "Files"}
            />
            {showOther ? (
              <ul aria-label="Other files" className={SECTION}>
                {other.map((file) => {
                  const folder = file.path
                    .split("/")
                    .slice(0, -1)
                    .join("/")
                    .slice(shared ? shared.length + 1 : 0);
                  return (
                    <ChangeRow
                      file={file}
                      key={file.path}
                      name={basename(file.path)}
                      onShow={() => onShowFile(file.path)}
                      onTick={() => tick(file)}
                      ticked={isTicked(file)}
                      where={folder}
                    />
                  );
                })}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
      {status ? (
        <div className="shrink-0 px-2 pb-2">
          <CommitCard branch={status.branch} paths={paths} />
        </div>
      ) : null}
    </div>
  );
};
