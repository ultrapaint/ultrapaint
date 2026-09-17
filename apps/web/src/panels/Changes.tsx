import type { Checkpoint, GitDiff, GitStatus } from "@ultrapaint/contracts";
import { GitCommitHorizontal, History, RefreshCw, Undo2 } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { confirmDialog } from "../components/dialogs.tsx";
import { IconButton } from "../components/icon-button.tsx";
import { PanelEmpty } from "../components/panel.tsx";
import { cn } from "../lib/utils.ts";
import { api } from "../state/connection.ts";
import { reportError, useProject } from "../state/project.ts";

export const Changes = () => {
  const configured = useProject((s) => s.info.configured);
  const [status, setStatus] = React.useState<GitStatus | null>(null);
  const [diff, setDiff] = React.useState<GitDiff | null>(null);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [message, setMessage] = React.useState("");
  const [checkpoints, setCheckpoints] = React.useState<readonly Checkpoint[]>([]);
  const [cpDiff, setCpDiff] = React.useState<{ id: string; diffs: readonly GitDiff[] } | null>(
    null,
  );
  const [busy, setBusy] = React.useState(false);

  const refresh = React.useCallback(async () => {
    try {
      const [s, cps] = await Promise.all([
        api().request("git.status", undefined),
        api().request("checkpoints.list", undefined),
      ]);
      setStatus(s);
      setCheckpoints(cps);
      setSelected(
        (prev) => new Set(Array.from(prev).filter((p) => s.files.some((f) => f.path === p))),
      );
    } catch (error) {
      reportError(error);
    }
  }, []);

  React.useEffect(() => {
    if (!configured) return;
    void refresh();
    const offGit = api().on("git", setStatus);
    const offFile = api().on("file.changed", () => void refresh());
    const onShow = (e: Event) => {
      const path = (e as CustomEvent<string>).detail;
      void showDiff(path);
    };
    window.addEventListener("ultrapaint:show-diff", onShow);
    return () => {
      offGit();
      offFile();
      window.removeEventListener("ultrapaint:show-diff", onShow);
    };
  }, [configured, refresh]);

  const showDiff = async (path: string) => {
    try {
      setCpDiff(null);
      setDiff(await api().request("git.diff", { path }));
    } catch (error) {
      reportError(error);
    }
  };

  const commit = async () => {
    if (!message.trim() || selected.size === 0) return;
    setBusy(true);
    try {
      await api().request("git.commit", { message, paths: Array.from(selected) });
      setMessage("");
      setSelected(new Set());
      setDiff(null);
      await refresh();
    } catch (error) {
      reportError(error);
    } finally {
      setBusy(false);
    }
  };

  if (!configured) return <PanelEmpty>Configure a repository first</PanelEmpty>;
  if (!status) return <PanelEmpty>Loading…</PanelEmpty>;

  const design = status.files.filter((f) => f.design);
  const other = status.files.filter((f) => !f.design);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b px-2 py-1.5 text-muted-foreground">
        <span className="flex-1 truncate">
          on <span className="text-foreground">{status.branch}</span> · {status.files.length}{" "}
          changed
        </span>
        <IconButton onClick={() => refresh()} tooltip="Refresh">
          <RefreshCw />
        </IconButton>
      </div>
      <div className="max-h-[45%] min-h-0 overflow-auto">
        <FileGroup
          title="Design files"
          files={design}
          selected={selected}
          setSelected={setSelected}
          onShow={showDiff}
          current={diff?.path}
        />
        <FileGroup
          title="Other files"
          files={other}
          selected={selected}
          setSelected={setSelected}
          onShow={showDiff}
          current={diff?.path}
        />
        {status.files.length === 0 && (
          <div className="p-3 text-muted-foreground">Working tree clean</div>
        )}
      </div>
      <div className="flex gap-1 border-y p-2">
        <Input
          placeholder="Commit message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && commit()}
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
        {cpDiff ? (
          <DiffView diffs={cpDiff.diffs} />
        ) : diff ? (
          <DiffView diffs={[diff]} />
        ) : (
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
              <div key={c.id} className="flex items-center gap-1 py-0.5">
                <Button
                  variant="ghost"
                  size="sm"
                  className="-ml-2 min-w-0 flex-1 justify-start font-normal text-muted-foreground"
                  onClick={() =>
                    api()
                      .request("checkpoints.diff", { id: c.id })
                      .then((diffs) => setCpDiff({ id: c.id, diffs }))
                      .catch(reportError)
                  }
                >
                  <span className="truncate">
                    {new Date(c.at).toLocaleTimeString()} · {c.label}
                  </span>
                </Button>
                <IconButton
                  size="icon-sm"
                  tooltip="Revert design files to this checkpoint"
                  onClick={async () => {
                    const ok = await confirmDialog({
                      title: "Revert to this checkpoint?",
                      description:
                        "Design files are restored to their state at this checkpoint. Files added since are removed.",
                      confirmLabel: "Revert",
                      destructive: true,
                    });
                    if (ok)
                      api()
                        .request("checkpoints.revert", { id: c.id })
                        .then(refresh)
                        .catch(reportError);
                  }}
                >
                  <Undo2 />
                </IconButton>
              </div>
            ))}
          </div>
        )}
      </div>
      {(diff || cpDiff) && (
        <div className="border-t p-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setDiff(null);
              setCpDiff(null);
            }}
          >
            Close diff
          </Button>
        </div>
      )}
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
  setSelected: React.Dispatch<React.SetStateAction<Set<string>>>;
  onShow: (path: string) => void;
  current?: string;
}) => {
  if (files.length === 0) return null;
  const all = files.every((f) => selected.has(f.path));
  return (
    <div>
      <Label className="gap-2 px-2 py-1 font-normal text-[10px] text-muted-foreground uppercase">
        <Checkbox
          checked={all}
          onCheckedChange={() =>
            setSelected((prev) => {
              const next = new Set(prev);
              for (const f of files) all ? next.delete(f.path) : next.add(f.path);
              return next;
            })
          }
        />
        {title} ({files.length})
      </Label>
      {files.map((f) => (
        <div
          key={f.path}
          className={cn(
            "flex h-6 items-center gap-2 px-2 text-[11px]",
            current === f.path
              ? "bg-brand/20 text-foreground"
              : "text-muted-foreground hover:bg-muted/50",
          )}
        >
          <Checkbox
            aria-label={`Select ${f.path}`}
            checked={selected.has(f.path)}
            onCheckedChange={() =>
              setSelected((prev) => {
                const next = new Set(prev);
                next.has(f.path) ? next.delete(f.path) : next.add(f.path);
                return next;
              })
            }
          />
          <button
            type="button"
            className="min-w-0 flex-1 truncate text-left"
            title={f.path}
            onClick={() => onShow(f.path)}
          >
            {f.path.split("/").slice(-2).join("/")}
          </button>
          <span className="font-mono text-[10px] text-muted-foreground">
            {f.code.trim() || "M"}
          </span>
        </div>
      ))}
    </div>
  );
};

const DiffView = ({ diffs }: { diffs: readonly GitDiff[] }) => (
  <div className="p-2">
    {diffs.map((d) => (
      <div key={d.path} className="mb-2">
        <div className="mb-1 truncate font-mono text-[10px] text-muted-foreground">{d.path}</div>
        <pre className="overflow-auto rounded-md bg-muted/50 p-1.5 font-mono text-[10px] leading-4">
          {d.diff.split("\n").map((line, i) => (
            <div
              key={`${i}-${line.slice(0, 10)}`}
              className={cn(
                line.startsWith("+") && !line.startsWith("+++") && "bg-success/15 text-success",
                line.startsWith("-") &&
                  !line.startsWith("---") &&
                  "bg-destructive/15 text-destructive",
                line.startsWith("@@") && "text-brand",
                !/^[+\-@]/.test(line) && "text-muted-foreground",
              )}
            >
              {line || " "}
            </div>
          ))}
        </pre>
      </div>
    ))}
  </div>
);
