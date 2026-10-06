/**
 * The small drawings of the starters an empty canvas offers. They are drawn from a handful of
 * variables the tile sets: the design system's colours, radius and heading font, or the
 * editor's own greys for a plain wireframe, where cards are dashed and headings are bars.
 */
import { cn } from "cn";
import { Plus } from "lucide-react";
import {
  type CSSProperties,
  createContext,
  type ReactNode,
  useContext,
} from "react";
import type { StarterId, StarterTheme } from "./starters.ts";

const Plain = createContext(true);

const PLAIN: Record<string, string> = {
  "--s-accent": "color-mix(in oklab, var(--foreground) 30%, transparent)",
  "--s-card": "transparent",
  "--s-font": "inherit",
  "--s-ink": "color-mix(in oklab, var(--foreground) 16%, transparent)",
  "--s-line": "color-mix(in oklab, var(--foreground) 14%, transparent)",
  "--s-radius": "2px",
  "--s-side": "color-mix(in oklab, var(--foreground) 16%, transparent)",
  "--s-surface": "color-mix(in oklab, var(--foreground) 3%, var(--background))",
  "--s-text": "var(--foreground)",
};

/** The variables a tile is drawn with: the design system's, or a plain wireframe's. */
export const thumbStyle = (theme: StarterTheme | null): CSSProperties => {
  if (!theme) {
    return PLAIN as CSSProperties;
  }
  const text = theme.foreground ?? "#111";
  const surface = theme.surface ?? "#fff";
  return {
    "--s-accent": theme.accent ?? "var(--selection)",
    "--s-card": theme.card ?? surface,
    "--s-font": theme.font?.css ?? "inherit",
    "--s-ink": `color-mix(in oklab, ${text} 22%, transparent)`,
    "--s-line": theme.border ?? `color-mix(in oklab, ${text} 12%, transparent)`,
    "--s-radius": `${theme.radius}px`,
    "--s-side": text,
    "--s-surface": surface,
    "--s-text": text,
  } as CSSProperties;
};

const Bar = ({
  accent = false,
  h = 4,
  w,
}: {
  accent?: boolean;
  h?: number;
  w: string;
}) => (
  <div
    className={cn("shrink-0", accent ? "bg-(--s-accent)" : "bg-(--s-ink)")}
    style={{
      borderRadius: `min(var(--s-radius), ${h / 2}px)`,
      height: h,
      width: w,
    }}
  />
);

const Panel = ({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string;
}) => {
  const plain = useContext(Plain);
  return (
    <div
      className={cn(
        "flex flex-col gap-[3px] rounded-(--s-radius) border border-(--s-line) p-1",
        plain ? "border-dashed" : "bg-(--s-card) shadow-xs",
        className
      )}
    >
      {children}
    </div>
  );
};

/** A heading in the design system's font; a bar in a wireframe. */
const Heading = ({ children, size }: { children: string; size: number }) =>
  useContext(Plain) ? (
    <Bar h={size - 3} w="60%" />
  ) : (
    <span
      className="whitespace-nowrap font-semibold text-(--s-text) leading-none"
      style={{ fontFamily: "var(--s-font)", fontSize: size }}
    >
      {children}
    </span>
  );

const Field = () =>
  useContext(Plain) ? (
    <Bar h={8} w="100%" />
  ) : (
    <div
      className="h-2 w-full border border-(--s-line)"
      style={{ borderRadius: "min(var(--s-radius), 4px)" }}
    />
  );

const three = [0, 1, 2] as const;

const THUMBS: Record<StarterId, () => ReactNode> = {
  article: () => (
    <div className="mx-auto flex w-[70%] flex-col gap-1">
      <Heading size={11}>The long read</Heading>
      <div className="flex items-center gap-1">
        <div className="size-2.5 shrink-0 rounded-full bg-(--s-accent)" />
        <Bar w="30%" />
      </div>
      {["100%", "94%", "98%", "88%", "96%", "60%"].map((w) => (
        <Bar h={3} key={w} w={w} />
      ))}
    </div>
  ),
  dashboard: () => (
    <div className="flex flex-1 gap-[5px]">
      <div className="w-1/5 rounded-(--s-radius) bg-(--s-side)" />
      <div className="flex flex-1 flex-col gap-1">
        <Heading size={9}>Overview</Heading>
        <div className="flex gap-1">
          {three.map((i) => (
            <Panel className="flex-1" key={i}>
              <Bar accent={i === 0} h={7} w="50%" />
            </Panel>
          ))}
        </div>
        <Panel className="flex-1">
          <svg className="h-[22px] w-full" viewBox="0 0 100 24">
            <title>Chart</title>
            <path
              className="stroke-(--s-accent)"
              d="M0 20 L15 14 L30 16 L45 8 L60 11 L75 4 L100 7"
              fill="none"
              strokeWidth={2}
            />
          </svg>
        </Panel>
      </div>
    </div>
  ),
  landing: () => (
    <>
      <div className="flex items-center justify-between">
        <Bar h={5} w="22%" />
        <Bar accent h={9} w="18%" />
      </div>
      <div className="my-1.5 flex flex-col items-center gap-1">
        <Heading size={12}>Make it yours</Heading>
        <Bar w="55%" />
        <Bar accent h={9} w="24%" />
      </div>
      <div className="flex flex-1 gap-1">
        {three.map((i) => (
          <Panel className="flex-1" key={i}>
            <Bar w="70%" />
          </Panel>
        ))}
      </div>
    </>
  ),
  pricing: () => (
    <>
      <div className="flex flex-col items-center gap-1">
        <Heading size={10}>Pricing</Heading>
        <Bar w="40%" />
      </div>
      <div className="mt-1.5 flex flex-1 gap-1">
        {three.map((i) => (
          <Panel
            className={cn("flex-1", i === 1 && "border-(--s-accent)")}
            key={i}
          >
            <Bar w="50%" />
            <Bar h={7} w="70%" />
            <div className="flex-1" />
            <Bar accent={i === 1} h={7} w="100%" />
          </Panel>
        ))}
      </div>
    </>
  ),
  settings: () => (
    <>
      <Heading size={10}>Settings</Heading>
      <div className="mt-0.5 flex gap-1">
        <Bar accent h={5} w="16%" />
        <Bar h={5} w="14%" />
        <Bar h={5} w="14%" />
      </div>
      <div className="mt-1.5 flex flex-col gap-[5px]">
        {three.map((i) => (
          <div className="flex items-center justify-between" key={i}>
            <Bar h={5} w="45%" />
            <div
              className={cn(
                "h-[9px] w-4 rounded-full",
                i === 1 ? "bg-(--s-ink)" : "bg-(--s-accent)"
              )}
            />
          </div>
        ))}
      </div>
    </>
  ),
  "sign-in": () => (
    <div className="grid flex-1 place-items-center">
      <Panel className="w-[52%] gap-1 p-1.5">
        <Heading size={8}>Welcome back</Heading>
        <Field />
        <Field />
        <Bar accent h={8} w="100%" />
      </Panel>
    </div>
  ),
};

/** What a starter's tile shows: its drawing, or the plus of a blank page. */
export const StarterThumb = ({
  id,
  plain,
}: {
  id: StarterId | "blank";
  plain: boolean;
}) =>
  id === "blank" ? (
    <div className="grid flex-1 place-items-center text-muted-foreground">
      <Plus className="size-[18px]" />
    </div>
  ) : (
    <Plain.Provider value={plain}>{THUMBS[id]()}</Plain.Provider>
  );
