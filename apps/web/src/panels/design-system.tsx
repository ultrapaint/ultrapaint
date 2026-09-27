/**
 * What the project's design system is, as `/init` imported it: colours, typography, spacing,
 * radii and shadows, and the conventions in DESIGN.md. Typography is drawn by the preview itself,
 * with the repository's stylesheet, because the editor does not load the design system's fonts.
 * With nothing imported yet, this is where init starts.
 */
import {
  type DesignSystem,
  type FontSizeToken,
  TEXT_STYLE_GROUPS,
  type TextStyle,
  type Token,
  type TokenGroup,
} from "@ultrapaint/contracts/design-system";
import type { DesignNode } from "@ultrapaint/contracts/document";
import { groupTextStyles } from "@ultrapaint/design-document/text-styles";
import { tokenRef, toPixels } from "@ultrapaint/design-document/tokens";
import { Check, RefreshCw, Search, Sparkles, Wand2 } from "lucide-react";
import type * as React from "react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { bridgeFor, removeBridge } from "../canvas/bridge.ts";
import { useHostUrl } from "../canvas/frame.tsx";
import { IconButton } from "../components/icon-button.tsx";
import { Markdown } from "../components/markdown.tsx";
import { PanelEmpty } from "../components/panel.tsx";
import { Segmented } from "../components/segmented.tsx";
import { startCommand } from "../lib/start-thread.ts";
import { useDesignSystem } from "../state/design-system.ts";
import { useProject } from "../state/project.ts";

/** Opens a thread with `/init` in its composer, for the user to send. */
export const startInit = () => startCommand("/init");

const COLOR_PREFIX_RE = /^color-/;

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
  <div className="sticky top-0 z-10 flex items-center border-b bg-sidebar px-3 py-1.5 font-medium text-[11px]">
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
    <div className="mb-1.5 text-[10px] text-muted-foreground uppercase">
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
            title={`${token.name}: ${value}${token.description ? `\n${token.description}` : ""}\nbg-${token.name.replace(COLOR_PREFIX_RE, "")}`}
            type="button"
          >
            <span className="h-9 w-full" style={{ background: value }} />
            <span className="truncate px-1 pt-0.5 text-[10px] text-foreground/90">
              {token.name.replace(COLOR_PREFIX_RE, "")}
            </span>
            <span className="truncate px-1 pb-0.5 font-mono text-[9px] text-muted-foreground">
              {value}
            </span>
          </button>
        );
      })}
    </div>
  </div>
);

/** The type samples, drawn by the preview with the repository's own fonts. */
const typeSpecimen = (ds: DesignSystem, q: string): DesignNode => {
  const styles = ds.typography.styles.filter((s) =>
    matches({ name: s.name, value: "" }, q)
  );
  const sizes = ds.typography.sizes.filter((s) => matches(s, q));
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

const TypeSpecimen = ({ ds, q }: { ds: DesignSystem; q: string }) => {
  const host = useHostUrl();
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(120);
  const [ready, setReady] = useState(false);
  const frame = "design-system:typography";
  useEffect(() => {
    const iframe = ref.current;
    if (!(iframe && host)) {
      return;
    }
    const bridge = bridgeFor(frame);
    bridge.attach(iframe);
    const off = bridge.on((msg) => {
      if (msg.type === "ed:ready") {
        setReady(true);
      }
      if (msg.type === "ed:size") {
        setHeight(msg.height);
      }
    });
    return () => {
      off();
      removeBridge(frame);
      setReady(false);
    };
  }, [host]);
  useEffect(() => {
    if (ready) {
      bridgeFor(frame).render({
        designSystem: ds,
        mode: "fit",
        root: typeSpecimen(ds, q),
      });
    }
  }, [ready, ds, q]);
  if (!host) {
    return (
      <div className="px-3 py-2 text-[11px] text-muted-foreground">
        The preview is not running; type samples are drawn by it.
      </div>
    );
  }
  return (
    <div className="overflow-hidden px-3 py-2">
      <div className="overflow-hidden rounded-md border bg-white">
        <iframe
          className="pointer-events-none block w-full origin-top-left border-0"
          ref={ref}
          src={`${host}/?frame=${encodeURIComponent(frame)}`}
          style={{ height }}
          title="Type samples"
        />
      </div>
    </div>
  );
};

const TokenRows = ({
  tokens,
  preview,
}: {
  tokens: readonly Token[];
  preview: (token: Token) => React.ReactNode;
}) => (
  <div className="flex flex-col py-1">
    {tokens.map((token) => (
      <button
        className="flex items-center gap-2 px-3 py-1 text-left hover:bg-muted/50"
        key={token.name}
        onClick={() => copy(tokenRef(token.name))}
        title={`Copy $${token.name}`}
        type="button"
      >
        <span className="flex w-14 shrink-0 justify-center">
          {preview(token)}
        </span>
        <span className="min-w-0 flex-1 truncate text-[11px]">
          {token.name}
        </span>
        <span className="truncate font-mono text-[10px] text-muted-foreground">
          {token.value}
        </span>
      </button>
    ))}
  </div>
);

const SPACING_SAMPLE = [1, 2, 3, 4, 6, 8, 12, 16];

const Notes = ({ notes }: { notes: string | null }) =>
  notes ? (
    <div className="px-3 py-2">
      <Markdown>{notes}</Markdown>
    </div>
  ) : (
    <div className="flex flex-col items-start gap-2 p-3 text-[11px] text-muted-foreground">
      No DESIGN.md yet: the conventions an agent writes during /init.
      <Button onClick={startInit} size="sm" variant="outline">
        <Wand2 />
        Run /init
      </Button>
    </div>
  );

const Contents = ({
  ds,
  q,
  theme,
}: {
  ds: DesignSystem;
  q: string;
  theme: string;
}) => {
  const themes = ds.themes ?? ["light"];
  const groups = ds.colors
    .map((g) => ({ ...g, tokens: g.tokens.filter((t) => matches(t, q)) }))
    .filter((g) => g.tokens.length > 0);
  const base = toPixels(ds.spacing.base) ?? 4;
  const radius = ds.radius.filter((t) => matches(t, q));
  const shadows = ds.shadows.filter((t) => matches(t, q));
  const fonts = ds.typography.fonts.filter((t) => matches(t, q));
  return (
    <>
      <Heading>Colours</Heading>
      {groups.length === 0 ? (
        <div className="px-3 py-2 text-[11px] text-muted-foreground">
          No colours
        </div>
      ) : (
        groups.map((g) => (
          <Swatches group={g} key={g.name} theme={theme} themes={themes} />
        ))
      )}
      <Heading>Typography</Heading>
      <TypeSpecimen ds={ds} q={q} />
      {fonts.length > 0 && (
        <TokenRows
          preview={() => <span className="text-muted-foreground">Aa</span>}
          tokens={fonts}
        />
      )}
      <Heading>Spacing · {ds.spacing.base} a step</Heading>
      <div className="flex flex-col gap-1 px-3 py-2">
        {SPACING_SAMPLE.map((step) => (
          <div className="flex items-center gap-2" key={step}>
            <span className="w-14 shrink-0 font-mono text-[10px] text-muted-foreground">
              {step} · {step * base}px
            </span>
            <span
              className="h-2 rounded-sm bg-brand/60"
              style={{ width: step * base }}
            />
          </div>
        ))}
        {(ds.spacing.tokens ?? []).map((t) => (
          <div className="flex items-center gap-2" key={t.name}>
            <span className="w-14 shrink-0 truncate font-mono text-[10px] text-muted-foreground">
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
          <TokenRows
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
    </>
  );
};

export const DesignSystemPanel = () => {
  const configured = useProject((s) => s.info.configured);
  const { designSystem, notes, problem, loaded, detecting } = useDesignSystem();
  const [q, setQuery] = useState("");
  const [tab, setTab] = useState<"tokens" | "notes">("tokens");
  const themes = designSystem?.themes ?? ["light"];
  const [theme, setTheme] = useState(themes[0] ?? "light");

  useEffect(() => {
    if (configured && !loaded) {
      useDesignSystem.getState().load();
    }
  }, [configured, loaded]);

  if (!configured) {
    return <PanelEmpty>Configure a repository first</PanelEmpty>;
  }
  if (!loaded) {
    return <PanelEmpty>Reading the design system…</PanelEmpty>;
  }
  if (!designSystem) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <Sparkles className="size-6 text-brand" />
        <div className="flex flex-col gap-1">
          <span className="font-medium">No design system imported yet</span>
          <span className="text-[11px] text-muted-foreground">
            {problem ??
              "An agent reads the repository's Tailwind v4 theme and components, asks you what it cannot find out, and writes design-system.json and DESIGN.md."}
          </span>
        </div>
        <Button onClick={startInit} size="sm">
          <Wand2 />
          Initialise with an agent
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
        <IconButton onClick={startInit} tooltip="Re-run /init with an agent">
          <RefreshCw />
        </IconButton>
      </div>
      <div className="flex items-center gap-2 border-b px-2 py-1.5">
        <div className="w-36">
          <Segmented
            onChange={setTab}
            options={[
              { label: "Tokens", value: "tokens" },
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
        <div className="border-b px-3 py-1.5 text-[11px] text-destructive">
          {problem}
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto">
        {tab === "tokens" ? (
          <Contents ds={designSystem} q={q2} theme={theme} />
        ) : (
          <Notes notes={notes} />
        )}
      </div>
      {designSystem.source ? (
        <div
          className="flex items-center gap-1 truncate border-t px-3 py-1 text-[10px] text-muted-foreground"
          title={designSystem.source}
        >
          <Check className="size-3 shrink-0" />
          <span className="truncate">{designSystem.source}</span>
        </div>
      ) : null}
    </div>
  );
};
