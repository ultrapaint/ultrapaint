import type { GitStatus } from "@ultrapaint/contracts/git";
import { writesGit } from "@ultrapaint/contracts/settings";
import type {
  Checkpoint,
  FileDiff,
  Snapshot,
} from "@ultrapaint/contracts/snapshots";
import { cn } from "cn";
import { ArrowLeft, Ellipsis, Plus } from "lucide-react";
import {
  type ChangeEvent,
  type Dispatch,
  type KeyboardEvent,
  type ReactNode,
  type SetStateAction,
  useEffect,
  useEffectEvent,
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { IconButton } from "../components/icon-button.tsx";
import { SetupEmpty } from "../components/setup-dialog.tsx";
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

/** How long the files are left to settle before the panel asks again what changed. */
const FILES_SETTLE_MS = 250;

/** What the panel shows in place of its lists: one file's diff, or all since a point. */
type OpenDiff =
  | { diffs: readonly FileDiff[]; kind: "file"; title: string }
  | { diffs: readonly FileDiff[]; kind: "since"; title: string };

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

/** Why Commit can't be pressed yet, or null when it can. */
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

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

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
      setOpen({ diffs: [diff], kind: "file", title: diff.path });
    } catch (error) {
      reportError(error);
    }
  };

  // A file asked for from elsewhere, before the panel was open or while it is.
  useRequest("diff", showDiff, configured);

  const showSince = (name: string, diffs: readonly FileDiff[]) =>
    setOpen({ diffs, kind: "since", title: `Since ${name}` });

  const commit = async () => {
    // Enter again while a commit is on its way is not a second commit.
    if (busy || commitBlocked(selected.size, message) !== null) {
      return;
    }
    const sent = message;
    const paths = Array.from(selected);
    setBusy(true);
    try {
      await api().request("git.commit", { message: sent, paths });
      setMessage((current) => (current === sent ? "" : current));
      setSelected((current) => tickedAfterCommit(current, paths));
    } catch (error) {
      reportError(error);
    }
    setBusy(false);
  };

  const init = async () => {
    setBusy(true);
    try {
      await api().request("git.init", undefined);
    } catch (error) {
      reportError(error);
    }
    setBusy(false);
  };

  const onMessageChange = (e: ChangeEvent<HTMLInputElement>) =>
    setMessage(e.target.value);
  const onMessageKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      commit();
    }
  };

  if (!configured) {
    return <SetupEmpty />;
  }

  if (open) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex h-11 shrink-0 items-center gap-1 pr-3 pl-1.5">
          <IconButton
            className="text-muted-foreground"
            onClick={() => setOpen(null)}
            tooltip="Back"
          >
            <ArrowLeft />
          </IconButton>
          <h2 className="min-w-0 truncate font-heading-xsmall">{open.title}</h2>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          <DiffView diffs={open.diffs} paths={open.kind === "since"} />
        </div>
      </div>
    );
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
      <div className="flex h-11 shrink-0 items-center pr-2 pl-3">
        <h2 className="flex-1 font-heading-xsmall">Changes</h2>
      </div>
      {/* One scroller: the files, then the history, set apart by space alone. */}
      <div className="flex min-h-0 flex-1 flex-col gap-8 overflow-auto px-2 pb-3">
        {repository ? null : (
          <NoRepository busy={busy} onInit={writes ? init : null} />
        )}
        {repository && writes && files.length > 0 ? (
          <CommitBar
            busy={busy}
            message={message}
            onCommit={commit}
            onMessageChange={onMessageChange}
            onMessageKeyDown={onMessageKeyDown}
            ticked={selected.size}
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
        <Checkpoints
          checkpoints={checkpoints}
          failed={historyFailed}
          onRetry={retryHistory}
          onShowSince={showSince}
        />
      </div>
    </div>
  );
};

/** A section of the panel: its title, then its rows, 2px apart so their fills never touch. */
const SECTION = "flex flex-col gap-0.5";

/** Without a repository: that the history is kept all the same, and the way to make one. */
const NoRepository = ({
  busy,
  onInit,
}: {
  busy: boolean;
  onInit: (() => void) | null;
}) => (
  <div className="flex flex-col items-start gap-2 px-2 pt-1">
    <p className="font-small text-muted-foreground">
      This folder is not a git repository. Snapshots and checkpoints still keep
      the designs’ history.
    </p>
    {onInit ? (
      <Button disabled={busy} onClick={onInit} size="sm" variant="secondary">
        Make it a git repository
      </Button>
    ) : null}
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

/** The message and the commit of the ticked files: the one action the panel is for. */
const CommitBar = ({
  busy,
  message,
  onCommit,
  onMessageChange,
  onMessageKeyDown,
  ticked,
}: {
  busy: boolean;
  message: string;
  onCommit: () => void;
  onMessageChange: (e: ChangeEvent<HTMLInputElement>) => void;
  onMessageKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
  ticked: number;
}) => {
  const blocked = commitBlocked(ticked, message);
  return (
    <div className="flex flex-col gap-1.5 pt-1">
      <div className="flex gap-2">
        <Input
          aria-label="Commit message"
          onChange={onMessageChange}
          onKeyDown={onMessageKeyDown}
          placeholder="Commit message"
          value={message}
        />
        <Button disabled={busy || blocked !== null} onClick={onCommit}>
          Commit
        </Button>
      </div>
      {blocked && !busy ? (
        <p className="px-2 font-small text-muted-foreground">{blocked}</p>
      ) : null}
    </div>
  );
};

/** A section's title over its rows, with its count or what can be done to it at its end. */
const GroupLabel = ({
  action,
  children,
  lead,
}: {
  action?: ReactNode;
  children: ReactNode;
  /** Before the title, in the column the rows' checkboxes are in. */
  lead?: ReactNode;
}) => (
  <div className="flex h-8 shrink-0 items-center gap-2 pr-1 pl-2">
    {lead}
    <h3 className="min-w-0 flex-1 truncate font-heading-xsmall">{children}</h3>
    {action}
  </div>
);

/** An empty section's one row, in muted. */
const NoneRow = ({ children }: { children: ReactNode }) => (
  <p className="flex h-7 items-center px-2 font-small text-muted-foreground">
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
    <span className="truncate font-small text-muted-foreground">
      {children}
    </span>
    <Button onClick={onRetry} size="sm" variant="ghost">
      Try again
    </Button>
  </div>
);

const SKELETON_WIDTHS = ["w-3/5", "w-2/5", "w-1/2"] as const;

/** Rows in the shape of the ones on their way. */
const LoadingRows = () => (
  <div aria-label="Loading" className={SECTION} role="status">
    {SKELETON_WIDTHS.map((width) => (
      <div className="flex h-7 items-center px-2" key={width}>
        <span
          className={cn(
            "h-3 rounded-sm bg-muted motion-safe:animate-pulse",
            width
          )}
        />
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
  current?: boolean;
  name: string;
  onShow: () => void;
}) => (
  <div className={cn(ROW, "pr-1", current && "bg-accent hover:bg-accent")}>
    <button
      className={ROW_BUTTON}
      data-row-button
      onClick={onShow}
      type="button"
    >
      <span className="min-w-0 flex-1 truncate font-label">{name}</span>
      <span className="shrink-0 font-small text-muted-foreground tabular-nums">
        {whenTaken(at)}
      </span>
    </button>
    <RowMenu name={name}>{children}</RowMenu>
  </div>
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
  onShowSince: (name: string, diffs: readonly FileDiff[]) => void;
  snapshots: readonly Snapshot[] | null;
}) => (
  <section className={SECTION}>
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
    >
      Snapshots
    </GroupLabel>
    <HistoryRows
      failed={failed}
      items={snapshots}
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

/** A history list's rows: being read, unread, none yet, or the points. */
const HistoryRows = <T,>({
  failed,
  items,
  onRetry,
  row,
}: {
  failed: boolean;
  items: readonly T[] | null;
  onRetry: () => void;
  row: (item: T) => ReactNode;
}) => {
  if (items === null) {
    return failed ? (
      <Unread onRetry={onRetry}>The history didn’t load</Unread>
    ) : (
      <LoadingRows />
    );
  }
  return items.length === 0 ? <NoneRow>None yet</NoneRow> : items.map(row);
};

const SnapshotRow = ({
  onShowSince,
  snapshot,
}: {
  onShowSince: (name: string, diffs: readonly FileDiff[]) => void;
  snapshot: Snapshot;
}) => {
  const open = useSnapshotView((s) => s.view?.snapshot.id === snapshot.id);
  const show = () =>
    api()
      .request("snapshots.diff", { id: snapshot.id })
      .then((diffs) => onShowSince(snapshot.name, diffs))
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
  onShowSince: (name: string, diffs: readonly FileDiff[]) => void;
}) => (
  <section className={SECTION}>
    <GroupLabel>Agent checkpoints</GroupLabel>
    <HistoryRows
      failed={failed}
      items={checkpoints}
      onRetry={onRetry}
      row={(c) => (
        <CheckpointRow checkpoint={c} key={c.id} onShowSince={onShowSince} />
      )}
    />
  </section>
);

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
  onShowSince: (name: string, diffs: readonly FileDiff[]) => void;
}) => {
  const show = () =>
    api()
      .request("checkpoints.diff", { id: checkpoint.id })
      .then((diffs) => onShowSince(checkpoint.label, diffs))
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
    <section className={SECTION}>
      <GroupLabel
        action={
          <span className="pr-1 font-caption text-muted-foreground tabular-nums">
            {files.length}
          </span>
        }
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
  const deleted = word === "Deleted";
  return (
    <div className={cn(ROW, "pr-2")}>
      {selected === null ? null : (
        <Checkbox
          aria-label={`Select ${path}`}
          checked={selected}
          className="z-10"
          onCheckedChange={toggle}
        />
      )}
      <button
        className={cn(ROW_BUTTON, "items-baseline gap-1.5")}
        data-row-button
        onClick={() => onShow(path)}
        type="button"
      >
        <span
          className={cn(
            "min-w-0 truncate font-label",
            deleted && "text-muted-foreground line-through"
          )}
        >
          {name}
        </span>
        {folder ? (
          // The folder gives way first; the name truncates only once it is gone.
          <span className="min-w-0 shrink-[999] truncate font-small text-muted-foreground">
            {folder}
          </span>
        ) : null}
      </button>
      {word ? (
        <span className="shrink-0 font-small text-muted-foreground">
          {word}
        </span>
      ) : null}
    </div>
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
 * The diffs, each under its file's path unless the panel's title already names the one file.
 */
const DiffView = ({
  diffs,
  paths,
}: {
  diffs: readonly FileDiff[];
  paths: boolean;
}) => (
  <div className="flex flex-col gap-3 px-2 pb-3">
    {diffs.length === 0 ? (
      <p className="px-2 font-small text-muted-foreground">
        No design file has changed since.
      </p>
    ) : null}
    {diffs.map((d) => (
      <div className="flex flex-col gap-1" key={d.path}>
        {paths ? (
          <div className="truncate px-2 font-small text-muted-foreground">
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
