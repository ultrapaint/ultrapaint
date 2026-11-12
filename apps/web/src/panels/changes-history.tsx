/**
 * The History tab of the Changes panel (ADR 0087): Now and Save version, then every point of the
 * designs' history by day, newest first. The person's edits, an agent's turn (what was asked,
 * the agent's mark and model, the canvases), a version (a point named), a restore, and files
 * changed from outside, which say so and offer nothing. The person's points one after another
 * fold into one row. A point clicked opens its pages before and after; its menu has the rest.
 */
import type { HistoryPoint } from "@ultrapaint/contracts/snapshots";
import { plural } from "@ultrapaint/shared/text";
import {
  Bookmark,
  ChevronDown,
  ChevronRight,
  Ellipsis,
  Folder,
  Frame,
  GitCompareArrows,
  History as HistoryIcon,
  Pencil,
  Sparkles,
  Undo2,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { AgentIcon } from "../components/agent-icon.tsx";
import {
  openPoint,
  removeVersion,
  restorePoint,
  saveVersion,
} from "../lib/history-actions.ts";
import { canvasesOf, pointTitle } from "../lib/history-words.ts";
import { initialsOf } from "../lib/initials.ts";
import { useHistory } from "../state/history.ts";
import { showLeftPanel } from "../state/panels.ts";
import { useProject } from "../state/project.ts";
import { PointPreview } from "./point-preview.tsx";

const timeFormat = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});
const dayFormat = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
});
const yearFormat = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  year: "numeric",
});

/** The day a point is listed under: Today, Yesterday, the date, the year when not this one. */
export const dayOf = (at: number, now = new Date()) => {
  const day = new Date(at);
  if (day.toDateString() === now.toDateString()) {
    return "Today";
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (day.toDateString() === yesterday.toDateString()) {
    return "Yesterday";
  }
  return day.getFullYear() === now.getFullYear()
    ? dayFormat.format(at)
    : yearFormat.format(at);
};

/** A row of the list: one point, or the person's points one after another. */
type Row =
  | { readonly kind: "point"; readonly point: HistoryPoint }
  | { readonly kind: "edits"; readonly points: readonly HistoryPoint[] };

const isPlainEdits = (point: HistoryPoint) =>
  point.kind === "edits" && point.name === undefined;

/** The points by day, newest first, the person's unnamed points one after another folded. */
export const rowsByDay = (
  points: readonly HistoryPoint[],
  now = new Date()
): { day: string; rows: Row[] }[] => {
  const days: { day: string; rows: Row[] }[] = [];
  for (const point of points) {
    const day = dayOf(point.at, now);
    let group = days.at(-1);
    if (group?.day !== day) {
      group = { day, rows: [] };
      days.push(group);
    }
    const last = group.rows.at(-1);
    if (isPlainEdits(point) && last && last.kind !== "point") {
      group.rows[group.rows.length - 1] = {
        kind: "edits",
        points: [...last.points, point],
      };
    } else if (
      isPlainEdits(point) &&
      last?.kind === "point" &&
      isPlainEdits(last.point)
    ) {
      group.rows[group.rows.length - 1] = {
        kind: "edits",
        points: [last.point, point],
      };
    } else {
      group.rows.push({ kind: "point", point });
    }
  }
  return days;
};

/** The person's initials in a small circle: their edits' mark. */
const YouMark = () => {
  const name = useProject(
    (s) => s.info.gitUser?.name ?? s.info.displayName ?? ""
  );
  return (
    <span className="flex size-5 items-center justify-center rounded-full bg-accent font-body-small-medium">
      {name ? initialsOf(name).slice(0, 1) : "Y"}
    </span>
  );
};

const ICON = "size-4 text-muted-foreground";

/** The mark a point leads with: what made it. */
const LeadIcon = ({ point }: { point: HistoryPoint }) => {
  if (point.name !== undefined) {
    return <Bookmark className="size-4 text-foreground" />;
  }
  switch (point.kind) {
    case "edits":
      return <YouMark />;
    case "turn":
      return <Sparkles className={ICON} />;
    case "restore":
      return <Undo2 className={ICON} />;
    case "outside":
      return <Folder className={ICON} />;
    default:
      return <HistoryIcon className={ICON} />;
  }
};

/** What a row says under the point's words. */
const Meta = ({ point }: { point: HistoryPoint }) => {
  const canvases = useProject((s) => s.canvases);
  const names = (id: string) => canvases.find((c) => c.id === id)?.name;
  const where = canvasesOf(point, names);
  const when = timeFormat.format(point.at);
  /** The line's parts, each by a name of its own, in order. */
  const parts: [string, ReactNode][] = [];
  if (point.name !== undefined) {
    parts.push(["version", "Version"]);
  }
  if (point.kind === "turn") {
    parts.push([
      "agent",
      <span className="inline-flex min-w-0 items-center gap-1" key="agent">
        <AgentIcon
          agentId={point.agentId ?? ""}
          className="size-3 shrink-0 fill-muted-foreground"
        />
        {point.model ?? point.agentId}
      </span>,
    ]);
  } else if (point.kind === "edits" && point.edits !== undefined) {
    parts.push(["edits", plural(point.edits, "edit")]);
  } else if (point.kind === "outside") {
    parts.push(["outside", "Not by Ultrapaint"]);
  }
  if (where && point.kind !== "outside" && point.kind !== "start") {
    parts.push(["where", where]);
  }
  parts.push(["when", when]);
  return (
    <span className="flex min-w-0 items-center">
      {parts.map(([key, part], i) => (
        <span
          className="flex min-w-0 items-center truncate last:shrink-0"
          key={key}
        >
          {i > 0 ? (
            <span aria-hidden className="shrink-0 px-1">
              ·
            </span>
          ) : null}
          {part}
        </span>
      ))}
    </span>
  );
};

/** A point's actions, in a menu at the row's end, there at rest. */
const PointMenu = ({ point }: { point: HistoryPoint }) => {
  const title = pointTitle(point);
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              render={
                <Button
                  aria-label={`Actions for ${title}`}
                  className="relative z-10 text-muted-foreground data-popup-open:bg-accent data-popup-open:text-foreground"
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
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem onClick={() => restorePoint(point)}>
          <Undo2 />
          Restore
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => openPoint(point)}>
          <Frame />
          Open on canvas
        </DropdownMenuItem>
        {point.kind === "turn" && point.threadId ? (
          <DropdownMenuItem
            onClick={() => showLeftPanel({ chat: point.threadId ?? "" })}
          >
            <Sparkles />
            Open the chat
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        {point.name === undefined ? (
          <DropdownMenuItem onClick={() => saveVersion(point)}>
            <Bookmark />
            Save as version…
          </DropdownMenuItem>
        ) : (
          <>
            <DropdownMenuItem onClick={() => saveVersion(point)}>
              <Pencil />
              Rename…
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => removeVersion(point)}>
              <GitCompareArrows />
              Remove from versions
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

/**
 * A row: its button covers the whole row, so a click anywhere on it opens the point's preview,
 * and keyboard focus rings the whole row. The menu sits above the button.
 */
const ROW =
  "relative flex shrink-0 items-start gap-2.5 rounded-md py-1.5 pr-1 pl-2 transition-colors duration-100 hover:bg-accent/50 has-[[data-row-button]:focus-visible]:ring-2 has-[[data-row-button]:focus-visible]:ring-ring has-[[data-popup-open]]:bg-accent";
const ROW_BUTTON =
  "flex min-w-0 flex-1 items-start gap-2.5 text-left outline-none after:absolute after:inset-0 after:rounded-md";

/** The point's words and what is said under them. */
const Words = ({
  muted = false,
  point,
}: {
  muted?: boolean;
  point: HistoryPoint;
}) => (
  <span className="flex min-w-0 flex-1 flex-col">
    <span
      className={cn(
        "truncate",
        muted ? "font-body text-muted-foreground" : "font-body-medium"
      )}
    >
      {pointTitle(point)}
    </span>
    <span className="font-body-small text-muted-foreground">
      <Meta point={point} />
    </span>
  </span>
);

/** Files changed from outside: said, muted, with nothing to do on them. */
const OutsideRow = ({ point }: { point: HistoryPoint }) => (
  <li className="flex items-start gap-2.5 py-1.5 pr-1 pl-2">
    <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
      <LeadIcon point={point} />
    </span>
    <Words muted point={point} />
  </li>
);

/** A point: clicked, its pages before and after; its menu at its end. */
const PointRow = ({
  indent = false,
  point,
}: {
  /** One of the person's points inside their folded row. */
  indent?: boolean;
  point: HistoryPoint;
}) => {
  const [open, setOpen] = useState(false);
  if (point.kind === "outside") {
    return <OutsideRow point={point} />;
  }
  // Where the history begins, or what was kept before it: nothing to compare with.
  const comparable = point.kind !== "start" && point.kind !== "imported";
  const lead = (
    <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
      {indent ? null : <LeadIcon point={point} />}
    </span>
  );
  return (
    <li className={ROW}>
      {comparable ? (
        <Popover onOpenChange={setOpen} open={open}>
          <PopoverTrigger
            render={
              <button className={ROW_BUTTON} data-row-button type="button" />
            }
          >
            {lead}
            <Words point={point} />
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="w-100 p-4"
            side="right"
            sideOffset={12}
          >
            <PointPreview
              meta={<Meta point={point} />}
              onRestore={() => {
                setOpen(false);
                restorePoint(point);
              }}
              point={point}
            />
          </PopoverContent>
        </Popover>
      ) : (
        <span className="flex min-w-0 flex-1 items-start gap-2.5">
          {lead}
          <Words point={point} />
        </span>
      )}
      <PointMenu point={point} />
    </li>
  );
};

/** The person's points one after another: one row, opened to each. */
const EditsRow = ({ points }: { points: readonly HistoryPoint[] }) => {
  const [open, setOpen] = useState(false);
  const canvases = useProject((s) => s.canvases);
  const [newest] = points;
  const oldest = points.at(-1);
  if (!(newest && oldest)) {
    return null;
  }
  const edits = points.reduce((n, p) => n + (p.edits ?? 0), 0);
  const ids = [...new Set(points.flatMap((p) => p.canvases))];
  const where = canvasesOf(
    { ...newest, canvases: ids },
    (id) => canvases.find((c) => c.id === id)?.name
  );
  const span = `${timeFormat.format(oldest.from ?? oldest.at)}–${timeFormat.format(newest.at)}`;
  return (
    <>
      <li className={ROW}>
        <button
          aria-expanded={open}
          className={ROW_BUTTON}
          data-row-button
          onClick={() => setOpen(!open)}
          type="button"
        >
          <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
            <YouMark />
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate font-body-medium">Your edits</span>
            <span className="truncate font-body-small text-muted-foreground">
              {[plural(edits, "edit"), where, span].filter(Boolean).join(" · ")}
            </span>
          </span>
        </button>
        <span className="flex size-6 shrink-0 items-center justify-center text-muted-foreground">
          {open ? (
            <ChevronDown className="size-4" />
          ) : (
            <ChevronRight className="size-4" />
          )}
        </span>
      </li>
      {open
        ? points.map((point) => (
            <PointRow indent key={point.id} point={point} />
          ))
        : null}
    </>
  );
};

/** Now: the person's edits not in a point yet, and the way to keep the designs as they are. */
const NowRow = () => {
  const pending = useHistory((s) => s.pending);
  const latest = useHistory((s) => s.points?.[0]);
  let said = "No changes yet";
  if (pending) {
    said = `${plural(pending.edits, "edit")} since ${timeFormat.format(pending.since)}`;
  } else if (latest) {
    said = `No edits since ${timeFormat.format(latest.at)}`;
  }
  return (
    <div className="flex items-center gap-2 rounded-lg bg-muted py-2 pr-2 pl-3">
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="font-body-medium">Now</span>
        <span className="truncate font-body-small text-muted-foreground">
          {said}
        </span>
      </span>
      <Button onClick={() => saveVersion()} size="sm" variant="outline">
        Save version
      </Button>
    </div>
  );
};

/** The history, read: Now, then the points by day. */
export const HistoryTab = ({ onRetry }: { onRetry: () => void }) => {
  const points = useHistory((s) => s.points);
  const failed = useHistory((s) => s.failed);
  let list: ReactNode;
  if (points === null) {
    list = failed ? (
      <div className="flex min-h-7 items-center justify-between gap-2 rounded-md bg-destructive/10 py-0.5 pr-0.5 pl-2">
        <span className="font-body-small text-destructive">
          The history didn’t load
        </span>
        <Button onClick={onRetry} size="sm" variant="ghost">
          Try again
        </Button>
      </div>
    ) : (
      <div
        aria-label="Loading"
        className="flex flex-col gap-2 px-2"
        role="status"
      >
        {["w-3/5", "w-2/5", "w-1/2"].map((w) => (
          <span
            className={cn(
              "block h-3 rounded-sm bg-foreground/10 motion-safe:animate-pulse",
              w
            )}
            key={w}
          />
        ))}
      </div>
    );
  } else {
    list = rowsByDay(points).map(({ day, rows }) => (
      <section aria-label={day} className="flex flex-col" key={day}>
        <h3 className="flex h-7 items-end px-2 pb-1 font-body-small-medium text-muted-foreground">
          {day}
        </h3>
        <ul className="flex flex-col gap-0.5">
          {rows.map((row) =>
            row.kind === "point" ? (
              <PointRow key={row.point.id} point={row.point} />
            ) : (
              <EditsRow key={row.points[0]?.id} points={row.points} />
            )
          )}
        </ul>
      </section>
    ));
  }
  return (
    <div className="flex flex-col gap-2">
      <NowRow />
      {list}
    </div>
  );
};
