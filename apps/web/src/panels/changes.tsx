import type { GitStatus } from "@ultrapaint/contracts/git";
import { writesGit } from "@ultrapaint/contracts/settings";
import type {
  Checkpoint,
  FileDiff,
  Snapshot,
} from "@ultrapaint/contracts/snapshots";
import { cn } from "cn";
import {
  ArrowLeft,
  BookmarkPlus,
  GitBranch,
  GitCompareArrows,
  Plus,
  RefreshCw,
  Trash2,
  Undo2,
} from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { confirmDialog } from "../components/dialogs.tsx";
import { IconButton } from "../components/icon-button.tsx";
import { PanelEmpty } from "../components/panel.tsx";
import { SetupEmpty } from "../components/setup-dialog.tsx";
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
import { type Followed, follow } from "../state/server-data.ts";
import { useSnapshotView } from "../state/snapshot-view.ts";

const DIFF_MARKER_RE = /^[+\-@]/;

/** How long the files are left to settle before the panel asks again what changed. */
const FILES_SETTLE_MS = 250;

interface CheckpointDiff {
  diffs: readonly FileDiff[];
  id: string;
}

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
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState("");
  const checkpoints = useKept((s) => s.checkpoints);
  const snapshots = useKept((s) => s.snapshots);
  const [cpDiff, setCpDiff] = useState<CheckpointDiff | null>(null);
  const [busy, setBusy] = useState(false);
  const statusData = useRef<Followed<GitStatus, undefined> | null>(null);

  /** Git's status, with the files no longer changed unticked. */
  const takeStatus = useEffectEvent((s: GitStatus) => {
    setStatus(s);
    setSelected(
      (prev) =>
        new Set(
          Array.from(prev).filter((p) => s.files.some((f) => f.path === p))
        )
    );
  });

  // The history, read as the panel opens on a repository and followed from then on.
  useEffect(() => {
    if (configured && repoPath !== undefined) {
      useKept.getState().load();
    }
  }, [configured, repoPath]);

  // Git's status, followed while the panel is shown on a repository: read now, at every
  // connection open, on git's own news, and as files change. A git that fails or is not there
  // leaves the history to show.
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
          timer = setTimeout(
            () => gitStatus.read().catch(reportError),
            FILES_SETTLE_MS
          );
        },
        git: (s) => takeStatus(s),
      },
      read: () => api().request("git.status", undefined),
      whole: ["git"],
    });
    statusData.current = gitStatus;
    gitStatus.read().catch(reportError);
    return () => {
      clearTimeout(timer);
      gitStatus.stop();
      statusData.current = null;
    };
  }, [configured, repository]);

  const refresh = () => {
    statusData.current?.read().catch(reportError);
    useKept.getState().load();
  };

  const showDiff = async (path: string) => {
    try {
      const next = await api().request("git.diff", { path });
      setCpDiff(null);
      setDiff(next);
    } catch (error) {
      reportError(error);
    }
  };

  // A file asked for from elsewhere, before the panel was open or while it is.
  useRequest("diff", showDiff, configured);

  const commit = async () => {
    // Enter again while a commit is on its way is not a second commit.
    if (busy || !message.trim() || selected.size === 0) {
      return;
    }
    const sent = message;
    const paths = Array.from(selected);
    setBusy(true);
    try {
      await api().request("git.commit", { message: sent, paths });
      setMessage((current) => (current === sent ? "" : current));
      setSelected((current) => tickedAfterCommit(current, paths));
      setDiff(null);
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
  const closeDiff = () => {
    setDiff(null);
    setCpDiff(null);
  };

  if (!configured) {
    return <SetupEmpty />;
  }
  // Without a repository, a status read before is not this folder's.
  const shown = repository ? status : null;
  if (snapshots === null || checkpoints === null || (repository && !shown)) {
    return (
      <div className="flex h-full flex-col">
        <ChangesHeading onRefresh={refresh} />
        <PanelEmpty>Reading the history…</PanelEmpty>
      </div>
    );
  }

  const files = shown?.files ?? [];
  const design = files.filter((f) => f.design);
  const other = files.filter((f) => !f.design);
  const openDiffs = cpDiff?.diffs ?? (diff ? [diff] : null);
  // A file's diff is titled by its path; a snapshot's or a checkpoint's by the point it is from.
  const since =
    snapshots.find((x) => x.id === cpDiff?.id)?.name ??
    checkpoints.find((x) => x.id === cpDiff?.id)?.label;

  return (
    <div className="flex h-full flex-col">
      <ChangesHeading onRefresh={refresh} />
      <RepoStatus
        busy={busy}
        files={files.length}
        onInit={writes ? init : null}
        status={shown}
      />
      {shown && files.length > 0 ? (
        <>
          <div className="max-h-[45%] min-h-0 shrink-0 overflow-auto px-2">
            <FileGroup
              current={diff?.path}
              files={design}
              onShow={showDiff}
              selected={selected}
              setSelected={setSelected}
              title="Design files"
            />
            <FileGroup
              current={diff?.path}
              files={other}
              onShow={showDiff}
              selected={selected}
              setSelected={setSelected}
              title="Other files"
            />
          </div>
          {writes ? (
            <CommitBar
              busy={busy}
              message={message}
              onCommit={commit}
              onMessageChange={onMessageChange}
              onMessageKeyDown={onMessageKeyDown}
              ticked={selected.size}
            />
          ) : null}
        </>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col overflow-auto border-t">
        {openDiffs ? (
          <DiffPane
            diffs={openDiffs}
            onClose={closeDiff}
            title={diff ? diff.path : `Since ${since ?? "then"}`}
            whole={diff === null}
          />
        ) : (
          <>
            <Snapshots onShowDiff={setCpDiff} snapshots={snapshots} />
            <Checkpoints checkpoints={checkpoints} onShowDiff={setCpDiff} />
          </>
        )}
      </div>
    </div>
  );
};

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

/**
 * Where git stands: the branch and how many files changed; or, without a repository, that the
 * history is kept all the same, and the way to make one when writing to git is on.
 */
const RepoStatus = ({
  busy,
  files,
  onInit,
  status,
}: {
  busy: boolean;
  files: number;
  onInit: (() => void) | null;
  status: GitStatus | null;
}) =>
  status ? (
    <div className="flex shrink-0 items-center gap-1.5 px-3 pb-2 font-small text-muted-foreground">
      <GitBranch className="size-3.5 shrink-0" />
      <span className="min-w-0 truncate text-foreground">{status.branch}</span>
      <span className="ml-auto shrink-0">
        {files === 0
          ? "No changes"
          : `${plural(files, "file", "files")} changed`}
      </span>
    </div>
  ) : (
    <div className="flex shrink-0 flex-col items-start gap-2 px-3 pb-3">
      <p className="font-small text-muted-foreground">
        This folder is not a git repository. Snapshots and checkpoints still
        keep the designs’ history.
      </p>
      {onInit ? (
        <Button disabled={busy} onClick={onInit} size="sm" variant="outline">
          Make it a git repository
        </Button>
      ) : null}
    </div>
  );

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
}) => (
  <div className="flex shrink-0 gap-2 px-2 pt-2 pb-3">
    <Input
      aria-label="Commit message"
      onChange={onMessageChange}
      onKeyDown={onMessageKeyDown}
      placeholder="Commit message"
      value={message}
    />
    <Button
      disabled={busy || !message.trim() || ticked === 0}
      onClick={onCommit}
      title={
        ticked === 0
          ? "Tick the files to commit"
          : `Commit ${plural(ticked, "file", "files")}`
      }
    >
      Commit
    </Button>
  </div>
);

/** A diff in the panel's lower half, under a bar that names it and leads back to the history. */
const DiffPane = ({
  diffs,
  onClose,
  title,
  whole,
}: {
  diffs: readonly FileDiff[];
  onClose: () => void;
  title: string;
  /** Several files, each under its path; else the one file the title names. */
  whole: boolean;
}) => (
  <>
    <div className="flex h-10 shrink-0 items-center gap-1 pr-3 pl-1.5">
      <IconButton
        className="text-muted-foreground"
        onClick={onClose}
        tooltip="Close diff"
      >
        <ArrowLeft />
      </IconButton>
      <span className="min-w-0 truncate font-label" title={title}>
        {title}
      </span>
    </div>
    <DiffView diffs={diffs} paths={whole} />
  </>
);

/** The panel's title, and the read of git's status and the history again. */
const ChangesHeading = ({ onRefresh }: { onRefresh: () => void }) => (
  <div className="flex h-11 shrink-0 items-center gap-1 pr-2 pl-3">
    <h2 className="flex-1 font-heading-xsmall">Changes</h2>
    <IconButton
      className="text-muted-foreground"
      onClick={onRefresh}
      tooltip="Refresh"
    >
      <RefreshCw />
    </IconButton>
  </div>
);

/** A quiet label over a group of rows, with what can be done to the group at its end. */
const GroupLabel = ({
  action,
  children,
}: {
  action?: ReactNode;
  children: ReactNode;
}) => (
  <div className="flex h-9 shrink-0 items-center gap-1 pr-1 pl-2 font-small text-muted-foreground">
    <span className="min-w-0 flex-1 truncate">{children}</span>
    {action}
  </div>
);

/** A row of the history: its name first, its time after, its actions in its place on hover. */
const HISTORY_ROW =
  "group flex h-7 items-center gap-2 rounded-md pr-1 pl-2 transition-colors duration-100 hover:bg-accent/50 focus-within:bg-accent/50";

/**
 * Named points in the history of the designs, kept until deleted: opened to look at as they
 * were, compared with now, restored.
 */
const Snapshots = ({
  onShowDiff,
  snapshots,
}: {
  onShowDiff: (diff: CheckpointDiff) => void;
  snapshots: readonly Snapshot[];
}) => {
  const save = () => saveSnapshot();
  return (
    <div className="flex flex-col px-2 pt-1 pb-2">
      <GroupLabel
        action={
          snapshots.length > 0 ? (
            <IconButton
              className="text-muted-foreground"
              onClick={save}
              size="icon-sm"
              tooltip="Save snapshot"
            >
              <Plus />
            </IconButton>
          ) : null
        }
      >
        Snapshots
      </GroupLabel>
      {snapshots.length === 0 ? (
        <div className="flex flex-col items-start gap-2 px-2 pb-1">
          <p className="font-small text-muted-foreground">
            Keep the designs as they are under a name, to look at again or come
            back to.
          </p>
          <Button onClick={save} size="sm" variant="secondary">
            Save snapshot
          </Button>
        </div>
      ) : (
        snapshots.map((snapshot) => (
          <SnapshotRow
            key={snapshot.id}
            onShowDiff={onShowDiff}
            snapshot={snapshot}
          />
        ))
      )}
    </div>
  );
};

const dateFormat = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
});
const timeFormat = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});
/** The time of a checkpoint taken today, the day of an older one. */
const whenTaken = (at: number, now = new Date()) =>
  new Date(at).toDateString() === now.toDateString()
    ? timeFormat.format(at)
    : dateFormat.format(at);

const SnapshotRow = ({
  onShowDiff,
  snapshot,
}: {
  onShowDiff: (diff: CheckpointDiff) => void;
  snapshot: Snapshot;
}) => {
  const open = useSnapshotView((s) => s.view?.snapshot.id === snapshot.id);
  const { id } = snapshot;
  const compare = () =>
    api()
      .request("snapshots.diff", { id })
      .then((diffs) => onShowDiff({ diffs, id }))
      .catch(reportError);
  const remove = () => deleteSnapshot(snapshot);
  return (
    <div className={cn(HISTORY_ROW, open && "bg-accent hover:bg-accent")}>
      <button
        className="flex h-full min-w-0 flex-1 items-center gap-2 text-left outline-none focus-visible:underline"
        onClick={() => openSnapshot(snapshot)}
        title={`Open ${snapshot.name}, to look at the designs as they were`}
        type="button"
      >
        <span className="min-w-0 flex-1 truncate font-body">
          {snapshot.name}
        </span>
        <span className="shrink-0 font-small text-muted-foreground group-focus-within:hidden group-hover:hidden">
          {dateFormat.format(snapshot.at)}
        </span>
      </button>
      <span className="hidden shrink-0 items-center group-focus-within:flex group-hover:flex">
        <IconButton
          className="text-muted-foreground"
          onClick={compare}
          size="icon-sm"
          tooltip="Compare with now"
        >
          <GitCompareArrows />
        </IconButton>
        <IconButton
          className="text-muted-foreground"
          onClick={() => restoreSnapshot(snapshot)}
          size="icon-sm"
          tooltip="Restore"
        >
          <Undo2 />
        </IconButton>
        <IconButton
          className="text-muted-foreground"
          onClick={remove}
          size="icon-sm"
          tooltip="Delete"
        >
          <Trash2 />
        </IconButton>
      </span>
    </div>
  );
};

/** The designs as they were before each agent turn, the last ones kept. */
const Checkpoints = ({
  checkpoints,
  onShowDiff,
}: {
  checkpoints: readonly Checkpoint[];
  onShowDiff: (diff: CheckpointDiff) => void;
}) => (
  <div className="flex flex-col px-2 pb-3">
    <GroupLabel>Agent checkpoints</GroupLabel>
    {checkpoints.length === 0 ? (
      <p className="px-2 font-small text-muted-foreground">
        The designs are kept before each agent turn, to compare or go back to.
      </p>
    ) : (
      checkpoints.map((c) => (
        <CheckpointRow checkpoint={c} key={c.id} onShowDiff={onShowDiff} />
      ))
    )}
  </div>
);

const CheckpointRow = ({
  checkpoint,
  onShowDiff,
}: {
  checkpoint: Checkpoint;
  onShowDiff: (diff: CheckpointDiff) => void;
}) => {
  const keep = () => saveSnapshot(checkpoint);
  const { id } = checkpoint;
  const show = () =>
    api()
      .request("checkpoints.diff", { id })
      .then((diffs) => onShowDiff({ diffs, id }))
      .catch(reportError);
  const revert = async () => {
    const ok = await confirmDialog({
      confirmLabel: "Revert",
      description:
        "Design files are restored to their state at this checkpoint, and files added since are removed. It is one step: undo takes it back. Comments stay as they are.",
      destructive: true,
      title: "Revert to this checkpoint?",
    });
    if (ok) {
      api().request("checkpoints.revert", { id }).catch(reportError);
    }
  };
  return (
    <div className={HISTORY_ROW}>
      <button
        className="flex h-full min-w-0 flex-1 items-center gap-2 text-left outline-none focus-visible:underline"
        onClick={show}
        title="What changed since"
        type="button"
      >
        <span className="min-w-0 flex-1 truncate font-body">
          {checkpoint.label}
        </span>
        <span className="shrink-0 font-small text-muted-foreground tabular-nums group-focus-within:hidden group-hover:hidden">
          {whenTaken(checkpoint.at)}
        </span>
      </button>
      <span className="hidden shrink-0 items-center group-focus-within:flex group-hover:flex">
        <IconButton
          className="text-muted-foreground"
          onClick={keep}
          size="icon-sm"
          tooltip="Keep as snapshot"
        >
          <BookmarkPlus />
        </IconButton>
        <IconButton
          className="text-muted-foreground"
          onClick={revert}
          size="icon-sm"
          tooltip="Revert to it"
        >
          <Undo2 />
        </IconButton>
      </span>
    </div>
  );
};

const FileGroup = ({
  title,
  files,
  selected,
  setSelected,
  onShow,
  current,
}: {
  title: string;
  files: GitStatus["files"];
  selected: Set<string>;
  setSelected: Dispatch<SetStateAction<Set<string>>>;
  onShow: (path: string) => void;
  current?: string;
}) => {
  const all = files.every((f) => selected.has(f.path));
  const toggleAll = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const f of files) {
        if (all) {
          next.delete(f.path);
        } else {
          next.add(f.path);
        }
      }
      return next;
    });
  if (files.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-col">
      <Label className="flex h-8 items-center gap-2 px-2 font-normal font-small text-muted-foreground">
        <Checkbox checked={all} onCheckedChange={toggleAll} />
        <span className="flex-1">{title}</span>
        <span className="font-caption tabular-nums">{files.length}</span>
      </Label>
      {files.map((f) => (
        <FileRow
          current={current === f.path}
          file={f}
          key={f.path}
          onShow={onShow}
          selected={selected.has(f.path)}
          setSelected={setSelected}
        />
      ))}
    </div>
  );
};

/** What git says of a file, in a word: its status code's first letter. */
const STATUS_WORDS: Record<string, string> = {
  "?": "New",
  A: "Added",
  D: "Deleted",
  M: "Modified",
  R: "Renamed",
};

const FileRow = ({
  file,
  selected,
  setSelected,
  onShow,
  current,
}: {
  file: GitStatus["files"][number];
  selected: boolean;
  setSelected: Dispatch<SetStateAction<Set<string>>>;
  onShow: (path: string) => void;
  current: boolean;
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
  const show = () => onShow(path);
  const parts = path.split("/");
  const name = parts.at(-1) ?? path;
  const folder = parts.slice(0, -1).join("/");
  const code = file.code.trim() || "M";
  return (
    <div
      className={cn(
        "flex h-7 items-center gap-2 rounded-md px-2 transition-colors duration-100",
        current ? "bg-accent" : "hover:bg-accent/50"
      )}
    >
      <Checkbox
        aria-label={`Select ${path}`}
        checked={selected}
        onCheckedChange={toggle}
      />
      <button
        className="flex min-w-0 flex-1 items-baseline gap-1.5 text-left outline-none focus-visible:underline"
        onClick={show}
        title={path}
        type="button"
      >
        <span className="min-w-0 shrink-0 truncate font-body">{name}</span>
        <span className="min-w-0 truncate font-small text-muted-foreground">
          {folder}
        </span>
      </button>
      <span
        className="w-4 shrink-0 text-center font-code text-muted-foreground"
        title={STATUS_WORDS[code[0] ?? ""] ?? code}
      >
        {code}
      </span>
    </div>
  );
};

/** Splits a diff into lines keyed by their character offset in the text. */
const diffLines = (diff: string) => {
  let offset = 0;
  return diff.split("\n").map((text) => {
    const line = { offset, text };
    offset += text.length + 1;
    return line;
  });
};

/** The diffs, each under its file's path unless the panel's title already names the one file. */
const DiffView = ({
  diffs,
  paths,
}: {
  diffs: readonly FileDiff[];
  paths: boolean;
}) => (
  <div className="flex flex-col gap-3 px-2 pb-3">
    {diffs.length === 0 ? (
      <p className="px-1 font-small text-muted-foreground">
        No design file has changed since.
      </p>
    ) : null}
    {diffs.map((d) => (
      <div className="flex flex-col gap-1" key={d.path}>
        {paths ? (
          <div className="truncate px-1 font-small text-muted-foreground">
            {d.path}
          </div>
        ) : null}
        <pre className="overflow-auto rounded-lg bg-muted p-2 font-code">
          {diffLines(d.diff).map(({ offset, text: line }) => (
            <div
              className={cn(
                line.startsWith("+") &&
                  !line.startsWith("+++") &&
                  "bg-success/15 text-success",
                line.startsWith("-") &&
                  !line.startsWith("---") &&
                  "bg-destructive/15 text-destructive",
                line.startsWith("@@") && "text-muted-foreground",
                !DIFF_MARKER_RE.test(line) && "text-muted-foreground"
              )}
              key={offset}
            >
              {line || " "}
            </div>
          ))}
        </pre>
      </div>
    ))}
  </div>
);
