import type {
  Checkpoint,
  GitDiff,
  GitStatus,
} from "@ultrapaint/contracts/git";
import type { Snapshot } from "@ultrapaint/contracts/snapshots";
import { cn } from "cn";
import {
  Bookmark,
  BookmarkPlus,
  Eye,
  GitCommitHorizontal,
  GitCompareArrows,
  History,
  RefreshCw,
  Trash2,
  Undo2,
} from "lucide-react";
import {
  type ChangeEvent,
  type Dispatch,
  type KeyboardEvent,
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
import { takeDiffRequest, useDiffRequest } from "../state/diff-request.ts";
import { reportError, useProject } from "../state/project.ts";
import { useSnapshotView } from "../state/snapshot-view.ts";

const DIFF_MARKER_RE = /^[+\-@]/;

/** How long the files are left to settle before the panel asks again what changed. */
const FILES_SETTLE_MS = 250;

interface CheckpointDiff {
  diffs: readonly GitDiff[];
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
  // Looked at: the rail stops saying an agent changed something.
  useEffect(() => {
    useAgents.getState().clearChanged();
  }, []);
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [diff, setDiff] = useState<GitDiff | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState("");
  const [checkpoints, setCheckpoints] = useState<readonly Checkpoint[]>([]);
  const [snapshots, setSnapshots] = useState<readonly Snapshot[] | null>(null);
  const [cpDiff, setCpDiff] = useState<CheckpointDiff | null>(null);
  const [busy, setBusy] = useState(false);

  /**
   * Counts the refreshes, and the statuses taken in from them or from the server: an answer that
   * arrives after a later one is older news, and is dropped.
   */
  const asked = useRef({ refresh: 0, status: 0 });
  const takeStatus = (s: GitStatus) => {
    asked.current.status += 1;
    setStatus(s);
  };

  /** Git's status, apart: a git that fails or is not there leaves the history to show. */
  const refreshStatus = async (ticket: { refresh: number; status: number }) => {
    if (!repository) {
      setStatus(null);
      return;
    }
    try {
      const s = await api().request("git.status", undefined);
      if (
        ticket.refresh !== asked.current.refresh ||
        ticket.status !== asked.current.status
      ) {
        return;
      }
      takeStatus(s);
      setSelected(
        (prev) =>
          new Set(
            Array.from(prev).filter((p) => s.files.some((f) => f.path === p))
          )
      );
    } catch (error) {
      reportError(error);
    }
  };

  const refresh = async () => {
    asked.current.refresh += 1;
    const ticket = { ...asked.current };
    const history = async () => {
      try {
        const [cps, sns] = await Promise.all([
          api().request("checkpoints.list", undefined),
          api().request("snapshots.list", undefined),
        ]);
        if (ticket.refresh !== asked.current.refresh) {
          return;
        }
        setCheckpoints(cps);
        setSnapshots(sns);
      } catch (error) {
        reportError(error);
      }
    };
    await Promise.all([history(), refreshStatus(ticket)]);
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

  const onFilesChanged = useEffectEvent(refresh);
  const onStatus = useEffectEvent(takeStatus);
  const onShowDiffRequest = useEffectEvent(showDiff);

  // A file asked for from elsewhere, before the panel was open or while it is.
  useEffect(() => {
    if (!configured) {
      return;
    }
    const take = async ({ path }: { path: string | null }) => {
      if (path !== null) {
        takeDiffRequest();
        await onShowDiffRequest(path);
      }
    };
    take(useDiffRequest.getState());
    return useDiffRequest.subscribe(take);
  }, [configured]);

  useEffect(() => {
    if (!configured) {
      return;
    }
    const loadInitial = async () => {
      await onFilesChanged();
    };
    loadInitial();
    // Git's own news only where there is a repository to have any.
    const offGit = repository ? api().on("git", onStatus) : () => undefined;
    // A save, a checkout or an agent changes many files at once: one refresh for all of them.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const offFile = api().on("file.changed", () => {
      clearTimeout(timer);
      timer = setTimeout(onFilesChanged, FILES_SETTLE_MS);
    });
    return () => {
      clearTimeout(timer);
      offGit();
      offFile();
    };
  }, [configured, repository]);

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
      await refresh();
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
  if (snapshots === null || (repository && !status)) {
    return <PanelEmpty>Loading…</PanelEmpty>;
  }

  const files = status?.files ?? [];
  const design = files.filter((f) => f.design);
  const other = files.filter((f) => !f.design);
  const openDiffs = cpDiff?.diffs ?? (diff ? [diff] : null);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b px-2 py-1.5 text-muted-foreground">
        <span className="flex-1 truncate">
          {status ? (
            <>
              on <span className="text-foreground">{status.branch}</span> ·{" "}
              {files.length} changed
            </>
          ) : (
            "No git repository here"
          )}
        </span>
        <IconButton onClick={refresh} tooltip="Refresh">
          <RefreshCw />
        </IconButton>
      </div>
      {status ? (
        <>
          <div className="max-h-[45%] min-h-0 overflow-auto">
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
            {files.length === 0 && (
              <div className="p-3 text-muted-foreground">
                Working tree clean
              </div>
            )}
          </div>
          <div className="flex gap-1 border-y p-2">
            <Input
              onChange={onMessageChange}
              onKeyDown={onMessageKeyDown}
              placeholder="Commit message"
              value={message}
            />
            <Button
              disabled={busy || !message.trim() || selected.size === 0}
              onClick={commit}
              title="Commit selected files"
            >
              <GitCommitHorizontal data-icon="inline-start" /> {selected.size}
            </Button>
          </div>
        </>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto">
        {openDiffs ? (
          <DiffView diffs={openDiffs} />
        ) : (
          <>
            <Snapshots
              onChange={refresh}
              onShowDiff={setCpDiff}
              snapshots={snapshots}
            />
            <Checkpoints
              checkpoints={checkpoints}
              onKeep={refresh}
              onRevert={refresh}
              onShowDiff={setCpDiff}
            />
          </>
        )}
      </div>
      {diff || cpDiff ? (
        <div className="border-t p-1">
          <Button onClick={closeDiff} size="sm" variant="ghost">
            Close diff
          </Button>
        </div>
      ) : null}
    </div>
  );
};

/**
 * Named points in the history of the designs, kept until deleted: opened to look at as they
 * were, compared with now, restored.
 */
const Snapshots = ({
  onChange,
  onShowDiff,
  snapshots,
}: {
  onChange: () => Promise<void>;
  onShowDiff: (diff: CheckpointDiff) => void;
  snapshots: readonly Snapshot[];
}) => {
  const save = async () => {
    if (await saveSnapshot()) {
      await onChange();
    }
  };
  return (
    <div className="border-b p-2">
      <div className="mb-1 flex items-center gap-1 font-heading-xsmall text-muted-foreground uppercase">
        <Bookmark className="size-3" />
        <span className="flex-1">Snapshots</span>
        <IconButton onClick={save} size="icon-xs" tooltip="Save a snapshot">
          <BookmarkPlus className="size-3" />
        </IconButton>
      </div>
      {snapshots.length === 0 && (
        <div className="text-muted-foreground">
          None yet. Save one to keep the designs as they are under a name, to
          come back to.
        </div>
      )}
      {snapshots.map((snapshot) => (
        <SnapshotRow
          key={snapshot.id}
          onChange={onChange}
          onShowDiff={onShowDiff}
          snapshot={snapshot}
        />
      ))}
    </div>
  );
};

const SnapshotRow = ({
  onChange,
  onShowDiff,
  snapshot,
}: {
  onChange: () => Promise<void>;
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
  const remove = async () => {
    if (await deleteSnapshot(snapshot)) {
      await onChange();
    }
  };
  return (
    <div className="group flex items-center gap-0.5 py-0.5">
      <Button
        className={cn(
          "-ml-2 min-w-0 flex-1 justify-start font-normal",
          open ? "text-foreground" : "text-muted-foreground"
        )}
        onClick={() => openSnapshot(snapshot)}
        size="sm"
        title="Open it, to look at the designs as they were"
        variant="ghost"
      >
        <span className="truncate">
          {snapshot.name}
          <span className="text-muted-foreground">
            {" "}
            · {new Date(snapshot.at).toLocaleDateString()}
          </span>
        </span>
      </Button>
      <IconButton
        onClick={() => openSnapshot(snapshot)}
        size="icon-sm"
        tooltip="Open to look at"
      >
        <Eye />
      </IconButton>
      <IconButton onClick={compare} size="icon-sm" tooltip="What changed since">
        <GitCompareArrows />
      </IconButton>
      <IconButton
        onClick={() => restoreSnapshot(snapshot).then(onChange)}
        size="icon-sm"
        tooltip="Restore the designs to it"
      >
        <Undo2 />
      </IconButton>
      <IconButton onClick={remove} size="icon-sm" tooltip="Delete the snapshot">
        <Trash2 />
      </IconButton>
    </div>
  );
};

const Checkpoints = ({
  checkpoints,
  onKeep,
  onShowDiff,
  onRevert,
}: {
  checkpoints: readonly Checkpoint[];
  onKeep: () => Promise<void>;
  onShowDiff: (diff: CheckpointDiff) => void;
  onRevert: () => Promise<void>;
}) => (
  <div className="p-2">
    <div className="mb-1 flex items-center gap-1 font-heading-xsmall text-muted-foreground uppercase">
      <History className="size-3" /> Agent turn checkpoints
    </div>
    {checkpoints.length === 0 && (
      <div className="text-muted-foreground">
        No checkpoints yet. One is taken before each agent turn.
      </div>
    )}
    {checkpoints.map((c) => (
      <CheckpointRow
        checkpoint={c}
        key={c.id}
        onKeep={onKeep}
        onRevert={onRevert}
        onShowDiff={onShowDiff}
      />
    ))}
  </div>
);

const CheckpointRow = ({
  checkpoint,
  onKeep,
  onShowDiff,
  onRevert,
}: {
  checkpoint: Checkpoint;
  onKeep: () => Promise<void>;
  onShowDiff: (diff: CheckpointDiff) => void;
  onRevert: () => Promise<void>;
}) => {
  const keep = async () => {
    if (await saveSnapshot(checkpoint)) {
      await onKeep();
    }
  };
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
        "Design files are restored to their state at this checkpoint. Files added since are removed.",
      destructive: true,
      title: "Revert to this checkpoint?",
    });
    if (ok) {
      api()
        .request("checkpoints.revert", { id })
        .then(onRevert)
        .catch(reportError);
    }
  };
  return (
    <div className="flex items-center gap-1 py-0.5">
      <Button
        className="-ml-2 min-w-0 flex-1 justify-start font-normal text-muted-foreground"
        onClick={show}
        size="sm"
        variant="ghost"
      >
        <span className="truncate">
          {new Date(checkpoint.at).toLocaleTimeString()} · {checkpoint.label}
        </span>
      </Button>
      <IconButton
        onClick={keep}
        size="icon-sm"
        tooltip="Keep as a snapshot, under a name"
      >
        <BookmarkPlus />
      </IconButton>
      <IconButton
        onClick={revert}
        size="icon-sm"
        tooltip="Revert design files to this checkpoint"
      >
        <Undo2 />
      </IconButton>
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
    <div>
      <Label className="gap-2 px-2 py-1 font-heading-xsmall text-muted-foreground uppercase">
        <Checkbox checked={all} onCheckedChange={toggleAll} />
        {title} ({files.length})
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
  return (
    <div
      className={cn(
        "flex h-6 items-center gap-2 px-2 font-body",
        current
          ? "bg-brand/20 text-foreground"
          : "text-muted-foreground hover:bg-muted/50"
      )}
    >
      <Checkbox
        aria-label={`Select ${path}`}
        checked={selected}
        onCheckedChange={toggle}
      />
      <button
        className="min-w-0 flex-1 truncate text-left"
        onClick={show}
        title={path}
        type="button"
      >
        {path.split("/").slice(-2).join("/")}
      </button>
      <span className="font-code text-muted-foreground">
        {file.code.trim() || "M"}
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

const DiffView = ({ diffs }: { diffs: readonly GitDiff[] }) => (
  <div className="p-2">
    {diffs.map((d) => (
      <div className="mb-2" key={d.path}>
        <div className="mb-1 truncate font-code text-muted-foreground">
          {d.path}
        </div>
        <pre className="overflow-auto rounded-md bg-muted/50 p-1.5 font-code leading-4">
          {diffLines(d.diff).map(({ offset, text: line }) => (
            <div
              className={cn(
                line.startsWith("+") &&
                  !line.startsWith("+++") &&
                  "bg-success/15 text-success",
                line.startsWith("-") &&
                  !line.startsWith("---") &&
                  "bg-destructive/15 text-destructive",
                line.startsWith("@@") && "text-brand",
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
