import type { ElementSource, InspectResult, JsonValue, StyleValue } from "@ultrapaint/contracts";
import {
  arbitrary,
  fontSizeScale,
  fontWeightScale,
  leadingScale,
  propertyToUtility,
  pxToSpacing,
  radiusScale,
  shadowScale,
  trackingScale,
} from "@ultrapaint/shared";
import {
  AlignCenter,
  AlignHorizontalJustifyCenter,
  AlignHorizontalJustifyEnd,
  AlignHorizontalJustifyStart,
  AlignHorizontalSpaceBetween,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowRight,
  ChevronRight,
  Lock,
  StretchHorizontal,
} from "lucide-react";
import * as React from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { bridgeFor } from "../canvas/bridge.ts";
import { promptDialog } from "../components/dialogs.tsx";
import { OptionSelect } from "../components/option-select.tsx";
import { PanelEmpty, Row, Section } from "../components/panel.tsx";
import { Segmented } from "../components/segmented.tsx";
import { runEdit } from "../lib/shortcuts.ts";
import { cn } from "../lib/utils.ts";
import { api } from "../state/connection.ts";
import { useEditor } from "../state/editor.ts";
import { ComponentProps } from "./ComponentProps.tsx";

const px = (v: string | undefined) => {
  if (!v) return "";
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? String(Math.round(n * 100) / 100) : v;
};

const Prov = ({ s }: { s: StyleValue | undefined }) => {
  if (!s) return null;
  const p = s.provenance;
  const label =
    p.kind === "utility" || p.kind === "component"
      ? p.className
      : p.kind === "token"
        ? p.token
        : p.kind;
  return (
    <Badge
      variant={p.kind === "inline" ? "destructive" : p.kind === "component" ? "secondary" : "ghost"}
      title={`${p.kind}${p.token ? ` · ${p.token}` : ""}${p.className ? ` · .${p.className}` : ""}`}
      className={cn(
        "block h-4 max-w-[88px] truncate rounded-sm px-1 font-mono text-[9px] leading-4",
        p.kind === "utility" && "bg-brand/20 text-brand",
        (p.kind === "inherited" || p.kind === "default") && "text-muted-foreground",
      )}
    >
      {label}
    </Badge>
  );
};

/** Number field for a CSS px value that writes a Tailwind class on commit. */
const PxField = ({
  prop,
  styles,
  onClass,
  disabled,
  short,
}: {
  prop: string;
  styles: Record<string, StyleValue>;
  onClass: (add: string[], remove: string[]) => void;
  disabled: boolean;
  short?: string;
}) => {
  const s = styles[prop];
  const [draft, setDraft] = React.useState<string | null>(null);
  const util = propertyToUtility[prop];
  const commit = () => {
    if (draft === null || !util) return;
    const v = draft.trim();
    setDraft(null);
    if (v === "" || v === px(s?.value)) return;
    const cls = classForValue(util, v);
    if (cls) onClass([cls], removalFor(s));
  };
  return (
    <InputGroup
      className="h-6 min-w-0 flex-1"
      data-disabled={disabled}
      title={`${prop}: ${s?.value ?? ""}`}
    >
      {short && (
        <InputGroupAddon className="w-5 py-0 pl-1.5 font-normal text-[10px]">
          {short}
        </InputGroupAddon>
      )}
      <InputGroupInput
        className="h-full px-1.5 md:text-[11px]"
        disabled={disabled}
        value={draft ?? px(s?.value)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") setDraft(null);
          if ((e.key === "ArrowUp" || e.key === "ArrowDown") && !disabled) {
            e.preventDefault();
            const n = Number.parseFloat(draft ?? px(s?.value)) || 0;
            const step = e.shiftKey ? 10 : e.altKey ? 1 : 4;
            const next = Math.max(0, n + (e.key === "ArrowUp" ? step : -step));
            const cls = util ? classForValue(util, String(next)) : null;
            if (cls) onClass([cls], removalFor(s));
          }
        }}
      />
    </InputGroup>
  );
};

const removalFor = (s: StyleValue | undefined): string[] =>
  s?.provenance.kind === "utility" && s.provenance.className ? [s.provenance.className] : [];

const classForValue = (util: { prefix: string; scale?: string }, raw: string): string | null => {
  const v = raw.trim();
  if (v === "auto") return `${util.prefix}-auto`;
  if (v === "full" || v === "100%") return `${util.prefix}-full`;
  if (v === "screen") return `${util.prefix}-screen`;
  if (v === "fit" || v === "fit-content") return `${util.prefix}-fit`;
  if (v === "none") return `${util.prefix}-none`;
  const n = Number.parseFloat(v);
  if (!Number.isFinite(n)) return arbitrary(util.prefix, v);
  if (util.scale === "spacing" || util.scale === "width" || util.scale === "height") {
    const step = pxToSpacing(n);
    if (step !== null) return `${util.prefix}-${step}`;
    return arbitrary(util.prefix, `${n}px`);
  }
  if (util.scale === "font-size" || util.scale === "leading" || util.scale === "tracking")
    return arbitrary(util.prefix, `${n}px`);
  if (util.scale === "font-weight") return arbitrary(util.prefix, String(n));
  if (util.scale === "opacity") return `${util.prefix}-${Math.round(n)}`;
  if (util.prefix === "border") return n === 1 ? "border" : `border-${Math.round(n)}`;
  return arbitrary(util.prefix, `${n}px`);
};

const useTokenOptions = (kind: "color" | "font") => {
  const tokens = useEditor((s) => s.tokens);
  return React.useMemo(() => {
    const out: { value: string; label: string; preview?: React.ReactNode }[] = [];
    for (const [name, value] of Object.entries(tokens)) {
      if (kind === "color" && (name.startsWith("--ds-") || name.startsWith("--color-"))) {
        const util = name.replace(/^--(ds|color)-/, "");
        if (!/\d|^(foreground|muted|background|border|surface|brand|solid)/.test(util)) continue;
        if (out.find((o) => o.value === util)) continue;
        out.push({
          value: util,
          label: util,
          preview: (
            <span
              className="size-3 shrink-0 rounded-sm border border-input"
              style={{ background: value }}
            />
          ),
        });
      }
      if (kind === "font" && name.startsWith("--font-") && !name.includes("--")) {
        const util = name.replace(/^--font-/, "");
        if (!name.slice(7).includes("--"))
          out.push({ value: util, label: `${util} · ${value.split(",")[0]?.replaceAll('"', "")}` });
      }
    }
    return out.sort((a, b) => a.value.localeCompare(b.value));
  }, [tokens, kind]);
};

const ColorField = ({
  prop,
  prefix,
  styles,
  onClass,
  disabled,
}: {
  prop: string;
  prefix: string;
  styles: Record<string, StyleValue>;
  onClass: (add: string[], remove: string[]) => void;
  disabled: boolean;
}) => {
  const s = styles[prop];
  const options = useTokenOptions("color");
  const current = s?.provenance.className?.startsWith(`${prefix}-`)
    ? s.provenance.className.slice(prefix.length + 1)
    : null;
  const recent = useRecent("color");
  const ordered = [
    ...recent
      .filter((r) => options.find((o) => o.value === r))
      .map((r) => options.find((o) => o.value === r) as (typeof options)[number]),
    ...options.filter((o) => !recent.includes(o.value)),
  ];
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      <span
        className="size-5 shrink-0 rounded-sm border border-input"
        style={{ background: s?.value }}
      />
      <OptionSelect
        disabled={disabled}
        size="sm"
        value={current}
        placeholder={s?.value ?? "—"}
        options={[...ordered, { value: "__custom", label: "Custom…" }]}
        onChange={(v) => {
          if (v === "__custom") {
            void promptDialog({
              title: "Custom colour",
              description: `Any CSS colour value. It is written as an arbitrary ${prefix}-[…] class.`,
              defaultValue: s?.value ?? "#000000",
            }).then((hex) => {
              if (hex) onClass([arbitrary(prefix, hex)], removalFor(s));
            });
            return;
          }
          recent.push(v);
          onClass([`${prefix}-${v}`], removalFor(s));
        }}
      />
    </div>
  );
};

const recents: Record<string, string[]> = {};
const useRecent = (key: string) => {
  if (!recents[key]) {
    recents[key] = JSON.parse(
      localStorage.getItem(`ultrapaint:recent:${key}`) ?? "[]",
    ) as string[];
  }
  const list = recents[key] as string[];
  return Object.assign(list, {
    push: (v: string) => {
      const idx = list.indexOf(v);
      if (idx >= 0) list.splice(idx, 1);
      list.unshift(v);
      list.splice(6);
      localStorage.setItem(`ultrapaint:recent:${key}`, JSON.stringify(list));
    },
  });
};

const ScaleSelect = ({
  prop,
  prefix,
  scale,
  styles,
  onClass,
  disabled,
  labels,
}: {
  prop: string;
  prefix: string;
  scale: readonly string[];
  styles: Record<string, StyleValue>;
  onClass: (add: string[], remove: string[]) => void;
  disabled: boolean;
  labels?: (v: string) => string;
}) => {
  const s = styles[prop];
  const cls = s?.provenance.className;
  const current = cls?.startsWith(`${prefix}-`)
    ? cls.slice(prefix.length + 1)
    : cls === prefix
      ? ""
      : null;
  return (
    <OptionSelect
      disabled={disabled}
      size="sm"
      value={current}
      placeholder={px(s?.value) || "—"}
      options={[
        ...scale.map((v) => ({ value: v, label: labels ? labels(v) : v })),
        { value: "__custom", label: "Custom…" },
      ]}
      onChange={(v) => {
        if (v === "__custom") {
          void promptDialog({
            title: `Custom ${prop}`,
            description: "A px number or any CSS value.",
            defaultValue: px(s?.value),
          }).then((raw) => {
            const util = propertyToUtility[prop];
            if (!raw || !util) return;
            const c = classForValue(util, raw);
            if (c) onClass([c], removalFor(s));
          });
          return;
        }
        onClass([v === "" ? prefix : `${prefix}-${v}`], removalFor(s));
      }}
    />
  );
};

export const Inspector = () => {
  const selection = useEditor((s) => s.selection);
  const inspect = useEditor((s) => s.inspect);
  const tree = useEditor((s) => (selection ? s.trees[selection.screenId] : undefined));
  const [source, setSource] = React.useState<ElementSource | null>(null);
  const requestSeq = React.useRef(0);

  // Load inspection + source whenever selection or tree changes (tree changes after HMR).
  React.useEffect(() => {
    if (!selection) {
      useEditor.getState().setInspect(null);
      setSource(null);
      return;
    }
    const seq = ++requestSeq.current;
    const bridge = bridgeFor(selection.screenId);
    void bridge.inspect(selection.nodeId).then((r) => {
      if (seq === requestSeq.current) useEditor.getState().setInspect(r);
    });
    if (selection.source) {
      api()
        .request("source.element", selection.source)
        .then((s) => {
          if (seq === requestSeq.current) setSource(s);
        })
        .catch(() => setSource(null));
    } else setSource(null);
  }, [selection, tree]);

  if (!selection)
    return <PanelEmpty>Select an element on the canvas or in the layers panel</PanelEmpty>;
  if (!inspect) return <PanelEmpty>Inspecting…</PanelEmpty>;

  const editable = inspect.editable && !!selection.source;
  const onClass = (add: string[], remove: string[]) => {
    if (!selection.source) return;
    void runEdit({ kind: "setClasses", target: selection.source, add, remove });
  };
  const setAttr = (name: string, value: JsonValue) => {
    if (!selection.source) return;
    void runEdit({ kind: "setAttribute", target: selection.source, name, value });
  };
  const styles = inspect.styles;

  return (
    <div className="flex flex-col pb-8">
      <Header inspect={inspect} source={source} />
      {!editable && <NotEditable inspect={inspect} />}
      {inspect.kind === "component" && (
        <ComponentProps inspect={inspect} source={source} onSet={setAttr} disabled={!editable} />
      )}

      <Section title="Layout">
        <Row label="Display">
          <div className="flex min-w-0 flex-1 items-center gap-1">
            <OptionSelect
              disabled={!editable}
              size="sm"
              value={styles.display?.value ?? null}
              options={[
                "block",
                "flex",
                "inline-flex",
                "grid",
                "inline",
                "inline-block",
                "none",
                "contents",
              ].map((v) => ({ value: v, label: v }))}
              onChange={(v) => onClass([v === "none" ? "hidden" : v], removalFor(styles.display))}
            />
            <Prov s={styles.display} />
          </div>
        </Row>
        {(styles.display?.value.includes("flex") || styles.display?.value.includes("grid")) && (
          <>
            <Row label="Direction">
              <Segmented
                value={styles["flex-direction"]?.value ?? null}
                options={[
                  { value: "row", label: <ArrowRight className="size-3" />, title: "row" },
                  { value: "column", label: <ArrowDown className="size-3" />, title: "column" },
                ]}
                onChange={(v) =>
                  onClass(
                    [v === "row" ? "flex-row" : "flex-col"],
                    removalFor(styles["flex-direction"]),
                  )
                }
                disabled={!editable}
              />
              <Segmented
                value={styles["flex-wrap"]?.value ?? null}
                options={[
                  { value: "nowrap", label: "no wrap" },
                  { value: "wrap", label: "wrap" },
                ]}
                onChange={(v) =>
                  onClass(
                    [v === "wrap" ? "flex-wrap" : "flex-nowrap"],
                    removalFor(styles["flex-wrap"]),
                  )
                }
                disabled={!editable}
              />
            </Row>
            <Row label="Align">
              <Segmented
                value={styles["align-items"]?.value ?? null}
                options={[
                  {
                    value: "flex-start",
                    label: <AlignHorizontalJustifyStart className="size-3 rotate-90" />,
                    title: "start",
                  },
                  {
                    value: "center",
                    label: <AlignHorizontalJustifyCenter className="size-3 rotate-90" />,
                    title: "center",
                  },
                  {
                    value: "flex-end",
                    label: <AlignHorizontalJustifyEnd className="size-3 rotate-90" />,
                    title: "end",
                  },
                  {
                    value: "stretch",
                    label: <StretchHorizontal className="size-3" />,
                    title: "stretch",
                  },
                ]}
                onChange={(v) =>
                  onClass(
                    [
                      {
                        "flex-start": "items-start",
                        center: "items-center",
                        "flex-end": "items-end",
                        stretch: "items-stretch",
                      }[v] as string,
                    ],
                    removalFor(styles["align-items"]),
                  )
                }
                disabled={!editable}
              />
            </Row>
            <Row label="Justify">
              <Segmented
                value={styles["justify-content"]?.value ?? null}
                options={[
                  {
                    value: "flex-start",
                    label: <AlignHorizontalJustifyStart className="size-3" />,
                    title: "start",
                  },
                  {
                    value: "center",
                    label: <AlignHorizontalJustifyCenter className="size-3" />,
                    title: "center",
                  },
                  {
                    value: "flex-end",
                    label: <AlignHorizontalJustifyEnd className="size-3" />,
                    title: "end",
                  },
                  {
                    value: "space-between",
                    label: <AlignHorizontalSpaceBetween className="size-3" />,
                    title: "between",
                  },
                ]}
                onChange={(v) =>
                  onClass(
                    [
                      {
                        "flex-start": "justify-start",
                        center: "justify-center",
                        "flex-end": "justify-end",
                        "space-between": "justify-between",
                      }[v] as string,
                    ],
                    removalFor(styles["justify-content"]),
                  )
                }
                disabled={!editable}
              />
            </Row>
            <Row label="Gap">
              <PxField
                prop="row-gap"
                short="↕"
                styles={styles}
                onClass={onClass}
                disabled={!editable}
              />
              <PxField
                prop="column-gap"
                short="↔"
                styles={styles}
                onClass={onClass}
                disabled={!editable}
              />
              <Prov s={styles["row-gap"]} />
            </Row>
          </>
        )}
      </Section>

      <Section title="Size">
        <Row label="Size">
          <PxField prop="width" short="W" styles={styles} onClass={onClass} disabled={!editable} />
          <PxField prop="height" short="H" styles={styles} onClass={onClass} disabled={!editable} />
        </Row>
        <Row label="Min">
          <PxField
            prop="min-width"
            short="W"
            styles={styles}
            onClass={onClass}
            disabled={!editable}
          />
          <PxField
            prop="min-height"
            short="H"
            styles={styles}
            onClass={onClass}
            disabled={!editable}
          />
        </Row>
        <Row label="Max">
          <PxField
            prop="max-width"
            short="W"
            styles={styles}
            onClass={onClass}
            disabled={!editable}
          />
          <PxField
            prop="max-height"
            short="H"
            styles={styles}
            onClass={onClass}
            disabled={!editable}
          />
        </Row>
        <div className="flex gap-1 pl-[72px]">
          <Prov s={styles.width} />
          <Prov s={styles.height} />
        </div>
      </Section>

      <Section title="Spacing">
        <Row label="Padding">
          <PxField
            prop="padding-top"
            short="T"
            styles={styles}
            onClass={onClass}
            disabled={!editable}
          />
          <PxField
            prop="padding-right"
            short="R"
            styles={styles}
            onClass={onClass}
            disabled={!editable}
          />
        </Row>
        <Row label="">
          <PxField
            prop="padding-bottom"
            short="B"
            styles={styles}
            onClass={onClass}
            disabled={!editable}
          />
          <PxField
            prop="padding-left"
            short="L"
            styles={styles}
            onClass={onClass}
            disabled={!editable}
          />
        </Row>
        <div className="flex flex-wrap gap-1 pl-[72px]">
          <Prov s={styles["padding-top"]} />
          {styles["padding-left"]?.provenance.className !==
            styles["padding-top"]?.provenance.className && <Prov s={styles["padding-left"]} />}
        </div>
        <Row label="Margin">
          <PxField
            prop="margin-top"
            short="T"
            styles={styles}
            onClass={onClass}
            disabled={!editable}
          />
          <PxField
            prop="margin-right"
            short="R"
            styles={styles}
            onClass={onClass}
            disabled={!editable}
          />
        </Row>
        <Row label="">
          <PxField
            prop="margin-bottom"
            short="B"
            styles={styles}
            onClass={onClass}
            disabled={!editable}
          />
          <PxField
            prop="margin-left"
            short="L"
            styles={styles}
            onClass={onClass}
            disabled={!editable}
          />
        </Row>
        <div className="flex gap-1 pl-[72px]">
          <Prov s={styles["margin-top"]} />
        </div>
      </Section>

      <Section title="Typography">
        <Row label="Family">
          <FontSelect styles={styles} onClass={onClass} disabled={!editable} />
        </Row>
        <Row label="Size">
          <ScaleSelect
            prop="font-size"
            prefix="text"
            scale={fontSizeScale}
            styles={styles}
            onClass={onClass}
            disabled={!editable}
            labels={(v) => `${v} · ${px(styles["font-size"]?.value) ? "" : ""}${v}`}
          />
          <Prov s={styles["font-size"]} />
        </Row>
        <Row label="Weight">
          <ScaleSelect
            prop="font-weight"
            prefix="font"
            scale={fontWeightScale}
            styles={styles}
            onClass={onClass}
            disabled={!editable}
          />
          <Prov s={styles["font-weight"]} />
        </Row>
        <Row label="Line height">
          <ScaleSelect
            prop="line-height"
            prefix="leading"
            scale={leadingScale}
            styles={styles}
            onClass={onClass}
            disabled={!editable}
          />
          <Prov s={styles["line-height"]} />
        </Row>
        <Row label="Tracking">
          <ScaleSelect
            prop="letter-spacing"
            prefix="tracking"
            scale={trackingScale}
            styles={styles}
            onClass={onClass}
            disabled={!editable}
          />
          <Prov s={styles["letter-spacing"]} />
        </Row>
        <Row label="Align">
          <Segmented
            value={styles["text-align"]?.value ?? null}
            options={[
              { value: "start", label: <AlignLeft className="size-3" /> },
              { value: "center", label: <AlignCenter className="size-3" /> },
              { value: "end", label: <AlignRight className="size-3" /> },
            ]}
            onChange={(v) =>
              onClass(
                [{ start: "text-left", center: "text-center", end: "text-right" }[v] as string],
                removalFor(styles["text-align"]),
              )
            }
            disabled={!editable}
          />
        </Row>
      </Section>

      <Section title="Colour">
        <Row label="Text">
          <ColorField
            prop="color"
            prefix="text"
            styles={styles}
            onClass={onClass}
            disabled={!editable}
          />
          <Prov s={styles.color} />
        </Row>
        <Row label="Background">
          <ColorField
            prop="background-color"
            prefix="bg"
            styles={styles}
            onClass={onClass}
            disabled={!editable}
          />
          <Prov s={styles["background-color"]} />
        </Row>
      </Section>

      <Section title="Border">
        <Row label="Width">
          <ScaleSelect
            prop="border-top-width"
            prefix="border"
            scale={["0", "", "2", "4", "8"]}
            styles={styles}
            onClass={onClass}
            disabled={!editable}
            labels={(v) => (v === "" ? "1" : v)}
          />
          <Prov s={styles["border-top-width"]} />
        </Row>
        <Row label="Colour">
          <ColorField
            prop="border-top-color"
            prefix="border"
            styles={styles}
            onClass={onClass}
            disabled={!editable}
          />
        </Row>
        <Row label="Radius">
          <ScaleSelect
            prop="border-top-left-radius"
            prefix="rounded"
            scale={radiusScale}
            styles={styles}
            onClass={onClass}
            disabled={!editable}
          />
          <Prov s={styles["border-top-left-radius"]} />
        </Row>
      </Section>

      <Section title="Effects">
        <Row label="Opacity">
          <InputGroup className="h-6 w-20" data-disabled={!editable}>
            <InputGroupInput
              className="h-full px-1.5 md:text-[11px]"
              disabled={!editable}
              defaultValue={Math.round(Number.parseFloat(styles.opacity?.value ?? "1") * 100)}
              key={styles.opacity?.value}
              onBlur={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n))
                  onClass(
                    [n >= 100 ? "opacity-100" : `opacity-${Math.round(n)}`],
                    removalFor(styles.opacity),
                  );
              }}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            />
            <InputGroupAddon align="inline-end" className="py-0 pr-1.5 font-normal text-[10px]">
              %
            </InputGroupAddon>
          </InputGroup>
          <Prov s={styles.opacity} />
        </Row>
        <Row label="Shadow">
          <ScaleSelect
            prop="box-shadow"
            prefix="shadow"
            scale={shadowScale}
            styles={styles}
            onClass={onClass}
            disabled={!editable}
          />
          <Prov s={styles["box-shadow"]} />
        </Row>
      </Section>

      {source && (
        <Section title="Classes">
          <ClassEditor source={source} inspect={inspect} onClass={onClass} disabled={!editable} />
        </Section>
      )}
    </div>
  );
};

const FontSelect = ({
  styles,
  onClass,
  disabled,
}: {
  styles: Record<string, StyleValue>;
  onClass: (a: string[], r: string[]) => void;
  disabled: boolean;
}) => {
  const options = useTokenOptions("font");
  const s = styles["font-family"];
  const cls = s?.provenance.className;
  const current =
    cls?.startsWith("font-") && options.find((o) => o.value === cls.slice(5)) ? cls.slice(5) : null;
  return (
    <>
      <OptionSelect
        disabled={disabled}
        size="sm"
        value={current}
        placeholder={s?.value.split(",")[0]?.replaceAll('"', "") ?? "—"}
        options={options}
        onChange={(v) => onClass([`font-${v}`], removalFor(s))}
      />
      <Prov s={s} />
    </>
  );
};

const ClassEditor = ({
  source,
  inspect,
  onClass,
  disabled,
}: {
  source: ElementSource;
  inspect: InspectResult;
  onClass: (a: string[], r: string[]) => void;
  disabled: boolean;
}) => {
  const [draft, setDraft] = React.useState("");
  const own = source.className?.split(/\s+/).filter(Boolean) ?? [];
  const inherited = inspect.classes.filter((c) => !own.includes(c));
  return (
    <>
      <div className="flex flex-wrap gap-1">
        {own.map((c) => (
          <Badge
            key={c}
            render={<button type="button" disabled={disabled} />}
            title="Remove"
            className="rounded-sm bg-brand/20 px-1.5 font-mono text-brand hover:bg-destructive/20 hover:text-destructive disabled:pointer-events-none"
            onClick={() => onClass([], [c])}
          >
            {c}
          </Badge>
        ))}
        {own.length === 0 && (
          <span className="text-muted-foreground">No classes on this element</span>
        )}
      </div>
      <Input
        className="h-6 font-mono md:text-[11px]"
        placeholder="Add classes…"
        disabled={disabled}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && draft.trim()) {
            onClass(draft.trim().split(/\s+/), []);
            setDraft("");
          }
        }}
      />
      {inherited.length > 0 && (
        <Collapsible>
          <CollapsibleTrigger
            render={<Button variant="ghost" size="xs" className="-ml-2 text-muted-foreground" />}
          >
            <ChevronRight className="transition-transform group-data-panel-open/button:rotate-90" />
            {inherited.length} classes from the component
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-1 flex flex-wrap gap-1">
            {inherited.map((c) => (
              <Badge key={c} variant="secondary" className="rounded-sm px-1.5 font-mono">
                {c}
              </Badge>
            ))}
          </CollapsibleContent>
        </Collapsible>
      )}
    </>
  );
};

const Header = ({ inspect, source }: { inspect: InspectResult; source: ElementSource | null }) => (
  <div className="flex flex-col gap-0.5 border-b px-3 py-2.5">
    <div className="flex items-center gap-2">
      <span className={cn("font-semibold text-sm", inspect.kind === "component" && "text-brand")}>
        {inspect.name}
      </span>
      <span className="text-muted-foreground">
        {Math.round(inspect.rect.width)} × {Math.round(inspect.rect.height)}
      </span>
    </div>
    {inspect.source && (
      <span
        className="truncate font-mono text-[10px] text-muted-foreground"
        title={`${inspect.source.file}:${inspect.source.line}:${inspect.source.col}`}
      >
        {inspect.source.file.split("/").slice(-2).join("/")}:{inspect.source.line}
      </span>
    )}
    {source?.text !== null && source?.text !== undefined && (
      <span className="truncate text-muted-foreground">“{source.text}”</span>
    )}
  </div>
);

const NotEditable = ({ inspect }: { inspect: InspectResult }) => (
  <div className="border-b p-2">
    <Alert>
      <Lock />
      <AlertDescription className="flex flex-col gap-1.5">
        <span>
          This element comes from{" "}
          <span className="font-mono text-[10px] text-foreground">
            {inspect.source ? inspect.source.file : "code outside the stamped directories"}
          </span>
          , not from a screen file, so its values are read-only here.
        </span>
        {inspect.editableAncestor && (
          <Button
            size="sm"
            variant="outline"
            className="self-start"
            onClick={() => {
              const s = useEditor.getState();
              if (!s.selection || !inspect.editableAncestor) return;
              s.select({
                screenId: s.selection.screenId,
                nodeId: inspect.editableAncestor.nodeId,
                source: inspect.editableAncestor.source,
              });
            }}
          >
            Select {inspect.editableAncestor.name} instead
          </Button>
        )}
      </AlertDescription>
    </Alert>
  </div>
);
