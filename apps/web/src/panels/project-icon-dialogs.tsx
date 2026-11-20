/**
 * Settings › Name and icon's two dialogs (ADR 0107), each saving on Save and nothing before:
 * Choose icon, an icon of the set in a colour, found by its name; and Choose file, an image of
 * the project, among those found where a favicon or an app icon is kept, or any other by its path.
 */
import type { ShownProjectIcon } from "@ultrapaint/contracts/project";
import {
  PROJECT_ICON_COLORS,
  type ProjectIconColor,
  type ProjectIcon as ProjectIconValue,
} from "@ultrapaint/contracts/settings";
import { Check, Search } from "lucide-react";
import { DynamicIcon, type IconName, iconNames } from "lucide-react/dynamic";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { CutPath } from "../components/cut-path.tsx";
import {
  PROJECT_ICON_HEX,
  ProjectIcon,
  projectImageUrl,
  tintOf,
} from "../components/project-icon.tsx";
import { api } from "../state/connection.ts";

/** The icons offered before anything is searched: what a project is often about. */
const FIRST_ICONS: readonly IconName[] = [
  "boxes",
  "book-open",
  "shapes",
  "flame",
  "globe",
  "code",
  "server",
  "palette",
  "chart-column",
  "calendar",
  "camera",
  "map-pin",
  "message-square",
  "shield-check",
  "swatch-book",
  "pen-tool",
  "mic",
  "bell",
  "plug",
  "user",
  "layout-grid",
  "file-text",
  "wand-sparkles",
  "sticky-note",
];

/** How many icons a search shows: six rows. */
const FOUND_LIMIT = 48;

const SPACES_RE = /\s+/g;

/** The icons whose name holds what was typed, its words joined as Lucide's names are. */
export const iconsFor = (query: string): readonly IconName[] => {
  const wanted = query.trim().toLowerCase().replace(SPACES_RE, "-");
  return wanted
    ? iconNames.filter((name) => name.includes(wanted)).slice(0, FOUND_LIMIT)
    : FIRST_ICONS;
};

/** The project as both dialogs name it: its icon now, its name and its folder. */
export interface ProjectShown {
  icon: ShownProjectIcon | undefined;
  name: string;
  path: string;
}

/** The project, as the dialog would leave it: its icon, its name and its folder. */
const Preview = ({
  icon,
  project,
}: {
  icon: ShownProjectIcon | undefined;
  project: ProjectShown;
}) => (
  <div className="flex items-center gap-3">
    <ProjectIcon icon={icon} name={project.name} size={40} />
    <div className="flex min-w-0 flex-col">
      <span className="truncate font-body-medium">{project.name}</span>
      <CutPath
        className="font-body-small text-muted-foreground"
        path={project.path}
      />
    </div>
  </div>
);

/** Cancel and Save, at the dialog's end. Save is never disabled: it says what is missing. */
const Actions = ({
  onCancel,
  onSave,
}: {
  onCancel: () => void;
  onSave: () => void;
}) => (
  <DialogFooter>
    <Button onClick={onCancel} variant="outline">
      Cancel
    </Button>
    <Button onClick={onSave}>Save</Button>
  </DialogFooter>
);

/** What Save found missing, under what it is about. */
const Missing = ({ children }: { children: string | null }) =>
  children ? (
    <p className="font-body-small text-destructive" role="alert">
      {children}
    </p>
  ) : null;

/** The dialog's body: drawn only while it is open, so each open starts from the project. */
const ChooseIconBody = ({
  onClose,
  onSave,
  project,
}: {
  onClose: () => void;
  onSave: (icon: ProjectIconValue) => void;
  project: ProjectShown;
}) => {
  const now = project.icon;
  const [color, setColor] = useState<ProjectIconColor>(
    now?.kind === "icon" || now?.kind === "initial" ? now.color : "blue"
  );
  const [name, setName] = useState<string | null>(
    now?.kind === "icon" ? now.name : null
  );
  const [query, setQuery] = useState("");
  const [missing, setMissing] = useState<string | null>(null);
  const icons = iconsFor(query);
  const chosen = name ? ({ color, kind: "icon", name } as const) : now;
  return (
    <>
      <DialogHeader>
        <DialogTitle>Choose icon</DialogTitle>
      </DialogHeader>
      <Preview icon={chosen} project={project} />
      <div
        aria-label="Colour"
        className="flex flex-wrap gap-1"
        role="radiogroup"
      >
        {PROJECT_ICON_COLORS.map((c) => (
          // biome-ignore lint/a11y/useSemanticElements: a swatch, as a radio named by its colour
          <button
            aria-checked={c === color}
            aria-label={c}
            className={cn(
              "flex size-7 items-center justify-center rounded-full border-2 border-transparent outline-none focus-visible:ring-2 focus-visible:ring-ring",
              c === color && "border-foreground"
            )}
            key={c}
            onClick={() => setColor(c)}
            role="radio"
            type="button"
          >
            <span
              className="size-5 rounded-full"
              style={{ background: PROJECT_ICON_HEX[c] }}
            />
          </button>
        ))}
      </div>
      <div className="flex flex-col gap-2.5">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Search icons"
            className="h-9 pl-8"
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search icons"
            value={query}
          />
        </div>
        {icons.length === 0 ? (
          <p className="py-6 text-center font-body-small text-muted-foreground">
            No icon is called “{query.trim()}”.
          </p>
        ) : (
          <div
            aria-label="Icon"
            className="grid max-h-72 grid-cols-8 gap-1.5 overflow-y-auto"
            role="radiogroup"
          >
            {icons.map((icon) => {
              const on = icon === name;
              return (
                // biome-ignore lint/a11y/useSemanticElements: an icon, as a radio named by its name
                <button
                  aria-checked={on}
                  aria-label={icon}
                  className={cn(
                    "flex size-10 items-center justify-center rounded-lg border border-transparent text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  )}
                  key={icon}
                  onClick={() => {
                    setName(icon);
                    setMissing(null);
                  }}
                  role="radio"
                  style={
                    on
                      ? {
                          background: tintOf(color),
                          borderColor: PROJECT_ICON_HEX[color],
                          color: PROJECT_ICON_HEX[color],
                        }
                      : undefined
                  }
                  title={icon}
                  type="button"
                >
                  <DynamicIcon name={icon} size={18} />
                </button>
              );
            })}
          </div>
        )}
        <Missing>{missing}</Missing>
      </div>
      <Actions
        onCancel={onClose}
        onSave={() => {
          if (!name) {
            setMissing("Choose an icon first.");
            return;
          }
          onSave({ color, kind: "icon", name });
          onClose();
        }}
      />
    </>
  );
};

/** Choose icon: an icon of the set in one of the colours, saved on Save. */
export const ChooseIconDialog = ({
  onOpenChange,
  onSave,
  open,
  project,
}: {
  onOpenChange: (open: boolean) => void;
  onSave: (icon: ProjectIconValue) => void;
  open: boolean;
  project: ProjectShown;
}) => (
  <Dialog onOpenChange={onOpenChange} open={open}>
    <DialogContent className="grid-cols-[minmax(0,1fr)] gap-5 sm:max-w-110">
      {open ? (
        <ChooseIconBody
          onClose={() => onOpenChange(false)}
          onSave={onSave}
          project={project}
        />
      ) : null}
    </DialogContent>
  </Dialog>
);

/** What an image offered turned out to be once its thumbnail loaded, or that it did not. */
type ImageRead =
  | { kind: "svg" }
  | { height: number; kind: "pixels"; width: number }
  | { kind: "unreadable" };

const readLabel = (read: ImageRead | undefined) => {
  if (read?.kind === "svg") {
    return "SVG";
  }
  if (read?.kind === "pixels") {
    return `${read.width} × ${read.height}`;
  }
  return read?.kind === "unreadable" ? "Not found" : "";
};

/** An image offered: its thumbnail, its path and its size, checked when chosen. */
const ImageRow = ({
  chosen,
  onChoose,
  onRead,
  path,
  read,
}: {
  chosen: boolean;
  onChoose: () => void;
  onRead: (read: ImageRead) => void;
  path: string;
  read: ImageRead | undefined;
}) => (
  // biome-ignore lint/a11y/useSemanticElements: an image with its thumbnail and size, as a radio
  <button
    aria-checked={chosen}
    className={cn(
      "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
      chosen && "bg-accent"
    )}
    onClick={onChoose}
    role="radio"
    type="button"
  >
    <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
      {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: its load, not the person's, says its size */}
      <img
        alt=""
        className="size-5 object-contain"
        height={20}
        onError={() => onRead({ kind: "unreadable" })}
        onLoad={(e) =>
          onRead(
            path.toLowerCase().endsWith(".svg")
              ? { kind: "svg" }
              : {
                  height: e.currentTarget.naturalHeight,
                  kind: "pixels",
                  width: e.currentTarget.naturalWidth,
                }
          )
        }
        src={projectImageUrl(path)}
        width={20}
      />
    </span>
    <CutPath className="min-w-0 flex-1 font-body" path={path} />
    <span className="shrink-0 font-body-small text-muted-foreground">
      {readLabel(read)}
    </span>
    <span className="flex size-4 shrink-0 items-center justify-center">
      {chosen ? <Check className="size-4" /> : null}
    </span>
  </button>
);

const LEADING_DOT_RE = /^\.\//;

/** The dialog's body: drawn only while it is open, so each open reads the project again. */
const ChooseFileBody = ({
  onClose,
  onSave,
  project,
}: {
  onClose: () => void;
  onSave: (icon: ProjectIconValue) => void;
  project: ProjectShown;
}) => {
  const now = project.icon?.kind === "file" ? project.icon.path : null;
  const [found, setFound] = useState<readonly string[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [added, setAdded] = useState<readonly string[]>([]);
  const [chosen, setChosen] = useState<string | null>(now);
  const [reads, setReads] = useState<Readonly<Record<string, ImageRead>>>({});
  const [missing, setMissing] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState("");
  useEffect(() => {
    api()
      .request("project.images", undefined)
      .then(setFound)
      .catch((error: Error) => {
        setFound([]);
        setProblem(`Couldn’t look for images (${error.message}).`);
      });
  }, []);
  const listed = [
    ...new Set([...(now ? [now] : []), ...added, ...(found ?? [])]),
  ];
  /** The path typed, offered and chosen: its thumbnail, served by the project, says if it is one. */
  const add = () => {
    const path = typed.trim().replace(LEADING_DOT_RE, "");
    if (path) {
      setAdded((list) => [path, ...list.filter((p) => p !== path)]);
      setChosen(path);
      setMissing(null);
    }
  };
  const save = () => {
    if (chosen === null) {
      setMissing("Choose an image first.");
      return;
    }
    // Served only from inside the project, and only an image: one that did not load is none.
    if (reads[chosen]?.kind === "unreadable") {
      setMissing("No image at that path in the project.");
      return;
    }
    onSave({ kind: "file", path: chosen });
    onClose();
  };
  return (
    <>
      <DialogHeader>
        <DialogTitle>Choose file</DialogTitle>
      </DialogHeader>
      {found === null ? (
        <p className="font-body-small text-muted-foreground">
          Looking for images…
        </p>
      ) : (
        <div
          aria-label="Images in the project"
          className="flex max-h-72 flex-col gap-0.5 overflow-y-auto"
          role="radiogroup"
        >
          {listed.length === 0 ? (
            <p className="font-body-small text-muted-foreground">
              {problem ?? "No favicon or app icon in the project."}
            </p>
          ) : (
            listed.map((path) => (
              <ImageRow
                chosen={path === chosen}
                key={path}
                onChoose={() => {
                  setChosen(path);
                  setMissing(null);
                }}
                onRead={(read) =>
                  setReads((known) => ({ ...known, [path]: read }))
                }
                path={path}
                read={reads[path]}
              />
            ))
          )}
        </div>
      )}
      {typing ? (
        <Input
          aria-label="Path in the project"
          autoFocus
          onBlur={add}
          onChange={(e) => {
            setTyped(e.target.value);
            setMissing(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              add();
            } else if (e.key === "Escape") {
              e.stopPropagation();
              setTyped("");
              setTyping(false);
            }
          }}
          placeholder="Path in the project, as docs/logo.svg"
          spellCheck={false}
          value={typed}
        />
      ) : (
        <div>
          <Button onClick={() => setTyping(true)} variant="outline">
            Choose another file…
          </Button>
        </div>
      )}
      <Missing>{missing}</Missing>
      <Actions onCancel={onClose} onSave={save} />
    </>
  );
};

/** Choose file: an image of the project, saved on Save. */
export const ChooseFileDialog = ({
  onOpenChange,
  onSave,
  open,
  project,
}: {
  onOpenChange: (open: boolean) => void;
  onSave: (icon: ProjectIconValue) => void;
  open: boolean;
  project: ProjectShown;
}) => (
  <Dialog onOpenChange={onOpenChange} open={open}>
    <DialogContent className="grid-cols-[minmax(0,1fr)] gap-5 sm:max-w-110">
      {open ? (
        <ChooseFileBody
          onClose={() => onOpenChange(false)}
          onSave={onSave}
          project={project}
        />
      ) : null}
    </DialogContent>
  </Dialog>
);
