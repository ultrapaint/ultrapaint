/**
 * A newer release of the desktop app (ADR 0078, `Platform.update`): an item at the foot of the
 * rail, and a button on the start screen, there only while there is something to do. Either
 * opens what the releases since the running one bring and the one way to install it: a restart
 * when the app downloaded it, the release's page when this copy cannot replace itself.
 * Nothing in a browser.
 */
import type { AppUpdate } from "@ultrapaint/contracts/shell-bridge";
import { CircleFadingArrowUp } from "lucide-react";
import { type ReactElement, useMemo, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
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
import { platform } from "../platform.ts";
import { Markdown } from "./markdown.tsx";

type UpdateSource = NonNullable<ReturnType<typeof platform>["update"]>;

const NONE: UpdateSource = {
  current: () => null,
  subscribe: () => () => undefined,
};

/**
 * The update, as it changes. Read as text, which React compares by value: across the shell's
 * bridge each read is a fresh copy.
 */
export const useAppUpdate = () => {
  const source = platform().update ?? NONE;
  const text = useSyncExternalStore(source.subscribe, () =>
    JSON.stringify(source.current())
  );
  return useMemo(() => JSON.parse(text) as AppUpdate | null, [text]);
};

const DAY = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
});

const dayOf = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : DAY.format(date);
};

/** What the button and the rail's item call it. */
export const updateLabel = (update: AppUpdate) =>
  update.install === "restart"
    ? `Restart to update to ${update.releases[0].version}`
    : `Ultrapaint ${update.releases[0].version} is out`;

/** The releases since the running one, newest first, their notes, and how to install them. */
const UpdateDetails = ({ update }: { update: AppUpdate }) => {
  const [newest] = update.releases;
  const noted = update.releases.filter((r) => r.notes);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h2 className="font-heading-xsmall">Ultrapaint {newest.version}</h2>
        <p className="font-body-small text-muted-foreground">
          You have {update.current}
        </p>
      </div>
      {noted.length > 0 ? (
        <div className="-mx-3 flex max-h-80 flex-col gap-4 overflow-y-auto px-3">
          {noted.map((release) => (
            <section className="flex flex-col gap-1" key={release.version}>
              {update.releases.length > 1 ? (
                <h3 className="font-body-small text-muted-foreground">
                  {release.version}
                  {release.date ? ` · ${dayOf(release.date)}` : ""}
                </h3>
              ) : null}
              <Markdown className="font-body">{release.notes}</Markdown>
            </section>
          ))}
        </div>
      ) : null}
      {update.reason ? (
        <p className="text-pretty font-body-small text-muted-foreground">
          {update.reason}
        </p>
      ) : null}
      {update.install === "restart" ? (
        <Button
          className="self-end"
          onClick={() => {
            platform()
              .installUpdate?.()
              .catch(() => undefined);
          }}
        >
          Restart to update
        </Button>
      ) : (
        <Button
          className="self-end"
          render={<a href={update.url} rel="noreferrer" target="_blank" />}
        >
          Download
        </Button>
      )}
    </div>
  );
};

/** `trigger` opens the update's details, beside it. */
const UpdatePopover = ({
  side,
  trigger,
  update,
}: {
  side: "right" | "bottom";
  trigger: ReactElement;
  update: AppUpdate;
}) => (
  <Popover>
    {trigger}
    <PopoverContent align="end" className="w-80 p-3" side={side} sideOffset={4}>
      <UpdateDetails update={update} />
    </PopoverContent>
  </Popover>
);

/** At the rail's foot: drawn in the foreground, not muted as the places are, while it is there. */
export const UpdateRailItem = () => {
  const update = useAppUpdate();
  if (!update) {
    return null;
  }
  const label = updateLabel(update);
  return (
    <UpdatePopover
      side="right"
      trigger={
        <Tooltip>
          <TooltipTrigger
            render={
              <PopoverTrigger
                aria-label={label}
                className="flex size-8 shrink-0 items-center justify-center rounded-md text-foreground outline-none transition-colors hover:bg-foreground/6 focus-visible:ring-2 focus-visible:ring-ring/25 data-popup-open:bg-foreground/6"
              />
            }
          >
            <CircleFadingArrowUp className="size-[18px]" strokeWidth={1.75} />
          </TooltipTrigger>
          <TooltipContent side="right">{label}</TooltipContent>
        </Tooltip>
      }
      update={update}
    />
  );
};

/** On the start screen, at its top right. */
export const UpdateButton = ({ className }: { className?: string }) => {
  const update = useAppUpdate();
  if (!update) {
    return null;
  }
  return (
    <UpdatePopover
      side="bottom"
      trigger={
        <PopoverTrigger
          render={<Button className={className} size="sm" variant="ghost" />}
        >
          <CircleFadingArrowUp />
          {update.install === "restart"
            ? "Restart to update"
            : `${update.releases[0].version} is out`}
        </PopoverTrigger>
      }
      update={update}
    />
  );
};
