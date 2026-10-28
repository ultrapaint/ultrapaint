/**
 * What the project's design system is, as `/init` imported it: colours, typography, spacing,
 * radii, shadows, elevation, border widths, layout, motion and icons, and the conventions in
 * DESIGN.md. Typography is drawn by the preview itself,
 * with the repository's stylesheet, because the editor does not load the design system's fonts.
 * With nothing imported yet, this is where init starts.
 */
import {
  type DesignDocument,
  type DesignSystem,
  type ElevationLevel,
  type FontSizeToken,
  TEXT_STYLE_GROUPS,
  type TextStyle,
  type Token,
  type TokenGroup,
} from "@ultrapaint/contracts/design-system";
import type { DesignNode } from "@ultrapaint/contracts/document";
import {
  shortName,
  spacingBasePx,
  tokenOf,
  tokensOfKind,
} from "@ultrapaint/contracts/token-table";
import { ROOT_PX, toPx } from "@ultrapaint/contracts/token-value";
import type { TokenKind } from "@ultrapaint/contracts/tokens";
import { groupTextStyles } from "@ultrapaint/design-document/text-styles";
import {
  isToken,
  tokenName,
  tokenRef,
} from "@ultrapaint/design-document/tokens";
import {
  Check,
  FileUp,
  RefreshCw,
  Search,
  Sparkles,
  Wand2,
} from "lucide-react";
import type * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { frameOf, useFrameDrawing } from "../canvas/editor-frame.ts";
import { PreviewSurface } from "../canvas/preview-surface.tsx";
import { IconButton } from "../components/icon-button.tsx";
import { PanelEmpty } from "../components/panel.tsx";
import { Segmented } from "../components/segmented.tsx";
import { SetupEmpty } from "../components/setup-dialog.tsx";
import { pickFigmaFile } from "../lib/import-figma.ts";
import { startInit } from "../lib/start-thread.ts";
import {
  holdMenu,
  type MenuTarget,
  type MenuTokenKind,
  openMenuAt,
  showMenu,
} from "../state/context-menu.ts";
import { useDesignSystem } from "../state/design-system.ts";
import { useDesignSystemSetup } from "../state/design-system-setup.ts";
import { useDesignLook } from "../state/look.ts";
import { useProject } from "../state/project.ts";
import { useSync } from "../state/sync.ts";
import { ComponentsView } from "./design-components.tsx";
import { DesignMdView, SectionProse } from "./design-md-view.tsx";
import { SyncView } from "./sync.tsx";

const copy = (text: string) => {
  navigator.clipboard?.writeText(text).then(
    () => toast(`Copied ${text}`),
    () => undefined
  );
};

const matches = (token: { name: string; value: string }, q: string) =>
  !q ||
  token.name.toLowerCase().includes(q) ||
  token.value.toLowerCase().includes(q);

const valueIn = (token: Token, theme: string, themes: readonly string[]) =>
  theme === (themes[0] ?? "light")
    ? token.value
    : (token.values?.[theme] ?? token.value);

const Heading = ({ children }: { children: React.ReactNode }) => (
  <div className="sticky top-0 z-10 flex items-center border-b bg-sidebar px-3 py-1.5 font-heading-xsmall">
    {children}
  </div>
);

const Swatches = ({
  group,
  theme,
  themes,
}: {
  group: TokenGroup;
  theme: string;
  themes: readonly string[];
}) => (
  <div className="px-3 py-2">
    <div className="mb-1.5 font-heading-xsmall text-muted-foreground uppercase">
      {group.name}
    </div>
    <div className="grid grid-cols-[repeat(auto-fill,minmax(64px,1fr))] gap-1.5">
      {group.tokens.map((token) => {
        const value = valueIn(token, theme, themes);
        return (
          <button
            className="group flex min-w-0 flex-col overflow-hidden rounded-md border text-left hover:border-ring"
            key={token.name}
            onClick={() => copy(tokenRef(token.name))}
            onContextMenu={(e) =>
              openMenuAt(e, {
                kind: "token",
                name: token.name,
                tokenKind: "color",
                value,
              })
            }
            title={`${token.name}: ${value}${token.description ? `\n${token.description}` : ""}\nbg-${shortName(token.name)}`}
            type="button"
          >
            <span className="h-9 w-full" style={{ background: value }} />
            <span className="truncate px-1 pt-0.5 font-body text-foreground/90">
              {shortName(token.name)}
            </span>
            <span className="truncate px-1 pb-0.5 font-code text-muted-foreground leading-4">
              {value}
            </span>
          </button>
        );
      })}
    </div>
  </div>
);

/** The text styles the search leaves, in the order the samples number them. */
const stylesMatching = (ds: DesignSystem, q: string) =>
  ds.typography.styles.filter((s) => matches({ name: s.name, value: "" }, q));

const sizesMatching = (ds: DesignSystem, q: string) =>
  tokensOfKind(ds, "fontSize").filter((s) => matches(s, q));

const SAMPLE_ID_RE = /^(?:style|size|sample|label)-(\d+)$/;

/** The menu of the sample a node of the type specimen belongs to: a style's, or a size's. */
const sampleTarget = (
  ds: DesignSystem,
  q: string,
  chain: readonly string[]
): MenuTarget | null => {
  const match = chain
    .map((id) => SAMPLE_ID_RE.exec(id))
    .findLast((m) => m !== null);
  const index = match?.[1];
  if (index === undefined) {
    return null;
  }
  const styles = stylesMatching(ds, q);
  const style = styles[Number(index)];
  if (styles.length > 0) {
    return style ? { kind: "textStyle", name: style.name } : null;
  }
  const size = sizesMatching(ds, q)[Number(index)];
  return size
    ? {
        kind: "token",
        name: size.name,
        tokenKind: "fontSize",
        value: size.value,
      }
    : null;
};

/** The type samples, drawn by the preview with the repository's own fonts. */
const typeSpecimen = (ds: DesignSystem, q: string): DesignNode => {
  const styles = stylesMatching(ds, q);
  const sizes = sizesMatching(ds, q);
  const sample = (style: TextStyle, i: number): DesignNode => ({
    children: [
      {
        color: "#71717a",
        id: `label-${i}`,
        role: "paragraph" as const,
        size: 11,
        text: `${style.name}${style.level ? ` · h${style.level}` : ""}`,
        type: "text" as const,
      },
      {
        id: `sample-${i}`,
        level: style.level,
        role: style.role,
        text: "The quick brown fox jumps over the lazy dog",
        textStyle: style.name,
        type: "text" as const,
      },
    ],
    gap: 2,
    id: `style-${i}`,
    type: "column" as const,
  });
  // The styles under their groups: a small heading, then each style set in itself.
  const children: DesignNode[] =
    styles.length > 0
      ? [...groupTextStyles(styles)]
          .filter(([, list]) => list.length > 0)
          .map(([group, list]) => ({
            children: [
              {
                color: "#71717a",
                id: `group-${group}`,
                role: "paragraph" as const,
                size: 10,
                text: (
                  TEXT_STYLE_GROUPS.find((g) => g.group === group)?.label ??
                  group
                ).toUpperCase(),
                type: "text" as const,
              },
              ...list.map((style) => sample(style, styles.indexOf(style))),
            ],
            gap: 10,
            id: `styles-${group}`,
            type: "column" as const,
          }))
      : sizes.map((size: FontSizeToken, i) => ({
          children: [
            {
              color: "#71717a",
              id: `label-${i}`,
              role: "paragraph" as const,
              size: 11,
              text: `${size.name} · ${size.value}`,
              type: "text" as const,
            },
            {
              id: `sample-${i}`,
              role: "paragraph" as const,
              size: tokenRef(size.name),
              text: "The quick brown fox",
              type: "text" as const,
            },
          ],
          gap: 2,
          id: `size-${i}`,
          type: "column" as const,
        }));
  return {
    children,
    gap: 14,
    id: "typography",
    padding: 12,
    type: "column",
    width: "fill",
  };
};

export const TypeSpecimen = ({ ds, q }: { ds: DesignSystem; q: string }) => {
  const ref = useRef<HTMLDivElement>(null);
  const frame = "design-system:typography";
  const look = useDesignLook();
  useFrameDrawing(
    frame,
    useMemo(
      () => ({
        designSystem: ds,
        look,
        mode: "fit" as const,
        root: typeSpecimen(ds, q),
      }),
      [ds, look, q]
    )
  );
  // The samples are one picture: which one was right-clicked is asked of the preview.
  const onContextMenu = (e: React.MouseEvent) => {
    const anchor = holdMenu(e);
    const r = ref.current?.getBoundingClientRect();
    if (!r) {
      return;
    }
    const chain = frameOf(frame).hitTest(e.clientX - r.left, e.clientY - r.top);
    const target = sampleTarget(ds, q, chain);
    if (target) {
      showMenu(target, anchor);
    }
  };
  return (
    <div className="overflow-hidden px-3 py-2">
      {/* biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/noNoninteractiveElementInteractions: the samples are one picture; the inspector sets the same styles. */}
      <div
        className="overflow-hidden rounded-md border bg-white"
        onContextMenu={onContextMenu}
        ref={ref}
      >
        <PreviewSurface
          className="w-full"
          frameId={frame}
          hostClassName="block w-full"
          title="Type samples"
        />
      </div>
    </div>
  );
};

const TokenRows = ({
  tokens,
  kind,
  preview,
}: {
  tokens: readonly Token[];
  /** What the tokens can be applied to, from their menu. */
  kind: MenuTokenKind;
  preview: (token: Token) => React.ReactNode;
}) => (
  <div className="flex flex-col py-1">
    {tokens.map((token) => (
      <button
        className="flex items-center gap-2 px-3 py-1 text-left hover:bg-muted/50"
        key={token.name}
        onClick={() => copy(tokenRef(token.name))}
        onContextMenu={(e) =>
          openMenuAt(e, {
            kind: "token",
            name: token.name,
            tokenKind: kind,
            value: token.value,
          })
        }
        title={`Copy $${token.name}`}
        type="button"
      >
        <span className="flex w-14 shrink-0 justify-center">
          {preview(token)}
        </span>
        <span className="min-w-0 flex-1 truncate font-body">{token.name}</span>
        <span className="truncate font-code text-muted-foreground">
          {token.value}
        </span>
      </button>
    ))}
  </div>
);

const SPACING_SAMPLE = [1, 2, 3, 4, 6, 8, 12, 16];

/** CSS for a level's token or value, in the theme the panel shows. */
const resolveIn = (
  ds: DesignSystem,
  value: string | undefined,
  theme: string
): string | undefined => {
  if (value === undefined || !isToken(value)) {
    return value;
  }
  const name = tokenName(value);
  const themes = ds.themes ?? ["light"];
  const token = tokenOf(ds, name);
  return token ? valueIn(token, theme, themes) : undefined;
};

const ElevationRows = ({
  ds,
  levels,
  theme,
}: {
  ds: DesignSystem;
  levels: readonly ElevationLevel[];
  theme: string;
}) => (
  <div className="flex flex-col gap-1 bg-muted/40 py-2">
    {levels.map((level) => (
      <div className="flex items-center gap-2 px-3 py-1" key={level.name}>
        <span className="flex w-14 shrink-0 justify-center">
          <span
            className="size-7 rounded-md border border-foreground/10"
            style={{
              background: resolveIn(ds, level.surface, theme),
              boxShadow: resolveIn(ds, level.shadow, theme),
            }}
          />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-body">{level.name}</span>
          {level.description !== undefined && (
            <span className="truncate font-body text-muted-foreground">
              {level.description}
            </span>
          )}
        </span>
        <span className="truncate font-code text-muted-foreground">
          {[level.surface, level.shadow, level.layer && `z-${level.layer}`]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </div>
    ))}
  </div>
);

/** A length in pixels as the panel draws it, an `em` at the root's size. */
const pxOf = (value: string) => toPx(value, { em: ROOT_PX }) ?? 0;

/** A length as a bar, its widest at the panel's preview column. */
const LengthBar = ({ max, value }: { max: number; value: string }) => (
  <span
    className="h-2 rounded-sm bg-brand/60"
    style={{ width: Math.max(2, (pxOf(value) / max) * 56) }}
  />
);

const widest = (tokens: readonly Token[]) =>
  Math.max(1, ...tokens.map((t) => pxOf(t.value)));

const Contents = ({
  document,
  ds,
  q,
  theme,
}: {
  document: DesignDocument | null;
  ds: DesignSystem;
  q: string;
  theme: string;
}) => {
  // What DESIGN.md says about a group, above its tokens; a search shows the tokens alone.
  const prose = (name: string) =>
    q ? null : <SectionProse document={document} name={name} />;
  const themes = ds.themes ?? ["light"];
  const groups = ds.colors
    .map((g) => ({ ...g, tokens: g.tokens.filter((t) => matches(t, q)) }))
    .filter((g) => g.tokens.length > 0);
  const base = spacingBasePx(ds.spacing.base);
  const radius = tokensOfKind(ds, "radius").filter((t) => matches(t, q));
  const shadows = tokensOfKind(ds, "shadow").filter((t) => matches(t, q));
  const fonts = tokensOfKind(ds, "font").filter((t) => matches(t, q));
  return (
    <>
      <Heading>Colours</Heading>
      {prose("Colors")}
      {groups.length === 0 ? (
        <div className="px-3 py-2 font-body text-muted-foreground">
          No colours
        </div>
      ) : (
        groups.map((g) => (
          <Swatches group={g} key={g.name} theme={theme} themes={themes} />
        ))
      )}
      <Heading>Typography</Heading>
      {prose("Typography")}
      <TypeSpecimen ds={ds} q={q} />
      {fonts.length > 0 && (
        <TokenRows
          kind="font"
          preview={() => <span className="text-muted-foreground">Aa</span>}
          tokens={fonts}
        />
      )}
      <Heading>Spacing · {ds.spacing.base} a step</Heading>
      {prose("Layout")}
      <div className="flex flex-col gap-1 px-3 py-2">
        {SPACING_SAMPLE.map((step) => (
          <div className="flex items-center gap-2" key={step}>
            <span className="w-14 shrink-0 font-code text-muted-foreground">
              {step} · {step * base}px
            </span>
            <span
              className="h-2 rounded-sm bg-brand/60"
              style={{ width: step * base }}
            />
          </div>
        ))}
        {tokensOfKind(ds, "spacing").map((t) => (
          // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/noNoninteractiveElementInteractions: a shortcut for the pointer; the inspector's fields take the same tokens.
          <div
            className="flex items-center gap-2"
            key={t.name}
            onContextMenu={(e) =>
              openMenuAt(e, {
                kind: "token",
                name: t.name,
                tokenKind: "spacing",
                value: t.value,
              })
            }
          >
            <span className="w-14 shrink-0 truncate font-code text-muted-foreground">
              {t.name}
            </span>
            <span
              className="h-2 rounded-sm bg-brand/60"
              style={{ width: t.value }}
            />
          </div>
        ))}
      </div>
      {radius.length > 0 && (
        <>
          <Heading>Radius</Heading>
          {prose("Shapes")}
          <TokenRows
            kind="radius"
            preview={(t) => (
              <span
                className="size-7 border-2 border-foreground/40 bg-muted"
                style={{ borderRadius: t.value }}
              />
            )}
            tokens={radius}
          />
        </>
      )}
      {shadows.length > 0 && (
        <>
          <Heading>Shadows</Heading>
          <TokenRows
            kind="shadow"
            preview={(t) => (
              <span
                className="size-7 rounded-md bg-white"
                style={{ boxShadow: t.value }}
              />
            )}
            tokens={shadows}
          />
        </>
      )}
      <MoreFoundations document={document} ds={ds} q={q} theme={theme} />
    </>
  );
};

/** Elevation, border widths, layout, motion and icons: what a design system may also name. */
const MoreFoundations = ({
  document,
  ds,
  q,
  theme,
}: {
  document: DesignDocument | null;
  ds: DesignSystem;
  q: string;
  theme: string;
}) => {
  const filter = (kind: TokenKind) =>
    tokensOfKind(ds, kind).filter((t) => matches(t, q));
  const levels = (ds.elevation ?? []).filter(
    (l) => !q || l.name.toLowerCase().includes(q)
  );
  const borderWidths = filter("borderWidth");
  const breakpoints = filter("breakpoint");
  const containers = filter("container");
  const easings = filter("easing");
  const durations = filter("duration");
  const animations = filter("animation");
  const motion = [...easings, ...durations, ...animations];
  return (
    <>
      {levels.length > 0 && (
        <>
          <Heading>Elevation</Heading>
          {q ? null : (
            <SectionProse document={document} name="Elevation & Depth" />
          )}
          <ElevationRows ds={ds} levels={levels} theme={theme} />
        </>
      )}
      {borderWidths.length > 0 && (
        <>
          <Heading>Border widths</Heading>
          <TokenRows
            kind="borderWidth"
            preview={(t) => (
              <span
                className="size-7 rounded-md border-foreground/60 bg-muted"
                style={{ borderStyle: "solid", borderWidth: t.value }}
              />
            )}
            tokens={borderWidths}
          />
        </>
      )}
      {breakpoints.length + containers.length > 0 && (
        <>
          <Heading>Layout</Heading>
          {breakpoints.length > 0 && (
            <TokenRows
              kind="other"
              preview={(t) => (
                <LengthBar max={widest(breakpoints)} value={t.value} />
              )}
              tokens={breakpoints}
            />
          )}
          {containers.length > 0 && (
            <TokenRows
              kind="container"
              preview={(t) => (
                <LengthBar max={widest(containers)} value={t.value} />
              )}
              tokens={containers}
            />
          )}
        </>
      )}
      {motion.length > 0 && (
        <>
          <Heading>Motion</Heading>
          <TokenRows
            kind="other"
            preview={() => <span className="text-muted-foreground">~</span>}
            tokens={motion}
          />
        </>
      )}
      {ds.icons && !q && (
        <>
          <Heading>Icons</Heading>
          <div className="flex flex-col gap-0.5 px-3 py-2 font-body">
            {ds.icons.from !== undefined && (
              <span className="font-mono">{ds.icons.from}</span>
            )}
            {ds.icons.sizes && ds.icons.sizes.length > 0 && (
              <span className="text-muted-foreground">
                {ds.icons.sizes.map((s) => `${s}px`).join(" · ")}
              </span>
            )}
            {ds.icons.description !== undefined && (
              <span className="text-muted-foreground">
                {ds.icons.description}
              </span>
            )}
          </div>
        </>
      )}
    </>
  );
};

export const DesignSystemPanel = () => {
  const configured = useProject((s) => s.info.configured);
  const designSystem = useDesignSystem((s) => s.designSystem);
  const document = useDesignSystem((s) => s.document);
  const problem = useDesignSystem((s) => s.problem);
  const notes = useDesignSystem((s) => s.notes);
  const loaded = useDesignSystem((s) => s.loaded);
  const detecting = useDesignSystem((s) => s.detecting);
  const [q, setQuery] = useState("");
  const [tab, setTab] = useState<"tokens" | "components" | "notes">("tokens");
  const themes = designSystem?.themes ?? ["light"];
  const [theme, setTheme] = useState(themes[0] ?? "light");
  const setupShown = useDesignSystemSetup((s) => s.shown);
  // A Figma file imported already: the way on is the sync it started.
  const figma = useSync((s) => s.plan?.facts.figma);
  const showSetup = useDesignSystemSetup((s) => s.show);

  useEffect(() => {
    if (configured && !loaded) {
      useDesignSystem.getState().load();
    }
  }, [configured, loaded]);

  if (!configured) {
    return <SetupEmpty />;
  }
  if (!loaded) {
    return <PanelEmpty>Reading the design system…</PanelEmpty>;
  }
  if (setupShown) {
    return (
      <SyncView onBack={designSystem ? () => showSetup(false) : undefined} />
    );
  }
  if (!designSystem) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <Sparkles className="size-6 text-brand" />
        <div className="flex flex-col gap-1">
          <span className="font-medium">No design system yet</span>
          <span className="font-body text-muted-foreground">
            {problem ??
              "Start from a Figma file, and its variables and styles become your tokens. Or sync from the code: it reads your theme and components, and makes one from what the code uses."}
          </span>
        </div>
        {figma ? (
          <Button onClick={() => showSetup(true)} size="sm">
            <RefreshCw />
            Continue with {figma.name}
          </Button>
        ) : (
          <Button onClick={pickFigmaFile} size="sm">
            <FileUp />
            Import a Figma file…
          </Button>
        )}
        <Button onClick={() => showSetup(true)} size="sm" variant="outline">
          <RefreshCw />
          Sync from the code
        </Button>
        <Button
          disabled={detecting}
          onClick={() => useDesignSystem.getState().detect()}
          size="sm"
          variant="ghost"
        >
          Detect automatically
        </Button>
      </div>
    );
  }

  const q2 = q.trim().toLowerCase();
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b px-2 py-1.5">
        <InputGroup>
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tokens…"
            value={q}
          />
        </InputGroup>
        <IconButton
          onClick={() => showSetup(true)}
          tooltip="Sync the design system and the code"
        >
          <RefreshCw />
        </IconButton>
        <IconButton onClick={startInit} tooltip="Re-run /init with an agent">
          <Wand2 />
        </IconButton>
      </div>
      <div className="flex items-center gap-2 border-b px-2 py-1.5">
        <div className="w-60">
          <Segmented
            onChange={setTab}
            options={[
              { label: "Tokens", value: "tokens" },
              { label: "Components", value: "components" },
              { label: "DESIGN.md", value: "notes" },
            ]}
            value={tab}
          />
        </div>
        {themes.length > 1 && tab === "tokens" && (
          <div className="ml-auto w-28">
            <Segmented
              onChange={setTheme}
              options={themes.map((t) => ({ label: t, value: t }))}
              value={theme}
            />
          </div>
        )}
      </div>
      {problem ? (
        <div className="border-b px-3 py-1.5 font-body text-destructive">
          {problem}
        </div>
      ) : null}
      {notes && notes.length > 0 ? (
        <ul className="max-h-24 overflow-auto border-b px-3 py-1.5 font-body text-muted-foreground">
          {notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto">
        {tab === "tokens" ? (
          <Contents
            document={document}
            ds={designSystem}
            q={q2}
            theme={theme}
          />
        ) : null}
        {tab === "components" ? <ComponentsView q={q2} /> : null}
        {tab === "notes" ? <DesignMdView document={document} /> : null}
      </div>
      {designSystem.source ? (
        <div
          className="flex items-center gap-1 truncate border-t px-3 py-1 font-body text-muted-foreground"
          title={designSystem.source}
        >
          <Check className="size-3 shrink-0" />
          <span className="truncate">{designSystem.source}</span>
        </div>
      ) : null}
    </div>
  );
};
