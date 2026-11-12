/**
 * The Changes panel (ADR 0087): the designs' history, Ultrapaint's own, and, only while the
 * folder is a git repository, a Git tab with what git sees changed and the commit the person
 * makes. Without a repository nothing of git is shown.
 */
import type { GitStatus } from "@ultrapaint/contracts/git";
import type { FileDiff } from "@ultrapaint/contracts/snapshots";
import { ArrowLeft } from "lucide-react";
import {
  type KeyboardEvent,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/cn";
import { IconButton } from "../components/icon-button.tsx";
import { NoFolder } from "../components/no-folder.tsx";
import { Segmented } from "../components/segmented.tsx";
import { useAgents } from "../state/agents.ts";
import { api } from "../state/connection.ts";
import { useHistory } from "../state/history.ts";
import { useRequest } from "../state/panels.ts";
import { useProject } from "../state/project.ts";
import { follow } from "../state/server-data.ts";
import { BAR, GitTab, Unread } from "./changes-git.tsx";
import { HistoryTab } from "./changes-history.tsx";

/** Where the lines that name a diff's files end: its `+++ b/…`, or git's first range after it. */
const FILES_NAMED_RE = /^(\+\+\+ |@@)/;
/** A line among a file's changes: added, removed, context, a range, or git's note on the last. */
const CHANGE_LINE_RE = /^[-+ @\\]/;
/** A line of a file's changes that git marks in its first column: added, removed or context. */
const MARKED_LINE_RE = /^[-+ ]/;
const TRAILING_NEWLINE_RE = /\n$/;

/** How long the files are left to settle before the panel asks again what changed. */
const FILES_SETTLE_MS = 250;

/** What the panel can show in place of its lists, and how it is read: one file's git diff. */
interface DiffTarget {
  readonly path: string;
  readonly read: () => Promise<readonly FileDiff[]>;
}

/** A diff shown, from the moment it is asked for: its lines once read, or that they weren't. */
type OpenDiff = DiffTarget & {
  diffs: readonly FileDiff[] | null;
  failed: boolean;
};

/** The history, read: one that cannot be read says so where it would be, with Try again. */
const readHistory = () => useHistory.getState().load();

/** The panel's two tabs, while the folder is a repository. */
type Tab = "history" | "git";

export const Changes = () => {
  const configured = useProject((s) => s.info.configured);
  const repository = useProject((s) => s.info.gitRepository === true);
  // Looked at: the rail stops saying an agent changed something.
  useEffect(() => {
    useAgents.getState().clearChanged();
  }, []);
  const repoPath = useProject((s) => s.info.repoPath);
  const [tab, setTab] = useState<Tab>("history");
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [gitFailed, setGitFailed] = useState(false);
  const [open, setOpen] = useState<OpenDiff | null>(null);
  const readGit = useRef<(() => void) | null>(null);

  const takeStatus = useEffectEvent((s: GitStatus) => {
    setStatus(s);
    setGitFailed(false);
  });

  // The history, read as the panel opens on a project and followed from then on.
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

  /** Shows a diff at once, read as it shows; what lands for one no longer shown is dropped. */
  const showDiff = (target: DiffTarget) => {
    setOpen({ ...target, diffs: null, failed: false });
    const landed = (diffs: readonly FileDiff[] | null) =>
      setOpen((now) =>
        now?.read === target.read
          ? { ...now, diffs, failed: diffs === null }
          : now
      );
    target.read().then(landed, () => landed(null));
  };
  const showFile = (path: string) =>
    showDiff({
      path,
      read: async () => [await api().request("git.diff", { path })],
    });

  // A file asked for from elsewhere, before the panel was open or while it is: the Git tab's.
  useRequest(
    "diff",
    (path: string) => {
      setTab("git");
      showFile(path);
    },
    configured
  );
  // Its rail item clicked again: back to the lists.
  useRequest("back", () => setOpen(null), configured);

  if (!configured) {
    return <NoFolder />;
  }

  if (open) {
    return (
      <OpenDiffView
        onBack={() => setOpen(null)}
        onRetry={() => showDiff(open)}
        open={open}
      />
    );
  }

  // Without a repository, a status read before is not this folder's.
  const shown = repository ? status : null;
  const changed = shown?.files.filter((f) => f.design).length ?? 0;
  const retryGit = () => {
    setGitFailed(false);
    readGit.current?.();
  };
  const onGit = repository && tab === "git";

  return (
    <div className="flex h-full flex-col">
      {/* Its title starts where its rows' words do. */}
      <div className="flex h-11 shrink-0 items-center pr-2 pl-4">
        <h2 className="flex-1 font-heading-xsmall">Changes</h2>
      </div>
      {repository ? (
        <div className="shrink-0 px-2 pb-2">
          <Segmented
            aria-label="Changes"
            onChange={setTab}
            options={[
              { label: "History", value: "history" },
              {
                label: (
                  <span className="flex items-center gap-1.5">
                    Git
                    {changed > 0 ? (
                      <span className="font-body-small-medium text-muted-foreground">
                        {changed}
                      </span>
                    ) : null}
                  </span>
                ),
                value: "git",
              },
            ]}
            value={tab}
          />
        </div>
      ) : null}
      {onGit ? (
        <GitTab
          failed={gitFailed}
          onRetry={retryGit}
          onShowFile={showFile}
          status={shown}
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-auto px-2 pt-1 pb-3">
          <HistoryTab onRetry={readHistory} />
        </div>
      )}
    </div>
  );
};

/**
 * One file's diff in place of the lists, with the way back to them: Back,
 * or Escape inside the view. It opens at once, its lines drawn as they load, and says in place
 * when they didn't, with Try again. It takes the focus the row it was opened from took with it.
 */
const OpenDiffView = ({
  onBack,
  onRetry,
  open,
}: {
  onBack: () => void;
  onRetry: () => void;
  open: OpenDiff;
}) => {
  const view = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (document.activeElement === document.body) {
      view.current?.focus({ preventScroll: true });
    }
  }, []);
  // An Escape something inside took (a tooltip put away) is not Back.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape" && !e.defaultPrevented) {
      e.preventDefault();
      e.stopPropagation();
      onBack();
    }
  };
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/noNoninteractiveElementInteractions: Escape is a shortcut for Back, the view's own button.
    <div
      className="flex h-full flex-col outline-none"
      onKeyDown={onKeyDown}
      ref={view}
      tabIndex={-1}
    >
      {/* A long path or name wraps: the title is the only place it is read in full. */}
      <div className="flex min-h-11 shrink-0 items-center gap-1 py-2 pr-3 pl-2">
        <IconButton
          className="shrink-0 text-muted-foreground"
          onClick={onBack}
          tooltip="Back"
        >
          <ArrowLeft />
        </IconButton>
        <h2 className="wrap-anywhere min-w-0 font-heading-xsmall">
          {open.path}
        </h2>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {open.diffs ? (
          <DiffView diffs={open.diffs} />
        ) : (
          <div className="px-2 pb-3">
            {open.failed ? (
              <Unread onRetry={onRetry}>The changes didn’t load</Unread>
            ) : (
              <LoadingDiff />
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const DIFF_SKELETON_WIDTHS = ["w-2/5", "w-4/5", "w-3/5", "w-3/4", "w-1/2"];

/** A diff's lines on their way: bars on its block, one per line, as tall as a line. */
const LoadingDiff = () => (
  <div aria-label="Loading" className="rounded-lg bg-muted p-2" role="status">
    {DIFF_SKELETON_WIDTHS.map((width) => (
      <div className="flex h-5 items-center" key={width}>
        <span className={cn(BAR, "block", width)} />
      </div>
    ))}
  </div>
);

/** What a line of a diff is: what is drawn as context includes the lines that name the files. */
type LineKind = "added" | "removed" | "context";

/**
 * Added lines are raised in the foreground over the muted context; removed ones are deleting, in
 * the destructive red on its tint, the red taken a fifth of the way to the foreground so the
 * code's small text reads at 4.5:1 on the tint in both themes (the red alone is about 4.1:1).
 */
const LINE_CLASS: Record<LineKind, string> = {
  added: "bg-accent text-foreground",
  context: "text-muted-foreground",
  removed:
    "bg-destructive/10 text-[color-mix(in_oklab,var(--color-destructive)_80%,var(--color-foreground))]",
};

const changeKind = (text: string): LineKind => {
  if (text.startsWith("+")) {
    return "added";
  }
  return text.startsWith("-") ? "removed" : "context";
};

/**
 * Splits a diff into lines keyed by their character offset in the text, each with what it is.
 * The lines that name a file (`--- a/…` and `+++ b/…`, with git's `diff --git` and `index`
 * before them) are told by where they are, before the file's changes; from there a line is what
 * its first character says, so a removed `---` (`----`) or an added `++i;` (`+++i;`) is a
 * change. Git's diff of several files names each before its own changes. A line git marks in
 * its first column (`+`, `-` or a space) is `marked`: the mark is drawn in a gutter of its own.
 */
export const diffLines = (diff: string) => {
  let offset = 0;
  let naming = true;
  return diff
    .replace(TRAILING_NEWLINE_RE, "")
    .split("\n")
    .map((text) => {
      let kind: LineKind = "context";
      let marked = false;
      if (naming) {
        naming = !FILES_NAMED_RE.test(text);
      } else if (text === "" || CHANGE_LINE_RE.test(text)) {
        kind = changeKind(text);
        marked = text === "" || MARKED_LINE_RE.test(text);
      } else {
        naming = true;
      }
      const line = { kind, marked, offset, text };
      offset += text.length + 1;
      return line;
    });
};

/** A file's diff, under the title that names it. */
const DiffView = ({ diffs }: { diffs: readonly FileDiff[] }) => (
  <div className="flex flex-col gap-3 px-2 pb-3">
    {diffs.map((d) => (
      <div className="flex flex-col gap-1" key={d.path}>
        {d.diff.trim() === "" ? (
          <p className="px-2 font-body-small text-muted-foreground">
            No text changes in this file
          </p>
        ) : (
          // A long line wraps: its mark keeps the gutter, the rest of it wraps beside the mark.
          <pre className="wrap-anywhere whitespace-pre-wrap rounded-lg bg-muted p-2 font-code">
            {diffLines(d.diff).map(({ kind, marked, offset, text: line }) => (
              <div
                className={cn(
                  "grid grid-cols-[1ch_minmax(0,1fr)]",
                  LINE_CLASS[kind]
                )}
                key={offset}
              >
                {marked ? (
                  <>
                    <span>{line.slice(0, 1) || " "}</span>
                    <span>{line.slice(1) || " "}</span>
                  </>
                ) : (
                  <span className="col-span-2">{line || " "}</span>
                )}
              </div>
            ))}
          </pre>
        )}
      </div>
    ))}
  </div>
);
