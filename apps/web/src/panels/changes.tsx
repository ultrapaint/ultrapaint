import type {
  Checkpoint,
  GitDiff,
  GitStatus,
} from "@ultrapaint/contracts/git";
import { cn } from "cn";
import { GitCommitHorizontal, History, RefreshCw, Undo2 } from "lucide-react";
import {
  type ChangeEvent,
  type Dispatch,
  type KeyboardEvent,
  type SetStateAction,
  useCallback,
  useEffect,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { confirmDialog } from "../components/dialogs.tsx";
import { IconButton } from "../components/icon-button.tsx";
import { PanelEmpty } from "../components/panel.tsx";
import { api } from "../state/connection.ts";
import { reportError, useProject } from "../state/project.ts";

const DIFF_MARKER_RE = /^[+\-@]/;

interface CheckpointDiff {
  diffs: readonly GitDiff[];
  id: string;
}

export const Changes = () => {
  const configured = useProject((s) => s.info.configured);
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [diff, setDiff] = useState<GitDiff | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState("");
  const [checkpoints, setCheckpoints] = useState<readonly Checkpoint[]>([]);
  const [cpDiff, setCpDiff] = useState<CheckpointDiff | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [s, cps] = await Promise.all([
        api().request("git.status", undefined),
        api().request("checkpoints.list", undefined),
      ]);
      setStatus(s);
      setCheckpoints(cps);
      setSelected(
        (prev) =>
          new Set(
            Array.from(prev).filter((p) => s.files.some((f) => f.path === p))
          )
      );
    } catch (error) {
      reportError(error);
    }
  }, []);

  const showDiff = useCallback(async (path: string) => {
    try {
      setCpDiff(null);
      setDiff(await api().request("git.diff", { path }));
    } catch (error) {
      reportError(error);
    }
  }, []);

  useEffect(() => {
    if (!configured) {
      return;
    }
    refresh();
    const offGit = api().on("git", setStatus);
    const offFile = api().on("file.changed", () => {
      refresh();
    });
    const onShow = (e: Event) => {
      const path = (e as CustomEvent<string>).detail;
      showDiff(path);
    };
    window.addEventListener("ultrapaint:show-diff", onShow);
    return () => {
      offGit();
      offFile();
      window.removeEventListener("ultrapaint:show-diff", onShow);
    };
  }, [configured, refresh, showDiff]);

  const commit = useCallback(async () => {
    if (!message.trim() || selected.size === 0) {
      return;
    }
    setBusy(true);
    try {
      await api().request("git.commit", {
        message,
        paths: Array.from(selected),
      });
      setMessage("");
      setSelected(new Set());
      setDiff(null);
      await refresh();
    } catch (error) {
      reportError(error);
    } finally {
      setBusy(false);
    }
  }, [message, refresh, selected]);

  const onMessageChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => setMessage(e.target.value),
    []
  );
  const onMessageKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        commit();
      }
    },
    [commit]
  );
  const closeDiff = useCallback(() => {
    setDiff(null);
    setCpDiff(null);
  }, []);

  if (!configured) {
    return <PanelEmpty>Configure a repository first</PanelEmpty>;
  }
  if (!status) {
    return <PanelEmpty>Loading…</PanelEmpty>;
  }

  const design = status.files.filter((f) => f.design);
  const other = status.files.filter((f) => !f.design);
  const openDiffs = cpDiff?.diffs ?? (diff ? [diff] : null);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b px-2 py-1.5 text-muted-foreground">
        <span className="flex-1 truncate">
          on <span className="text-foreground">{status.branch}</span> ·{" "}
          {status.files.length} changed
        </span>
        <IconButton onClick={refresh} tooltip="Refresh">
          <RefreshCw />
        </IconButton>
      </div>
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
        {status.files.length === 0 && (
          <div className="p-3 text-muted-foreground">Working tree clean</div>
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
      <div className="min-h-0 flex-1 overflow-auto">
        {openDiffs ? (
          <DiffView diffs={openDiffs} />
        ) : (
          <Checkpoints
            checkpoints={checkpoints}
            onRevert={refresh}
            onShowDiff={setCpDiff}
          />
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

const Checkpoints = ({
  checkpoints,
  onShowDiff,
  onRevert,
}: {
  checkpoints: readonly Checkpoint[];
  onShowDiff: (diff: CheckpointDiff) => void;
  onRevert: () => Promise<void>;
}) => (
  <div className="p-2">
    <div className="mb-1 flex items-center gap-1 text-[10px] text-muted-foreground uppercase">
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
        onRevert={onRevert}
        onShowDiff={onShowDiff}
      />
    ))}
  </div>
);

const CheckpointRow = ({
  checkpoint,
  onShowDiff,
  onRevert,
}: {
  checkpoint: Checkpoint;
  onShowDiff: (diff: CheckpointDiff) => void;
  onRevert: () => Promise<void>;
}) => {
  const { id } = checkpoint;
  const show = useCallback(
    () =>
      api()
        .request("checkpoints.diff", { id })
        .then((diffs) => onShowDiff({ diffs, id }))
        .catch(reportError),
    [id, onShowDiff]
  );
  const revert = useCallback(async () => {
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
  }, [id, onRevert]);
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
  const toggleAll = useCallback(
    () =>
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
      }),
    [all, files, setSelected]
  );
  if (files.length === 0) {
    return null;
  }
  return (
    <div>
      <Label className="gap-2 px-2 py-1 font-normal text-[10px] text-muted-foreground uppercase">
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
  const toggle = useCallback(
    () =>
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(path)) {
          next.delete(path);
        } else {
          next.add(path);
        }
        return next;
      }),
    [path, setSelected]
  );
  const show = useCallback(() => onShow(path), [onShow, path]);
  return (
    <div
      className={cn(
        "flex h-6 items-center gap-2 px-2 text-[11px]",
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
      <span className="font-mono text-[10px] text-muted-foreground">
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
        <div className="mb-1 truncate font-mono text-[10px] text-muted-foreground">
          {d.path}
        </div>
        <pre className="overflow-auto rounded-md bg-muted/50 p-1.5 font-mono text-[10px] leading-4">
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
