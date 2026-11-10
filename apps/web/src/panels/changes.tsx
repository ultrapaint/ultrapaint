import type { GitStatus } from "@ultrapaint/contracts/git";
import { writesGit } from "@ultrapaint/contracts/settings";
import type {
  Checkpoint,
  FileDiff,
  Snapshot,
} from "@ultrapaint/contracts/snapshots";
import { plural } from "@ultrapaint/shared/text";
import { ArrowLeft, Ellipsis, Plus } from "lucide-react";
import {
  type ChangeEvent,
  type Dispatch,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  type SetStateAction,
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { IconButton } from "../components/icon-button.tsx";
import { NoFolder } from "../components/no-folder.tsx";
import { undoOrRedo } from "../lib/shortcuts.ts";
import {
  deleteSnapshot,
  openSnapshot,
  restoreSnapshot,
  saveSnapshot,
} from "../lib/snapshot-actions.ts";
import { useAgents } from "../state/agents.ts";
import { api } from "../state/connection.ts";
import { useKept } from "../state/kept.ts";
import { useRequest } from "../state/panels.ts";
import { reportError, useProject } from "../state/project.ts";
import { follow } from "../state/server-data.ts";
import { useSnapshotView } from "../state/snapshot-view.ts";

/** An added or removed line: one `+` or `-`, not the `+++` and `---` that name the files. */
const ADDED_RE = /^\+(?!\+\+)/;
const REMOVED_RE = /^-(?!--)/;
const TRAILING_NEWLINE_RE = /\n$/;
const GIT_EXITED_RE = /^git \S+ exited \d+:\s*/;

/** How long the files are left to settle before the panel asks again what changed. */
const FILES_SETTLE_MS = 250;

/** A point of the history: a snapshot or an agent's checkpoint. */
type Point = "snapshot" | "checkpoint";

/**
 * What the panel shows in place of its lists: one file's diff, under its path, or all since a
 * point, under the point's name (a checkpoint's is a sentence: "Before the header pass").
 */
type OpenDiff =
  | { diffs: readonly FileDiff[]; kind: "file"; path: string }
  | { diffs: readonly FileDiff[]; kind: Point; name: string };

/** The files still ticked after a commit: those ticked while it was on its way stay ticked. */
export const tickedAfterCommit = (
  ticked: ReadonlySet<string>,
  committed: readonly string[]
): Set<string> => {
  const left = new Set(ticked);
  for (const path of committed) {
    left.delete(path);
  }
  return left;
};

/** A group's select-all: ticked when all its files are, mixed when some are. */
export const groupTicked = (
  paths: readonly string[],
  ticked: ReadonlySet<string>
): "all" | "some" | "none" => {
  const count = paths.filter((p) => ticked.has(p)).length;
  if (count === 0) {
    return "none";
  }
  return count === paths.length ? "all" : "some";
};

/** What Commit, pressed, says is missing; null when it commits. */
export const commitBlocked = (ticked: number, message: string) => {
  if (ticked === 0) {
    return "Tick the files to commit";
  }
  if (!message.trim()) {
    return `Write a message to commit ${plural(ticked, "file", "files")}`;
  }
  return null;
};

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
 * What git says of a file, in a word, from its status code. A modified file says nothing: the
 * list is of changed files.
 */
export const statusWord = (code: string): string | null => {
  const c = code.trim();
  if (c === "??" || c.startsWith("A")) {
    return "New";
  }
  if (c.includes("D")) {
    return "Deleted";
  }
  if (c.startsWith("R")) {
    return "Renamed";
  }
  if (c.includes("U")) {
    return "Conflict";
  }
  return null;
};

/**
 * What a diff since a point says above the files: how many changed since it, or that none did.
 */
export const changedSince = (count: number, point: Point) =>
  count === 0
    ? `No design file has changed since this ${point}.`
    : `${plural(count, "design file", "design files")} changed since this ${point}.`;

/** What git said when a command failed, without the server's "git commit exited 1:" before it. */
export const gitSaid = (message: string) =>
  message.replace(GIT_EXITED_RE, "").trim() || message;

export const Changes = () => {
  const configured = useProject((s) => s.info.configured);
  // Without git, or in a folder that is no repository, the panel has its history only.
  const repository = useProject((s) => s.info.gitRepository === true);
  // Committing, or making the folder a repository, is for when writing to git is on.
  const writes = useProject(
    (s) => s.settings !== null && writesGit(s.settings)
  );
  // Looked at: the rail stops saying an agent changed something.
  useEffect(() => {
    useAgents.getState().clearChanged();
  }, []);
  const repoPath = useProject((s) => s.info.repoPath);
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [gitFailed, setGitFailed] = useState(false);
  const [historyFailed, setHistoryFailed] = useState(false);
  const [open, setOpen] = useState<OpenDiff | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState("");
  const checkpoints = useKept((s) => s.checkpoints);
  const snapshots = useKept((s) => s.snapshots);
  const [busy, setBusy] = useState(false);
  // Commit pressed before it could commit: the bar says what is missing until it is there.
  const [asked, setAsked] = useState(false);
  // What git said when the last commit, or making the repository, failed: under its button.
  const [failure, setFailure] = useState<string | null>(null);
  const messageField = useRef<HTMLInputElement>(null);
  const readGit = useRef<(() => void) | null>(null);

  /** Git's status, with the files no longer changed unticked. */
  const takeStatus = useEffectEvent((s: GitStatus) => {
    setStatus(s);
    setGitFailed(false);
    setSelected(
      (prev) =>
        new Set(
          Array.from(prev).filter((p) => s.files.some((f) => f.path === p))
        )
    );
  });

  /** The history, read; a read that fails says so in the panel, with the way to read it again. */
  const readHistory = () =>
    useKept
      .getState()
      .load()
      // `load` reports its own failure; the lists still unread are what says it failed.
      .then(() => setHistoryFailed(useKept.getState().snapshots === null));
  const retryHistory = () => {
    setHistoryFailed(false);
    readHistory();
  };

  // The history, read as the panel opens on a repository and followed from then on.
  // biome-ignore lint/correctness/useExhaustiveDependencies: read again only for another folder.
  useEffect(() => {
    if (configured && repoPath !== undefined) {
      readHistory();
    }
  }, [configured, repoPath]);

  // Git's status, followed while the panel is shown on a repository: read now, at every
  // connection open, on git's own news, and as files change. A git that does not answer is said
  // where the files would be, with the way to ask again.
  useEffect(() => {
    if (!(configured && repository)) {
      return;
    }
    // A save, a checkout or an agent changes many files at once: one read for all of them.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const gitStatus = follow({
      apply: (s) => takeStatus(s),
      on: {
        "file.changed": () => {
          clearTimeout(timer);
          timer = setTimeout(read, FILES_SETTLE_MS);
        },
        git: (s) => takeStatus(s),
      },
      read: () => api().request("git.status", undefined),
      whole: ["git"],
    });
    const read = () => {
      gitStatus.read().catch(() => setGitFailed(true));
    };
    readGit.current = read;
    read();
    return () => {
      clearTimeout(timer);
      gitStatus.stop();
      readGit.current = null;
    };
  }, [configured, repository]);

  const showDiff = async (path: string) => {
    try {
      const diff = await api().request("git.diff", { path });
      setOpen({ diffs: [diff], kind: "file", path: diff.path });
    } catch (error) {
      reportError(error);
    }
  };

  // A file asked for from elsewhere, before the panel was open or while it is.
  useRequest("diff", showDiff, configured);

  const showSince: ShowSince = (kind, name, diffs) =>
    setOpen({ diffs, kind, name });

  /** Runs a git command from the panel: busy while it goes, what git said under it if it fails. */
  const run = async (request: () => Promise<unknown>) => {
    setBusy(true);
    setFailure(null);
    try {
      await request();
      return true;
    } catch (error) {
      setFailure(
        gitSaid(error instanceof Error ? error.message : String(error))
      );
      return false;
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    // Enter again while a commit is on its way is not a second commit.
    if (busy) {
      return;
    }
    // Pressed too soon, it says what is missing, and takes the keys to the message it wants.
    if (commitBlocked(selected.size, message) !== null) {
      setAsked(true);
      if (selected.size > 0) {
        messageField.current?.focus();
      }
      return;
    }
    const sent = message;
    const paths = Array.from(selected);
    const done = await run(() =>
      api().request("git.commit", { message: sent, paths })
    );
    if (done) {
      setAsked(false);
      setMessage((current) => (current === sent ? "" : current));
      setSelected((current) => tickedAfterCommit(current, paths));
    }
  };

  const init = () => run(() => api().request("git.init", undefined));

  const onMessageChange = (e: ChangeEvent<HTMLInputElement>) =>
    setMessage(e.target.value);
  const onMessageKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      commit();
    }
  };

  if (!configured) {
    return <NoFolder />;
  }

  if (open) {
    return <OpenDiffView onBack={() => setOpen(null)} open={open} />;
  }

  // Without a repository, a status read before is not this folder's.
  const shown = repository ? status : null;
  const files = shown?.files ?? [];
  const design = files.filter((f) => f.design);
  const other = files.filter((f) => !f.design);
  const retryGit = () => {
    setGitFailed(false);
    readGit.current?.();
  };

  return (
    <div className="flex h-full flex-col">
      {/* Its title starts where its rows' words do. */}
      <div className="flex h-11 shrink-0 items-center pr-2 pl-4">
        <h2 className="flex-1 font-heading-xsmall">Changes</h2>
      </div>
      {/* One scroller: the files, then the history, set apart by space alone. */}
      <div className="flex min-h-0 flex-1 flex-col gap-8 overflow-auto px-2 pt-3 pb-3">
        {repository ? null : (
          <NoRepository
            busy={busy}
            failure={failure}
            onInit={writes ? init : null}
          />
        )}
        {repository && writes && files.length > 0 ? (
          <CommitBar
            busy={busy}
            failure={failure}
            message={message}
            messageField={messageField}
            missing={asked ? commitBlocked(selected.size, message) : null}
            onCommit={commit}
            onMessageChange={onMessageChange}
            onMessageKeyDown={onMessageKeyDown}
          />
        ) : null}
        {repository && files.length === 0 ? (
          <section className={SECTION}>
            <GroupLabel>Changed files</GroupLabel>
            <FilesState
              failed={gitFailed}
              loading={shown === null}
              onRetry={retryGit}
            />
          </section>
        ) : null}
        <FileGroup
          files={design}
          onShow={showDiff}
          selected={writes ? selected : null}
          setSelected={setSelected}
          title="Design files"
        />
        <FileGroup
          files={other}
          onShow={showDiff}
          selected={writes ? selected : null}
          setSelected={setSelected}
          title="Other files"
        />
        <Snapshots
          failed={historyFailed}
          onRetry={retryHistory}
          onShowSince={showSince}
          snapshots={snapshots}
        />
        {/* One read brings both lists: its failure is said once, under Snapshots. */}
        {historyFailed && checkpoints === null ? null : (
          <Checkpoints
            checkpoints={checkpoints}
            failed={historyFailed}
            onRetry={retryHistory}
            onShowSince={showSince}
          />
        )}
      </div>
    </div>
  );
};

/** One file's diff, or all since a point, in place of the lists, with the way back to them. */
const OpenDiffView = ({
  onBack,
  open,
}: {
  onBack: () => void;
  open: OpenDiff;
}) => (
  <div className="flex h-full flex-col">
    {/* A long path or name wraps: the title is the only place it is read in full. */}
    <div className="flex min-h-11 shrink-0 items-center gap-1 py-1.5 pr-3 pl-1.5">
      <IconButton
        className="shrink-0 text-muted-foreground"
        onClick={onBack}
        tooltip="Back"
      >
        <ArrowLeft />
      </IconButton>
      <h2 className="wrap-anywhere min-w-0 font-heading-xsmall">
        {open.kind === "file" ? open.path : open.name}
      </h2>
    </div>
    <div className="min-h-0 flex-1 overflow-auto">
      <DiffView
        diffs={open.diffs}
        since={open.kind === "file" ? null : open.kind}
      />
    </div>
  </div>
);

/** A section of the panel: its title, then its rows, 2px apart so their fills never touch. */
const SECTION = "flex flex-col gap-0.5";

/** Without a repository: that the history is kept all the same, and the way to make one. */
const NoRepository = ({
  busy,
  failure,
  onInit,
}: {
  busy: boolean;
  failure: string | null;
  onInit: (() => void) | null;
}) => (
  <div className="flex flex-col items-start gap-2 px-2">
    <p className="font-body-small text-muted-foreground">
      This folder is not a git repository. Snapshots and checkpoints still keep
      the designs’ history.
    </p>
    {onInit ? (
      <Button disabled={busy} onClick={onInit} size="sm" variant="secondary">
        {busy ? <Spinner /> : null}
        Make it a git repository
      </Button>
    ) : null}
    {onInit && failure ? (
      <GitFailure what="Couldn’t make it a repository">{failure}</GitFailure>
    ) : null}
  </div>
);

/** What git said when a command of the panel failed, under its button, and what to do. */
const GitFailure = ({ children, what }: { children: string; what: string }) => (
  <div
    className="wrap-anywhere w-full rounded-md bg-destructive/10 px-2 py-1.5 font-body-small"
    role="alert"
  >
    {/* Git's own lines, as it wrote them. */}
    <p className="whitespace-pre-line text-destructive">
      {what}: {children}
    </p>
    <p className="mt-1 text-muted-foreground">
      Fix what git says, then try again.
    </p>
  </div>
);

/** The changed files while there are none to list: being read, unread, or none. */
const FilesState = ({
  failed,
  loading,
  onRetry,
}: {
  failed: boolean;
  loading: boolean;
  onRetry: () => void;
}) => {
  if (failed) {
    return <Unread onRetry={onRetry}>Git didn’t answer</Unread>;
  }
  if (loading) {
    return <LoadingRows />;
  }
  return <NoneRow>No changes</NoneRow>;
};

/**
 * The message and the commit of the ticked files: the one action the panel is for. Commit is
 * always pressable; pressed too soon, it says what is missing under the bar.
 */
const CommitBar = ({
  busy,
  failure,
  message,
  messageField,
  missing,
  onCommit,
  onMessageChange,
  onMessageKeyDown,
}: {
  busy: boolean;
  failure: string | null;
  message: string;
  messageField: RefObject<HTMLInputElement | null>;
  /** What Commit, pressed, said is missing, while it still is. */
  missing: string | null;
  onCommit: () => void;
  onMessageChange: (e: ChangeEvent<HTMLInputElement>) => void;
  onMessageKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
}) => {
  const id = useId();
  return (
    <div className="flex flex-col gap-2">
      <div className={SECTION}>
        <label
          className="flex h-8 items-center px-2 font-heading-xsmall"
          htmlFor={id}
        >
          Commit message
        </label>
        <div className="flex gap-2">
          <Input
            aria-describedby={missing ? `${id}-missing` : undefined}
            id={id}
            onChange={onMessageChange}
            onKeyDown={onMessageKeyDown}
            placeholder="Tighten the header’s spacing"
            ref={messageField}
            value={message}
          />
          <Button aria-busy={busy} disabled={busy} onClick={onCommit}>
            {busy ? <Spinner /> : null}
            {busy ? "Committing…" : "Commit"}
          </Button>
        </div>
      </div>
      {missing && !busy ? (
        <p
          className="px-2 font-body-small text-muted-foreground"
          id={`${id}-missing`}
        >
          {missing}
        </p>
      ) : null}
      {failure ? (
        <GitFailure what="Couldn’t commit">{failure}</GitFailure>
      ) : null}
    </div>
  );
};

/** A section's title over its rows, with what can be done to it at its end. */
const GroupLabel = ({
  action,
  children,
  id,
  lead,
}: {
  action?: ReactNode;
  children: ReactNode;
  /** The title's id, which names the section's list. */
  id?: string;
  /** Before the title, in the column the rows' checkboxes are in. */
  lead?: ReactNode;
}) => (
  <div className="flex h-8 shrink-0 items-center gap-2 pr-1 pl-2">
    {lead}
    <h3 className="min-w-0 flex-1 truncate font-heading-xsmall" id={id}>
      {children}
    </h3>
    {action}
  </div>
);

/** An empty section's one row, in muted. */
const NoneRow = ({ children }: { children: ReactNode }) => (
  <p className="flex h-7 items-center px-2 font-body-small text-muted-foreground">
    {children}
  </p>
);

/** A section whose read failed: what happened, and the way to read it again. */
const Unread = ({
  children,
  onRetry,
}: {
  children: ReactNode;
  onRetry: () => void;
}) => (
  <div className="flex h-7 items-center justify-between gap-2 pl-2">
    <span className="truncate font-body-small text-muted-foreground">
      {children}
    </span>
    <Button onClick={onRetry} size="sm" variant="ghost">
      Try again
    </Button>
  </div>
);

const SKELETON_WIDTHS = ["w-3/5", "w-2/5", "w-1/2"] as const;

/** A skeleton's bar, plain to see on the panel in both themes. */
const BAR = "h-3 rounded-sm bg-foreground/10 motion-safe:animate-pulse";

/**
 * Rows in the shape of the ones on their way: a history row's name, its time and its menu's
 * column, so nothing moves when they come.
 */
const LoadingRows = ({ history = false }: { history?: boolean }) => (
  <div aria-label="Loading" className={SECTION} role="status">
    {SKELETON_WIDTHS.map((width) => (
      <div
        className={cn(
          "flex h-7 items-center gap-2 pl-2",
          history ? "pr-1" : "pr-2"
        )}
        key={width}
      >
        <span className="min-w-0 flex-1">
          <span className={cn(BAR, "block", width)} />
        </span>
        {history ? (
          <>
            <span className={cn(BAR, "w-10 shrink-0")} />
            <span className="size-6 shrink-0" />
          </>
        ) : null}
      </div>
    ))}
  </div>
);

/**
 * A row of a list: its button covers the whole row, so a click anywhere on it shows what changed,
 * and keyboard focus rings the whole row. What else the row holds sits above the button.
 */
const ROW =
  "relative flex h-7 shrink-0 items-center gap-2 rounded-md pl-2 transition-colors duration-100 hover:bg-accent/50 has-[[data-row-button]:focus-visible]:ring-2 has-[[data-row-button]:focus-visible]:ring-ring";
const ROW_BUTTON =
  "flex min-w-0 flex-1 items-center gap-2 text-left outline-none after:absolute after:inset-0 after:rounded-md";

/** What the panel calls to show all that changed since a point. */
type ShowSince = (
  kind: Point,
  name: string,
  diffs: readonly FileDiff[]
) => void;

/** What can be done to a row of the history, in a menu at its end, there at rest. */
const RowMenu = ({ children, name }: { children: ReactNode; name: string }) => (
  <DropdownMenu>
    <Tooltip>
      <TooltipTrigger
        render={
          <DropdownMenuTrigger
            render={
              <Button
                aria-label={`Actions for ${name}`}
                className="relative text-muted-foreground data-popup-open:bg-accent data-popup-open:text-foreground"
                size="icon-sm"
                variant="ghost"
              />
            }
          />
        }
      >
        <Ellipsis />
      </TooltipTrigger>
      <TooltipContent>Actions</TooltipContent>
    </Tooltip>
    <DropdownMenuContent align="end" className="w-44">
      {children}
    </DropdownMenuContent>
  </DropdownMenu>
);

const dateFormat = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
});
const timeFormat = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});
/** The time of a point taken today, the day of an older one. */
const whenTaken = (at: number, now = new Date()) =>
  new Date(at).toDateString() === now.toDateString()
    ? timeFormat.format(at)
    : dateFormat.format(at);

/** A point of the history: its name, when it was taken, its menu. */
const HistoryRow = ({
  at,
  children,
  current = false,
  name,
  onShow,
}: {
  at: number;
  /** The menu's items. */
  children: ReactNode;
  /** Open on the canvas: said in a word as well as by the row's fill. */
  current?: boolean;
  name: string;
  onShow: () => void;
}) => (
  <li className={cn(ROW, "pr-1", current && "bg-accent hover:bg-accent")}>
    <button
      aria-current={current ? "true" : undefined}
      className={ROW_BUTTON}
      data-row-button
      onClick={onShow}
      type="button"
    >
      <span className="min-w-0 flex-1 truncate font-body-medium">{name}</span>
      {current ? <span className="shrink-0 font-body-small">Open</span> : null}
      <span className="shrink-0 font-body-small text-muted-foreground tabular-nums">
        {whenTaken(at)}
      </span>
    </button>
    <RowMenu name={name}>{children}</RowMenu>
  </li>
);

/**
 * Named points in the history of the designs, kept until deleted: compared with now, opened to
 * look at as they were, restored.
 */
const Snapshots = ({
  failed,
  onRetry,
  onShowSince,
  snapshots,
}: {
  failed: boolean;
  onRetry: () => void;
  onShowSince: ShowSince;
  snapshots: readonly Snapshot[] | null;
}) => {
  const id = useId();
  return (
    <section aria-labelledby={id} className={SECTION}>
      <GroupLabel
        action={
          <IconButton
            className="text-muted-foreground"
            onClick={() => saveSnapshot()}
            size="icon-sm"
            tooltip="Save snapshot"
          >
            <Plus />
          </IconButton>
        }
        id={id}
      >
        Snapshots
      </GroupLabel>
      <HistoryRows
        failed={failed}
        items={snapshots}
        label={id}
        onRetry={onRetry}
        row={(snapshot) => (
          <SnapshotRow
            key={snapshot.id}
            onShowSince={onShowSince}
            snapshot={snapshot}
          />
        )}
      />
    </section>
  );
};

/** A history list's rows: being read, unread, none yet, or the points, as a list. */
const HistoryRows = <T,>({
  failed,
  items,
  label,
  onRetry,
  row,
}: {
  failed: boolean;
  items: readonly T[] | null;
  /** The id of the title that names the list. */
  label: string;
  onRetry: () => void;
  row: (item: T) => ReactNode;
}) => {
  if (items === null) {
    return failed ? (
      <Unread onRetry={onRetry}>The history didn’t load</Unread>
    ) : (
      <LoadingRows history />
    );
  }
  return items.length === 0 ? (
    <NoneRow>None yet</NoneRow>
  ) : (
    <ul aria-labelledby={label} className={SECTION}>
      {items.map(row)}
    </ul>
  );
};

const SnapshotRow = ({
  onShowSince,
  snapshot,
}: {
  onShowSince: ShowSince;
  snapshot: Snapshot;
}) => {
  const open = useSnapshotView((s) => s.view?.snapshot.id === snapshot.id);
  const show = () =>
    api()
      .request("snapshots.diff", { id: snapshot.id })
      .then((diffs) => onShowSince("snapshot", snapshot.name, diffs))
      .catch(reportError);
  return (
    <HistoryRow
      at={snapshot.at}
      current={open}
      name={snapshot.name}
      onShow={show}
    >
      <DropdownMenuItem onClick={() => openSnapshot(snapshot)}>
        Open on canvas
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => restoreSnapshot(snapshot)}>
        Restore
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        onClick={() => deleteSnapshot(snapshot)}
        variant="destructive"
      >
        Delete…
      </DropdownMenuItem>
    </HistoryRow>
  );
};

/** The designs as they were before each agent turn, the last ones kept. */
const Checkpoints = ({
  checkpoints,
  failed,
  onRetry,
  onShowSince,
}: {
  checkpoints: readonly Checkpoint[] | null;
  failed: boolean;
  onRetry: () => void;
  onShowSince: ShowSince;
}) => {
  const id = useId();
  return (
    <section aria-labelledby={id} className={SECTION}>
      <GroupLabel id={id}>Agent checkpoints</GroupLabel>
      <HistoryRows
        failed={failed}
        items={checkpoints}
        label={id}
        onRetry={onRetry}
        row={(c) => (
          <CheckpointRow checkpoint={c} key={c.id} onShowSince={onShowSince} />
        )}
      />
    </section>
  );
};

/** Back to a checkpoint at once: it is one step, so the toast's Undo takes it back. */
const restoreCheckpoint = async (checkpoint: Checkpoint) => {
  try {
    await api().request("checkpoints.revert", { id: checkpoint.id });
    toast.success(`Restored ${checkpoint.label}`, {
      action: { label: "Undo", onClick: () => undoOrRedo(false) },
    });
  } catch (error) {
    reportError(error);
  }
};

const CheckpointRow = ({
  checkpoint,
  onShowSince,
}: {
  checkpoint: Checkpoint;
  onShowSince: ShowSince;
}) => {
  const show = () =>
    api()
      .request("checkpoints.diff", { id: checkpoint.id })
      .then((diffs) => onShowSince("checkpoint", checkpoint.label, diffs))
      .catch(reportError);
  return (
    <HistoryRow at={checkpoint.at} name={checkpoint.label} onShow={show}>
      <DropdownMenuItem onClick={() => saveSnapshot(checkpoint)}>
        Save as snapshot…
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => restoreCheckpoint(checkpoint)}>
        Restore
      </DropdownMenuItem>
    </HistoryRow>
  );
};

const FileGroup = ({
  title,
  files,
  selected,
  setSelected,
  onShow,
}: {
  title: string;
  files: GitStatus["files"];
  /** The ticked files; null while there is nothing to commit with, and so no checkboxes. */
  selected: Set<string> | null;
  setSelected: Dispatch<SetStateAction<Set<string>>>;
  onShow: (path: string) => void;
}) => {
  const id = useId();
  if (files.length === 0) {
    return null;
  }
  const paths = files.map((f) => f.path);
  const ticked = selected ? groupTicked(paths, selected) : "none";
  const toggleAll = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const path of paths) {
        if (ticked === "all") {
          next.delete(path);
        } else {
          next.add(path);
        }
      }
      return next;
    });
  const shared = sharedFolder(paths);
  return (
    <section aria-labelledby={id} className={SECTION}>
      <GroupLabel
        id={id}
        lead={
          selected ? (
            <Checkbox
              aria-label={`Select all ${title.toLowerCase()}`}
              checked={ticked === "all"}
              className="z-10"
              indeterminate={ticked === "some"}
              onCheckedChange={toggleAll}
            />
          ) : null
        }
      >
        {title}
      </GroupLabel>
      <ul aria-labelledby={id} className={SECTION}>
        {files.map((f) => (
          <FileRow
            file={f}
            key={f.path}
            onShow={onShow}
            selected={selected ? selected.has(f.path) : null}
            setSelected={setSelected}
            shared={shared}
          />
        ))}
      </ul>
    </section>
  );
};

const FileRow = ({
  file,
  selected,
  setSelected,
  onShow,
  shared,
}: {
  file: GitStatus["files"][number];
  selected: boolean | null;
  setSelected: Dispatch<SetStateAction<Set<string>>>;
  onShow: (path: string) => void;
  /** The folder the group's files share, left off the row. */
  shared: string;
}) => {
  const { path } = file;
  const toggle = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  const parts = path.split("/");
  const name = parts.at(-1) ?? path;
  const folder = parts
    .slice(0, -1)
    .join("/")
    .slice(shared ? shared.length + 1 : 0);
  const word = statusWord(file.code);
  // A conflict stops the commit: a warning dot beside its word says it waits on the user.
  const conflict = word === "Conflict";
  return (
    <li className={cn(ROW, "pr-2")}>
      {selected === null ? null : (
        <Checkbox
          aria-label={`Select ${path}`}
          checked={selected}
          className="z-10"
          onCheckedChange={toggle}
        />
      )}
      {/* The row has room for part of the path; its tooltip has the whole of it. */}
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              className={cn(ROW_BUTTON, "items-baseline")}
              data-row-button
              onClick={() => onShow(path)}
              type="button"
            >
              <span className="min-w-0 truncate font-body-medium">{name}</span>
              {folder ? (
                // The folder gives way first; the name truncates only once it is gone.
                <span className="min-w-0 shrink-[999] truncate font-body-small text-muted-foreground">
                  {folder}
                </span>
              ) : null}
            </button>
          }
        />
        <TooltipContent className="wrap-anywhere">{path}</TooltipContent>
      </Tooltip>
      {word ? (
        <span
          className={cn(
            "flex shrink-0 items-center gap-1 font-body-small",
            conflict ? "text-foreground" : "text-muted-foreground"
          )}
        >
          {conflict ? (
            <span aria-hidden className="size-1.5 rounded-full bg-warning" />
          ) : null}
          {word}
        </span>
      ) : null}
    </li>
  );
};

/**
 * Added lines are raised in the foreground over the muted context; removed ones are deleting, in
 * the destructive red on its tint.
 */
const lineClass = (line: string) => {
  if (ADDED_RE.test(line)) {
    return "bg-accent text-foreground";
  }
  if (REMOVED_RE.test(line)) {
    return "bg-destructive/10 text-destructive";
  }
  return "text-muted-foreground";
};

/** Splits a diff into lines keyed by their character offset in the text. */
const diffLines = (diff: string) => {
  let offset = 0;
  return diff
    .replace(TRAILING_NEWLINE_RE, "")
    .split("\n")
    .map((text) => {
      const line = { offset, text };
      offset += text.length + 1;
      return line;
    });
};

/**
 * The diffs: one file's alone, under the title that names it; or all since a point, saying how
 * many changed, each under its path.
 */
const DiffView = ({
  diffs,
  since,
}: {
  diffs: readonly FileDiff[];
  since: Point | null;
}) => (
  <div className="flex flex-col gap-3 px-2 pb-3">
    {since ? (
      <p className="px-2 font-body-small text-muted-foreground">
        {changedSince(diffs.length, since)}
      </p>
    ) : null}
    {diffs.map((d) => (
      <div className="flex flex-col gap-1" key={d.path}>
        {since ? (
          <div className="wrap-anywhere px-2 font-body-small text-muted-foreground">
            {d.path}
          </div>
        ) : null}
        <pre className="overflow-auto rounded-lg bg-muted p-2 font-code">
          {diffLines(d.diff).map(({ offset, text: line }) => (
            <div className={lineClass(line)} key={offset}>
              {line || " "}
            </div>
          ))}
        </pre>
      </div>
    ))}
  </div>
);
