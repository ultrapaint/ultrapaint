/**
 * A project's icon (ADR 0107), one drawing wherever it shows: the title row, the project menu,
 * Settings › Name and icon and its dialogs, and the desktop app's tabs. An icon of the set on a
 * tint of its colour, an image of the project as the server serves it, or the name's initial on a
 * tint of its colour; an image that does not load gives way to the initial.
 */
import {
  PROJECT_IMAGE_ROUTE,
  type ShownProjectIcon,
} from "@ultrapaint/contracts/project";
import type { ProjectIconColor } from "@ultrapaint/contracts/settings";
import { DynamicIcon, type IconName } from "lucide-react/dynamic";
import { type CSSProperties, useState } from "react";
import { cn } from "@/lib/cn";
import { serverAddress } from "../platform.ts";

/** Each colour of the set: the glyph's, and the tile's, a tint of it. */
export const PROJECT_ICON_HEX: Record<ProjectIconColor, string> = {
  blue: "#60a5fa",
  green: "#4ade80",
  grey: "#a1a1aa",
  orange: "#fb923c",
  pink: "#f472b6",
  red: "#f87171",
  teal: "#2dd4bf",
  violet: "#a78bfa",
  yellow: "#facc15",
};

/** The tile's tint of a colour: 14% of it, as the drawings have it. */
export const tintOf = (color: ProjectIconColor) =>
  `${PROJECT_ICON_HEX[color]}24`;

/** Where the editor draws an image of the project from: its server. */
export const projectImageUrl = (path: string) =>
  serverAddress(`${PROJECT_IMAGE_ROUTE}?path=${encodeURIComponent(path)}`);

/** The tile's sizes, in pixels: its side, its corner and the glyph in it. */
const SIZES = {
  16: { glyph: 11, radius: 4, text: 10 },
  24: { glyph: 17, radius: 6, text: 13 },
  28: { glyph: 20, radius: 7, text: 15 },
  32: { glyph: 22, radius: 6, text: 17 },
  40: { glyph: 28, radius: 10, text: 22 },
} as const;

const LETTER_RE = /[\p{L}\p{N}]/u;

/** The initial a name is drawn by when there is no other icon. */
const initialOf = (name: string) =>
  (name.match(LETTER_RE)?.[0] ?? name.trim()[0] ?? "?").toLocaleUpperCase();

export const ProjectIcon = ({
  className,
  icon,
  name,
  size,
}: {
  className?: string;
  /** The icon as the server shows it; absent from an older server, the name's initial in grey. */
  icon: ShownProjectIcon | undefined;
  /** The project's name, whose initial stands in for an image that does not load. */
  name: string;
  size: keyof typeof SIZES;
}) => {
  const [broken, setBroken] = useState<string | null>(null);
  const { glyph, radius, text } = SIZES[size];
  const tile: CSSProperties = {
    borderRadius: radius,
    height: size,
    width: size,
  };
  const classes = cn(
    "flex shrink-0 items-center justify-center overflow-hidden",
    className
  );
  if (icon?.kind === "file" && broken !== icon.path) {
    const { path } = icon;
    return (
      <span aria-hidden className={classes} style={tile}>
        {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: a file that does not load, not the person, gives way to the initial */}
        <img
          alt=""
          className="size-full object-contain"
          draggable={false}
          height={size}
          onError={() => setBroken(path)}
          src={projectImageUrl(path)}
          width={size}
        />
      </span>
    );
  }
  if (icon?.kind === "icon") {
    return (
      <span
        aria-hidden
        className={classes}
        style={{ ...tile, background: tintOf(icon.color) }}
      >
        <DynamicIcon
          color={PROJECT_ICON_HEX[icon.color]}
          name={icon.name as IconName}
          size={glyph}
        />
      </span>
    );
  }
  const color = icon?.kind === "initial" ? icon.color : "grey";
  return (
    <span
      aria-hidden
      className={cn(classes, "font-heading-xsmall")}
      style={{
        ...tile,
        background: tintOf(color),
        color: PROJECT_ICON_HEX[color],
        // The initial fills its tile, whatever the tile's size: a glyph, not text.
        fontSize: text,
        lineHeight: 1,
      }}
    >
      {icon?.kind === "initial" ? icon.initial : initialOf(name)}
    </span>
  );
};
